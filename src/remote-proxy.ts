import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ServerConfig, ResourceEntry, ResourceTemplateEntry, PromptEntry } from './types.js';

interface ToolEntry {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

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
const CONNECT_TIMEOUT_MS = 15_000;
const LIST_TIMEOUT_MS = 15_000;

export class RemoteProxy {
  private configs = new Map<string, ServerConfig>();
  private connections = new Map<string, RemoteConnection>();
  private connecting = new Map<string, Promise<RemoteConnection>>();
  private tokenCaches = new Map<string, TokenCache>();

  registerServer(config: ServerConfig): void {
    if (config.type !== 'remote') return;
    this.configs.set(config.id, config);
  }

  private getAuthToken(config: ServerConfig): string | null {
    if (!config.authTokenKey) return null;

    const cached = this.tokenCaches.get(config.id);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.token;
    }

    try {
      const token = execFileSync('chitty-mcp-token', [config.authTokenKey], {
        encoding: 'utf-8',
        timeout: 10_000,
      }).trim();

      this.tokenCaches.set(config.id, {
        token,
        expiresAt: Date.now() + TOKEN_CACHE_TTL,
      });

      return token;
    } catch (err) {
      process.stderr.write(
        `[ch1tty:${config.id}] Failed to get auth token: ${err}\n`,
      );
      return null;
    }
  }

  private async connect(serverId: string): Promise<RemoteConnection> {
    const config = this.configs.get(serverId);
    if (!config) throw new Error(`Unknown remote server: ${serverId}`);
    if (!config.endpoint) throw new Error(`No endpoint configured for server: ${serverId}`);

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
    } finally {
      this.connecting.delete(serverId);
    }
  }

  private async doConnect(config: ServerConfig): Promise<RemoteConnection> {
    const headers: Record<string, string> = {};
    const token = this.getAuthToken(config);
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const url = new URL(config.endpoint!);
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: {
        headers,
      },
    });

    const client = new Client(
      { name: `ch1tty-remote-${config.id}`, version: '1.0.0' },
      { capabilities: {} },
    );

    await client.connect(transport);
    return { client, transport, toolCache: null, resourceCache: null, promptCache: null };
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      promise.then(
        (val) => { clearTimeout(timer); resolve(val); },
        (err) => { clearTimeout(timer); reject(err); },
      );
    });
  }

  async listTools(serverId: string): Promise<ToolEntry[]> {
    const config = this.configs.get(serverId);
    if (!config?.endpoint) return [];

    // Check cache before connecting
    const existing = this.connections.get(serverId);
    if (existing?.toolCache && Date.now() < existing.toolCache.expiresAt) {
      return existing.toolCache.tools;
    }

    try {
      const conn = await this.withTimeout(
        this.connect(serverId),
        CONNECT_TIMEOUT_MS,
        `connect ${serverId}`,
      );

      const result = await this.withTimeout(
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
      return tools;
    } catch (err) {
      process.stderr.write(`[ch1tty:${serverId}] Tool list error: ${err}\n`);
      return [];
    }
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown> = {}): Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  }> {
    const config = this.configs.get(serverId);
    if (!config?.endpoint) {
      return {
        content: [{ type: 'text', text: `Unknown remote server: ${serverId}` }],
        isError: true,
      };
    }

    try {
      const conn = await this.connect(serverId);
      const result = await conn.client.callTool({ name: toolName, arguments: args });

      // Normalize the result shape (same pattern as child-manager)
      if ('content' in result) {
        return {
          content: (result.content as Array<{ type: string; text: string }>),
          isError: (result.isError as boolean | undefined) ?? false,
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify((result as { toolResult: unknown }).toolResult) }],
        isError: false,
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Remote call error: ${String(err)}` }],
        isError: true,
      };
    }
  }

  async listResources(serverId: string): Promise<{ resources: ResourceEntry[]; templates: ResourceTemplateEntry[] }> {
    const config = this.configs.get(serverId);
    if (!config?.endpoint) return { resources: [], templates: [] };

    const existing = this.connections.get(serverId);
    if (existing?.resourceCache && Date.now() < existing.resourceCache.expiresAt) {
      return { resources: existing.resourceCache.resources, templates: existing.resourceCache.templates };
    }

    try {
      const conn = await this.withTimeout(this.connect(serverId), CONNECT_TIMEOUT_MS, `connect ${serverId}`);

      const [resResult, tmplResult] = await Promise.allSettled([
        this.withTimeout(conn.client.listResources(), LIST_TIMEOUT_MS, `listResources ${serverId}`),
        this.withTimeout(conn.client.listResourceTemplates(), LIST_TIMEOUT_MS, `listResourceTemplates ${serverId}`),
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
      return { resources, templates };
    } catch (err) {
      process.stderr.write(`[ch1tty:${serverId}] Resource list error: ${err}\n`);
      return { resources: [], templates: [] };
    }
  }

  async readResource(serverId: string, uri: string): Promise<{
    contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }>;
  }> {
    const conn = await this.connect(serverId);
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
    if (!config?.endpoint) return [];

    const existing = this.connections.get(serverId);
    if (existing?.promptCache && Date.now() < existing.promptCache.expiresAt) {
      return existing.promptCache.prompts;
    }

    try {
      const conn = await this.withTimeout(this.connect(serverId), CONNECT_TIMEOUT_MS, `connect ${serverId}`);
      const result = await this.withTimeout(
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
      return prompts;
    } catch (err) {
      process.stderr.write(`[ch1tty:${serverId}] Prompt list error: ${err}\n`);
      return [];
    }
  }

  async getPrompt(serverId: string, name: string, promptArgs?: Record<string, string>): Promise<{
    description?: string;
    messages: Array<{ role: string; content: { type: string; text: string } }>;
  }> {
    const conn = await this.connect(serverId);
    const result = await conn.client.getPrompt({ name, arguments: promptArgs });
    return {
      description: result.description,
      messages: result.messages.map((m) => ({
        role: m.role,
        content: m.content as { type: string; text: string },
      })),
    };
  }

  getStatus(serverId: string): { connected: boolean; toolCount: number; toolCacheAge: number | null } {
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
          process.stderr.write(`[ch1tty] Error closing remote ${id}: ${err}\n`);
        }),
      );
    }

    await Promise.allSettled(closePromises);
    this.connections.clear();
    this.connecting.clear();
  }
}
