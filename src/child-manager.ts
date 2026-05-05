import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const execFileAsync = promisify(execFile);
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ServerConfig, LocalServerConfig, ResourceEntry, ResourceTemplateEntry, PromptEntry, ToolEntry, ToolCallResult, BackendStatus, Backend, ContentItem } from './types.js';
import { VERSION, withTimeout, normalizeToolResult } from './utils.js';
import { log } from './logger.js';
import { CircuitBreaker } from './circuit-breaker.js';

interface ChildConnection {
  client: Client;
  transport: StdioClientTransport;
  toolCache: { tools: ToolEntry[]; expiresAt: number } | null;
  resourceCache: { resources: ResourceEntry[]; templates: ResourceTemplateEntry[]; expiresAt: number } | null;
  promptCache: { prompts: PromptEntry[]; expiresAt: number } | null;
}

const TOOL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const SPAWN_TIMEOUT_MS = 30_000; // 30s to spawn + connect
const LIST_TIMEOUT_MS = 15_000; // 15s to list tools after connected
const CALL_TIMEOUT_MS = 120_000; // 2 min for tool calls

export class ChildManager implements Backend {
  private children = new Map<string, ChildConnection>();
  private configs = new Map<string, LocalServerConfig>();
  private connecting = new Map<string, Promise<ChildConnection>>();
  private opAvailable: boolean | null = null;
  private breaker = new CircuitBreaker();

  registerServer(config: ServerConfig): void {
    if (config.type !== 'local') return;
    this.configs.set(config.id, config);
  }

  private async spawn(serverId: string): Promise<ChildConnection> {
    const config = this.configs.get(serverId);
    if (!config) throw new Error(`Unknown local server: ${serverId}`);

    const existing = this.children.get(serverId);
    if (existing) return existing;

    // Prevent concurrent spawns for the same server
    const pending = this.connecting.get(serverId);
    if (pending) return pending;

    const promise = this.doSpawn(config);
    this.connecting.set(serverId, promise);

    try {
      const conn = await promise;
      this.children.set(serverId, conn);
      return conn;
    } catch (err) {
      // On failure, ensure no stale connection is stored
      this.children.delete(serverId);
      throw err;
    } finally {
      this.connecting.delete(serverId);
    }
  }

  /** Clear a dead connection so next call triggers a fresh spawn. */
  private evict(serverId: string): void {
    const conn = this.children.get(serverId);
    if (conn) {
      conn.client.close().catch((err) => log.warn(`Evict close failed: ${err}`, serverId));
      this.children.delete(serverId);
      log.debug(`Evicted dead connection`, serverId);
    }
  }

  /** Spawn with auto-reconnect: on failure, evict stale connection and retry once. */
  private async spawnWithReconnect(serverId: string): Promise<ChildConnection> {
    try {
      return await withTimeout(this.spawn(serverId), SPAWN_TIMEOUT_MS, `spawn ${serverId}`);
    } catch (err) {
      // If we had a cached connection that went stale, evict and retry
      if (this.children.has(serverId)) {
        this.evict(serverId);
        log.info(`Reconnecting after stale connection`, serverId);
        return await withTimeout(this.spawn(serverId), SPAWN_TIMEOUT_MS, `spawn ${serverId}`);
      }
      throw err;
    }
  }

  private async isOpAvailable(): Promise<boolean> {
    if (this.opAvailable !== null) return this.opAvailable;
    try {
      await execFileAsync('op', ['whoami'], { timeout: 5_000 });
      this.opAvailable = true;
    } catch {
      // Fall back to Connect server mode (op whoami doesn't support Connect)
      if (process.env.OP_CONNECT_HOST && process.env.OP_CONNECT_TOKEN) {
        try {
          await execFileAsync('op', ['vault', 'list', '--format=json'], { timeout: 5_000 });
          this.opAvailable = true;
        } catch {
          this.opAvailable = false;
        }
      } else {
        this.opAvailable = false;
      }
    }
    return this.opAvailable;
  }

