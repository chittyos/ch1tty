import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ServerConfig, RemoteServerConfig, ResourceEntry, ResourceTemplateEntry, PromptEntry, ToolEntry, ToolCallResult, BackendStatus, Backend, ContentItem } from './types.js';
import { VERSION, withTimeout, normalizeToolResult } from './utils.js';
import { log } from './logger.js';
import { CircuitBreaker } from './circuit-breaker.js';

const execFileAsync = promisify(execFile);

interface TokenCache {
  token: string;
  expiresAt: number;
}

interface RemoteConnection {
  client: Client;
  transport: StreamableHTTPClientTransport;
  toolCache: { tools: ToolEntry[]; expiresAt: number } | null;
  resourceCache: { resources: ResourceEntry[]; templates: ResourceTemplateEntry[]; expiresAt: number } | null;
  promptCache: { prompts: PromptEntry[]; expiresAt: number } | null;
}

const TOOL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const TOKEN_CACHE_TTL = 11 * 60 * 60 * 1000; // 11 hours (tokens last 12hr)

// Read at call time so CH1TTY_REMOTE_TIMEOUT_MS can be set before the first call
// (same pattern as CH1TTY_SPAWN_TIMEOUT_MS in child-manager.ts).
function getConnectTimeoutMs(): number {
  const v = parseInt(process.env.CH1TTY_REMOTE_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 15_000;
}
function getListTimeoutMs(): number {
  const v = parseInt(process.env.CH1TTY_REMOTE_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 15_000;
}
function getCallTimeoutMs(): number {
  const v = parseInt(process.env.CH1TTY_REMOTE_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 120_000; // 2 min for tool calls
}

function isConnectionError(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.message.includes('timed out after')) return true;
    // Node.js fetch throws TypeError with message 'fetch failed' for ECONNREFUSED etc.
    if (err.message.includes('fetch failed')) return true;
    // Auth token retrieval failure — treat as connection error so circuit breaker advances.
    if (err.message.startsWith('auth_token_unavailable')) return true;
    // MCP SDK StreamableHTTP transport wraps HTTP 4xx/5xx errors with this prefix.
    if (err.message.includes('Streamable HTTP error:')) return true;
    if ('code' in err && typeof (err as { code?: unknown }).code === 'number') {
      const code = (err as { code: number }).code;
      // -32000 = ConnectionClosed — unambiguously a transport error.
      // -32603 (InternalError) is intentionally excluded: 'Streamable HTTP error:' already
      // catches HTTP 500 responses, and -32603 at the McpError level may be an
      // application-level tool error on a healthy connection — evicting for it would
      // incorrectly open the circuit breaker for unrelated tools on the same backend.
      return code === -32000;
    }
  }
  return false;
}

export class RemoteProxy implements Backend {
  private configs = new Map<string, RemoteServerConfig>();
  private connections = new Map<string, RemoteConnection>();
  private connecting = new Map<string, Promise<RemoteConnection>>();
  private tokenCaches = new Map<string, TokenCache>();
  private breaker = new CircuitBreaker();

  registerServer(config: ServerConfig): void {
    if (config.type !== 'remote') return;
    this.configs.set(config.id, config);
  }

  private async getAuthToken(config: RemoteServerConfig): Promise<string | null> {
    if (!config.authTokenKey) return null;

    const cached = this.tokenCaches.get(config.id);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.token;
    }

    try {
      const { stdout } = await execFileAsync('chitty-mcp-token', [config.authTokenKey], {
        timeout: 10_000,
      });
      const token = stdout.trim();
      if (!token) {
        throw new Error(`chitty-mcp-token returned empty value for key '${config.authTokenKey}'`);
      }

      this.tokenCaches.set(config.id, {
        token,
        expiresAt: Date.now() + TOKEN_CACHE_TTL,
      });

      return token;
    } catch (err) {
      // C2 — auth was explicitly requested (authTokenKey set). Do NOT silently fall back to
      // an unauthenticated connection; surface the retrieval failure to callers so they see
      // the real cause (1Password down, token rotated, CLI missing) rather than a downstream 401.
      log.error(`Failed to get auth token (key '${config.authTokenKey}'): ${err}`, config.id);
      throw new Error(`auth_token_unavailable: ${config.authTokenKey}`);
    }
  }

  private async connect(serverId: string): Promise<RemoteConnection> {
    const config = this.configs.get(serverId);
    if (!config) throw new Error(`Unknown remote server: ${serverId}`);

    const existing = this.connections.get(serverId);
    if (existing) return existing;

    // Prevent concurrent connects for the same server
    const pending = this.connecting.get(serverId);
    if (pending) return pending;

    const promise = this.doConnect(config);
    this.connecting.set(serverId, promise);

    try {
      const conn = await promise;
      this.connections.set(serverId, conn);
      return conn;
    } catch (err) {
      // On failure, ensure no stale connection is stored
      this.connections.delete(serverId);
      throw err;
    } finally {
      this.connecting.delete(serverId);
    }
  }

  /** Clear a dead connection so next call triggers a fresh connect. */
  private evict(serverId: string): void {
    const conn = this.connections.get(serverId);
    if (conn) {
      conn.client.close().catch((err) => log.warn(`Evict close failed: ${err}`, serverId));
      this.connections.delete(serverId);
      log.debug(`Evicted dead connection`, serverId);
    }
  }

  /** Connect with auto-reconnect: on failure, evict stale connection and retry once. */
  private async connectWithReconnect(serverId: string): Promise<RemoteConnection> {
    try {
      return await withTimeout(this.connect(serverId), getConnectTimeoutMs(), `connect ${serverId}`);
    } catch (err) {
      if (this.connections.has(serverId)) {
        this.evict(serverId);
        log.info(`Reconnecting after stale connection`, serverId);
        return await withTimeout(this.connect(serverId), getConnectTimeoutMs(), `connect ${serverId}`);
      }
      throw err;
    }
  }

  private async doConnect(config: RemoteServerConfig): Promise<RemoteConnection> {
    const headers: Record<string, string> = { ...(config.headers ?? {}) };
    if (config.envHeaders) {
      for (const [headerName, envVarName] of Object.entries(config.envHeaders)) {
        const value = process.env[envVarName];
        if (value) headers[headerName] = value;
      }
    }

    const token = await this.getAuthToken(config);
    if (token && !headers.Authorization) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Diagnostic logging - safe, only prints keys and lengths/prefixes
    log.info(`[Diagnostic] Connecting to ${config.id} (${config.endpoint})`, config.id);
    log.info(`[Diagnostic] Header keys: ${Object.keys(headers).join(', ')}`, config.id);
    log.info(`[Diagnostic] Client ID: ${headers['CF-Access-Client-Id'] ? 'set (' + headers['CF-Access-Client-Id'].slice(0, 8) + '...)' : 'not set'}`, config.id);
    log.info(`[Diagnostic] Client Secret: ${headers['CF-Access-Client-Secret'] ? 'set (' + headers['CF-Access-Client-Secret'].slice(0, 4) + '...)' : 'not set'}`, config.id);
    log.info(`[Diagnostic] Token: ${token ? 'set (' + token.slice(0, 8) + '...)' : 'not set'}`, config.id);

    const url = new URL(config.endpoint);
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: {
        headers,
      },
    });

    const client = new Client(
      { name: `ch1tty-remote-${config.id}`, version: VERSION },
      { capabilities: {} },
    );

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

    // Check cache before connecting
    const existing = this.connections.get(serverId);
    if (existing?.toolCache && Date.now() < existing.toolCache.expiresAt) {
      return existing.toolCache.tools;
    }

    try {
      const conn = await this.connectWithReconnect(serverId);

      const tools: ToolEntry[] = [];
      let cursor: string | undefined = undefined;
      do {
        const result: { tools: { name: string; description?: string; inputSchema: any }[]; nextCursor?: string } = await withTimeout(
          conn.client.listTools(cursor ? { cursor } : undefined),
          getListTimeoutMs(),
          `listTools ${serverId}`,
        );

        tools.push(
          ...result.tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema as Record<string, unknown>,
          }))
        );

        cursor = result.nextCursor;
      } while (cursor);

      conn.toolCache = { tools, expiresAt: Date.now() + TOOL_CACHE_TTL };
      this.breaker.recordSuccess(serverId);
      return tools;
    } catch (err) {
      if (isConnectionError(err)) {
        this.breaker.recordFailure(serverId);
        this.evict(serverId);
      } else {
        this.breaker.recordSuccess(serverId);
      }
      log.error(`Tool list error: ${err}`, serverId);
      return [];
    }
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown> = {}, options?: { timeoutMs?: number }): Promise<ToolCallResult> {
    const config = this.configs.get(serverId);
    if (!config) {
      return {
        content: [{ type: 'text', text: `Unknown remote server: ${serverId}` }],
        isError: true,
      };
    }

    if (!this.breaker.isAllowed(serverId)) {
      return {
        content: [{ type: 'text', text: `Backend "${serverId}" is temporarily unavailable (circuit open). Try again shortly.` }],
        isError: true,
      };
    }

    try {
      const conn = await this.connectWithReconnect(serverId);
      const result = await withTimeout(
        conn.client.callTool({ name: toolName, arguments: args }),
        options?.timeoutMs ?? getCallTimeoutMs(),
        `callTool ${serverId}/${toolName}`,
      );
      this.breaker.recordSuccess(serverId);
      return normalizeToolResult(result as Record<string, unknown>);
    } catch (err) {
      if (isConnectionError(err)) {
        this.breaker.recordFailure(serverId);
        this.evict(serverId);
      } else {
        this.breaker.recordSuccess(serverId);
      }
      return {
        content: [{ type: 'text', text: `Remote call error: ${String(err)}` }],
        isError: true,
      };
    }
  }

  async listResources(serverId: string): Promise<{ resources: ResourceEntry[]; templates: ResourceTemplateEntry[] }> {
    const config = this.configs.get(serverId);
    if (!config) return { resources: [], templates: [] };

    if (!this.breaker.isAllowed(serverId)) return { resources: [], templates: [] };

    const existing = this.connections.get(serverId);
    if (existing?.resourceCache && Date.now() < existing.resourceCache.expiresAt) {
      return { resources: existing.resourceCache.resources, templates: existing.resourceCache.templates };
    }

    try {
      const conn = await this.connectWithReconnect(serverId);

      const [resResult, tmplResult] = await Promise.allSettled([
        withTimeout(conn.client.listResources(), getListTimeoutMs(), `listResources ${serverId}`),
        withTimeout(conn.client.listResourceTemplates(), getListTimeoutMs(), `listResourceTemplates ${serverId}`),
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
      if (isConnectionError(err)) {
        this.breaker.recordFailure(serverId);
        this.evict(serverId);
      } else {
        this.breaker.recordSuccess(serverId);
      }
      log.error(`Resource list error: ${err}`, serverId);
      return { resources: [], templates: [] };
    }
  }

  async readResource(serverId: string, uri: string): Promise<{
    contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }>;
  }> {
    if (!this.breaker.isAllowed(serverId)) {
      throw new Error(`readResource: circuit open for ${serverId}`);
    }
    try {
      const conn = await this.connectWithReconnect(serverId);
      const result = await withTimeout(
        conn.client.readResource({ uri }),
        getCallTimeoutMs(),
        `readResource ${serverId} ${uri}`,
      );
      this.breaker.recordSuccess(serverId);
      return {
        contents: result.contents.map((c) => ({
          uri: c.uri,
          mimeType: c.mimeType,
          text: 'text' in c ? (c.text as string) : undefined,
          blob: 'blob' in c ? (c.blob as string) : undefined,
        })),
      };
    } catch (err) {
      if (isConnectionError(err)) {
        this.breaker.recordFailure(serverId);
        this.evict(serverId);
      } else {
        this.breaker.recordSuccess(serverId);
      }
      log.error(`readResource error: ${err}`, serverId);
      throw err;
    }
  }

  async listPrompts(serverId: string): Promise<PromptEntry[]> {
    const config = this.configs.get(serverId);
    if (!config) return [];

    if (!this.breaker.isAllowed(serverId)) return [];

    const existing = this.connections.get(serverId);
    if (existing?.promptCache && Date.now() < existing.promptCache.expiresAt) {
      return existing.promptCache.prompts;
    }

    try {
      const conn = await this.connectWithReconnect(serverId);
      const result = await withTimeout(
        conn.client.listPrompts(),
        getListTimeoutMs(),
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
      if (isConnectionError(err)) {
        this.breaker.recordFailure(serverId);
        this.evict(serverId);
      } else {
        this.breaker.recordSuccess(serverId);
      }
      log.error(`Prompt list error: ${err}`, serverId);
      return [];
    }
  }

  async getPrompt(serverId: string, name: string, promptArgs?: Record<string, string>): Promise<{
    description?: string;
    messages: Array<{ role: 'user' | 'assistant'; content: ContentItem }>;
  }> {
    if (!this.breaker.isAllowed(serverId)) {
      throw new Error(`getPrompt: circuit open for ${serverId}`);
    }
    try {
      const conn = await this.connectWithReconnect(serverId);
      const result = await withTimeout(
        conn.client.getPrompt({ name, arguments: promptArgs }),
        getCallTimeoutMs(),
        `getPrompt ${serverId} ${name}`,
      );
      this.breaker.recordSuccess(serverId);
      return {
        description: result.description,
        messages: result.messages.map((m) => ({
          role: m.role,
          content: m.content as ContentItem,
        })),
      };
    } catch (err) {
      if (isConnectionError(err)) {
        this.breaker.recordFailure(serverId);
        this.evict(serverId);
      } else {
        this.breaker.recordSuccess(serverId);
      }
      log.error(`getPrompt error: ${err}`, serverId);
      throw err;
    }
  }

  getStatus(serverId: string): BackendStatus {
    const conn = this.connections.get(serverId);
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

    for (const [id, conn] of this.connections) {
      closePromises.push(
        conn.client.close().catch((err) => {
          log.error(`Error closing remote ${id}: ${err}`);
        }),
      );
    }

    await Promise.allSettled(closePromises);
    this.connections.clear();
    this.connecting.clear();
    this.breaker.reset();
  }
}