  private async resolveEnv(config: LocalServerConfig): Promise<Record<string, string>> {
    const configEnv = config.env || {};

    // Resolve 1Password op:// references from config.env only (not process.env)
    const resolved: Record<string, string> = { ...configEnv };
    const opKeys = Object.entries(configEnv).filter(([, v]) => v.startsWith('op://'));
    if (opKeys.length > 0) {
      if (!(await this.isOpAvailable())) {
        log.warn(`1Password CLI not configured — skipping op:// env resolution`, config.id);
        for (const [key] of opKeys) {
          delete resolved[key];
        }
      } else {
        const results = await Promise.allSettled(
          opKeys.map(async ([key, ref]) => {
            const { stdout } = await execFileAsync('op', ['read', ref], { timeout: 30_000 });
            return { key, value: stdout.trim() };
          }),
        );

        for (const result of results) {
          if (result.status === 'fulfilled') {
            resolved[result.value.key] = result.value.value;
          } else {
            log.error(`Failed to resolve env from 1Password: ${result.reason}`, config.id);
          }
        }
      }
    }

    // Filter out undefined values from process.env before spreading
    const baseEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) baseEnv[k] = v;
    }

    return {
      ...baseEnv,
      ...resolved,
    };
  }

  private async doSpawn(config: LocalServerConfig): Promise<ChildConnection> {
    const env = await this.resolveEnv(config);

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args || [],
      env,
      stderr: 'pipe',
    });

    const client = new Client(
      { name: `ch1tty-child-${config.id}`, version: VERSION },
      { capabilities: {} },
    );

    // Log child stderr
    const stderr = transport.stderr;
    if (stderr) {
      const readable = stderr as import('node:stream').Readable;
      readable.on('data', (chunk: Buffer) => {
        log.childStderr(config.id, chunk);
      });
    }

    await client.connect(transport);
    return { client, transport, toolCache: null, resourceCache: null, promptCache: null };
  }

  async listTools(serverId: string): Promise<ToolEntry[]> {
    const config = this.configs.get(serverId);
    if (!config) return [];

    if (!this.breaker.isAllowed(serverId)) {
      log.debug(`Circuit open, skipping tool list`, serverId);
      return [];
    }

    // Check cache before spawning
    const existing = this.children.get(serverId);
    if (existing?.toolCache && Date.now() < existing.toolCache.expiresAt) {
      return existing.toolCache.tools;
    }

    try {
      const conn = await this.spawnWithReconnect(serverId);

      const result = await withTimeout(
        conn.client.listTools(),
        LIST_TIMEOUT_MS,
        `listTools ${serverId}`,
      );

      const tools: ToolEntry[] = result.tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
      }));

      conn.toolCache = { tools, expiresAt: Date.now() + TOOL_CACHE_TTL };
      this.breaker.recordSuccess(serverId);
      return tools;
    } catch (err) {
      this.breaker.recordFailure(serverId);
      this.evict(serverId);
      throw err;
    }
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
    if (!this.breaker.isAllowed(serverId)) {
      return {
        content: [{ type: 'text', text: `Backend "${serverId}" is temporarily unavailable (circuit open). Try again shortly.` }],
        isError: true,
      };
    }

    try {
      const conn = await this.spawnWithReconnect(serverId);
      const result = await withTimeout(
        conn.client.callTool({ name: toolName, arguments: args }),
        CALL_TIMEOUT_MS,
        `callTool ${serverId}/${toolName}`,
      );
      this.breaker.recordSuccess(serverId);
      return normalizeToolResult(result as Record<string, unknown>);
    } catch (err) {
      this.breaker.recordFailure(serverId);
      this.evict(serverId);
      throw err;
    }
  }

  async listResources(serverId: string): Promise<{ resources: ResourceEntry[]; templates: ResourceTemplateEntry[] }> {
    const config = this.configs.get(serverId);
    if (!config) return { resources: [], templates: [] };

    if (!this.breaker.isAllowed(serverId)) return { resources: [], templates: [] };

    const existing = this.children.get(serverId);
    if (existing?.resourceCache && Date.now() < existing.resourceCache.expiresAt) {
      return { resources: existing.resourceCache.resources, templates: existing.resourceCache.templates };
    }

    try {
      const conn = await this.spawnWithReconnect(serverId);

      const [resResult, tmplResult] = await Promise.allSettled([
        withTimeout(conn.client.listResources(), LIST_TIMEOUT_MS, `listResources ${serverId}`),
        withTimeout(conn.client.listResourceTemplates(), LIST_TIMEOUT_MS, `listResourceTemplates ${serverId}`),
      ]);

      const resources: ResourceEntry[] = resResult.status === 'fulfilled'
        ? resResult.value.resources.map((r) => ({
            uri: r.uri, name: r.name, description: r.description, mimeType: r.mimeType,
          }))
        : [];

      const templates: ResourceTemplateEntry[] = tmplResult.status === 'fulfilled'
        ? tmplResult.value.resourceTemplates.map((t) => ({
            uriTemplate: t.uriTemplate, name: t.name, description: t.description, mimeType: t.mimeType,
          }))
        : [];

      conn.resourceCache = { resources, templates, expiresAt: Date.now() + TOOL_CACHE_TTL };
      this.breaker.recordSuccess(serverId);
      return { resources, templates };
    } catch (err) {
      this.breaker.recordFailure(serverId);
      this.evict(serverId);
      log.error(`Resource list error: ${err}`, serverId);
      return { resources: [], templates: [] };
    }
  }

  async readResource(serverId: string, uri: string): Promise<{
    contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }>;
  }> {
    const conn = await this.spawnWithReconnect(serverId);
    const result = await conn.client.readResource({ uri });
    return {
      contents: result.contents.map((c) => ({
        uri: c.uri,
        mimeType: c.mimeType,
        text: 'text' in c ? (c.text as string) : undefined,
        blob: 'blob' in c ? (c.blob as string) : undefined,
      })),
    };
  }

  async listPrompts(serverId: string): Promise<PromptEntry[]> {
    const config = this.configs.get(serverId);
    if (!config) return [];

    if (!this.breaker.isAllowed(serverId)) return [];

    const existing = this.children.get(serverId);
    if (existing?.promptCache && Date.now() < existing.promptCache.expiresAt) {
      return existing.promptCache.prompts;
    }

    try {
      const conn = await this.spawnWithReconnect(serverId);
      const result = await withTimeout(
        conn.client.listPrompts(),
        LIST_TIMEOUT_MS,
        `listPrompts ${serverId}`,
      );

      const prompts: PromptEntry[] = result.prompts.map((p) => ({
        name: p.name,
        description: p.description,
        arguments: p.arguments?.map((a) => ({
          name: a.name, description: a.description, required: a.required,
        })),
      }));

      conn.promptCache = { prompts, expiresAt: Date.now() + TOOL_CACHE_TTL };
      this.breaker.recordSuccess(serverId);
      return prompts;
    } catch (err) {
      this.breaker.recordFailure(serverId);
      this.evict(serverId);
      log.error(`Prompt list error: ${err}`, serverId);
      return [];
    }
  }

  async getPrompt(serverId: string, name: string, promptArgs?: Record<string, string>): Promise<{
    description?: string;
    messages: Array<{ role: 'user' | 'assistant'; content: ContentItem }>;
  }> {
    const conn = await this.spawnWithReconnect(serverId);
    const result = await conn.client.getPrompt({ name, arguments: promptArgs });
    return {
      description: result.description,
      messages: result.messages.map((m) => ({
        role: m.role,
        content: m.content as ContentItem,
      })),
    };
  }

  getStatus(serverId: string): BackendStatus {
    const conn = this.children.get(serverId);
    if (!conn) return { connected: false, toolCount: 0, toolCacheAge: null };
    const toolCount = conn.toolCache?.tools.length ?? 0;
    const toolCacheAge = conn.toolCache ? Date.now() - (conn.toolCache.expiresAt - TOOL_CACHE_TTL) : null;
    return { connected: true, toolCount, toolCacheAge };
  }

  isRegistered(serverId: string): boolean {
    return this.configs.has(serverId);
  }

  async shutdown(): Promise<void> {
    const closePromises: Promise<void>[] = [];

    for (const [id, conn] of this.children) {
      closePromises.push(
        conn.client.close().catch((err) => {
          log.error(`Error closing ${id}: ${err}`);
        }),
      );
    }

    await Promise.allSettled(closePromises);
    this.children.clear();
    this.connecting.clear();
    this.breaker.reset();
  }
}
