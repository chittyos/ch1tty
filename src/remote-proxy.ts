// Ported from src/remote-proxy.ts. The transport (StreamableHTTPClientTransport
// + MCP Client), connection caching, reconnect, circuit-breaker integration,
// tool/resource/prompt list + call logic, and pagination are kept faithfully.
//
// THE TWO WORKER CHANGES (no longer node:child_process):
//  1. getAuthToken(): the stdio gateway ran
//        execFileAsync('chitty-mcp-token', [authTokenKey])
//     — a subprocess broker lookup. Workers cannot spawn processes. Tokens are
//     now delivered as Worker env bindings (Secrets Store / vars) and resolved
//     via AUTH_TOKEN_ENV. This is REAL auth, not a stub: a missing binding for a
//     server with authTokenKey set throws auth_token_unavailable (same fail-loud
//     contract as the original C2 fix), it does NOT silently fall back to anon.
//  2. envHeaders are resolved from the Worker `env` object instead of
//     process.env.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
  ServerConfig, RemoteServerConfig, ResourceEntry, ResourceTemplateEntry,
  PromptEntry, ToolEntry, ToolCallResult, BackendStatus, Backend, ContentItem, Env,
} from './types.js';
import { VERSION, withTimeout, normalizeToolResult, resolveSecret } from './utils.js';
import { log } from './logger.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { AUTH_TOKEN_ENV } from './config-data.js';
import { ToolsClient, normalizeToolSchema } from './vendor/schema-client/index.js';

interface RemoteConnection {
  client: Client;
  transport: StreamableHTTPClientTransport;
  toolCache: { tools: ToolEntry[]; expiresAt: number } | null;
  resourceCache: { resources: ResourceEntry[]; templates: ResourceTemplateEntry[]; expiresAt: number } | null;
  promptCache: { prompts: PromptEntry[]; expiresAt: number } | null;
}

const TOOL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const CONNECT_TIMEOUT_MS = 15_000;
const LIST_TIMEOUT_MS = 15_000;
const CALL_TIMEOUT_MS = 120_000;

function isConnectionError(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.message.includes('timed out after')) return true;
    if ('code' in err && typeof (err as { code?: unknown }).code === 'number') {
      // -32000 is ErrorCode.ConnectionClosed. Other JSON-RPC codes are valid
      // backend responses (MethodNotFound -32601, InvalidParams -32602, ...).
      return (err as { code: number }).code === -32000;
    }
  }
  return false;
}

export class RemoteProxy implements Backend {
  private configs = new Map<string, RemoteServerConfig>();
  private connections = new Map<string, RemoteConnection>();
  private connecting = new Map<string, Promise<RemoteConnection>>();
  private breaker = new CircuitBreaker();
  // ChittySchema canonical tool-schema client. Resolves the FLAT canonical
  // schema per tool; when ChittySchema has none, the upstream self-report is
  // normalized locally via the SAME de-nester (one shared implementation).
  private toolsClient = new ToolsClient();

  constructor(private env: Env) {}

  registerServer(config: ServerConfig): void {
    if (config.type !== 'remote') return;
    this.configs.set(config.id, config);
  }

  /**
   * Resolve the bearer token for an authenticated upstream from the Worker env.
   * Replaces the `chitty-mcp-token` subprocess. Fails loud (auth was explicitly
   * requested via authTokenKey) rather than connecting unauthenticated.
   */
  private async getAuthToken(config: RemoteServerConfig): Promise<string | null> {
    if (!config.authTokenKey) return null;
    const envName = AUTH_TOKEN_ENV[config.authTokenKey];
    if (!envName) {
      log.error(`No env binding mapped for authTokenKey '${config.authTokenKey}'`, config.id);
      throw new Error(`auth_token_unavailable: ${config.authTokenKey}`);
    }
    const token = await resolveSecret(this.env[envName]);
    if (!token) {
      log.error(`Auth token binding '${envName}' empty/unset (key '${config.authTokenKey}')`, config.id);
      throw new Error(`auth_token_unavailable: ${config.authTokenKey}`);
    }
    return token;
  }

  private async connect(serverId: string): Promise<RemoteConnection> {
    const config = this.configs.get(serverId);
    if (!config) throw new Error(`Unknown remote server: ${serverId}`);

    const existing = this.connections.get(serverId);
    if (existing) return existing;

    const pending = this.connecting.get(serverId);
    if (pending) return pending;

    const promise = this.doConnect(config);
    this.connecting.set(serverId, promise);
    try {
      const conn = await promise;
      this.connections.set(serverId, conn);
      return conn;
    } catch (err) {
      this.connections.delete(serverId);
      throw err;
    } finally {
      this.connecting.delete(serverId);
    }
  }

  private evict(serverId: string): void {
    const conn = this.connections.get(serverId);
    if (conn) {
      conn.client.close().catch((err) => log.warn(`Evict close failed: ${err}`, serverId));
      this.connections.delete(serverId);
      log.debug(`Evicted dead connection`, serverId);
    }
  }

  private async connectWithReconnect(serverId: string): Promise<RemoteConnection> {
    try {
      return await withTimeout(this.connect(serverId), CONNECT_TIMEOUT_MS, `connect ${serverId}`);
    } catch (err) {
      if (this.connections.has(serverId)) {
        this.evict(serverId);
        log.info(`Reconnecting after stale connection`, serverId);
        return await withTimeout(this.connect(serverId), CONNECT_TIMEOUT_MS, `connect ${serverId}`);
      }
      throw err;
    }
  }

  private async doConnect(config: RemoteServerConfig): Promise<RemoteConnection> {
    const headers: Record<string, string> = { ...(config.headers ?? {}) };
    if (config.envHeaders) {
      for (const [headerName, envVarName] of Object.entries(config.envHeaders)) {
        const value = await resolveSecret(this.env[envVarName]);
        if (value) headers[headerName] = value;
      }
    }

    const token = await this.getAuthToken(config);
    if (token && !headers.Authorization) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    log.info(`Connecting to ${config.id} (${config.endpoint})`, config.id, {
      headerKeys: Object.keys(headers),
      hasToken: Boolean(token),
    });

    const url = new URL(config.endpoint);
    const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers } });
    const client = new Client({ name: `ch1tty-remote-${config.id}`, version: VERSION }, { capabilities: {} });

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

    const existing = this.connections.get(serverId);
    if (existing?.toolCache && Date.now() < existing.toolCache.expiresAt) {
      return existing.toolCache.tools;
    }

    try {
      const conn = await this.connectWithReconnect(serverId);
      const tools: ToolEntry[] = [];
      let cursor: string | undefined = undefined;
      do {
        const result: { tools: { name: string; description?: string; inputSchema: unknown }[]; nextCursor?: string } =
          await withTimeout(
            conn.client.listTools(cursor ? { cursor } : undefined),
            LIST_TIMEOUT_MS,
            `listTools ${serverId}`,
          );
        tools.push(...result.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema as Record<string, unknown>,
        })));
        cursor = result.nextCursor;
      } while (cursor);

      // Resolve each tool's schema through ChittySchema's canonical tool-schema
      // surface via @chittyos/schema-client. When ChittySchema holds a canonical
      // (de-nested) schema we use it; otherwise we run the upstream self-report
      // through the SAME normalizer locally so a 'Russian doll' schema is never
      // federated raw. Failure is non-fatal (live/cache/local-fallback discipline
      // mirroring the ontology client) — a ChittySchema outage degrades to local
      // normalization, never to broken tool listing.
      try {
        const canonical = await this.toolsClient.fetchCanonicalTools(serverId);
        for (const tool of tools) {
          const hit = canonical.get(tool.name);
          if (hit?.canonicalSchema) {
            tool.inputSchema = hit.canonicalSchema as Record<string, unknown>;
          } else {
            const flat = normalizeToolSchema(tool.inputSchema);
            if (flat) tool.inputSchema = flat as Record<string, unknown>;
          }
        }
      } catch (err) {
        // ChittySchema unreachable: fall back to local normalization for every
        // tool so the surface is still de-nested.
        log.error(`Canonical tool resolve failed for ${serverId}, normalizing locally: ${String(err)}`, serverId);
        for (const tool of tools) {
          const flat = normalizeToolSchema(tool.inputSchema);
          if (flat) tool.inputSchema = flat as Record<string, unknown>;
        }
      }

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

  async callTool(serverId: string, toolName: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
    const config = this.configs.get(serverId);
    if (!config) {
      return { content: [{ type: 'text', text: `Unknown remote server: ${serverId}` }], isError: true };
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
        CALL_TIMEOUT_MS,
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
      return { content: [{ type: 'text', text: `Remote call error: ${String(err)}` }], isError: true };
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
        withTimeout(conn.client.listResources(), LIST_TIMEOUT_MS, `listResources ${serverId}`),
        withTimeout(conn.client.listResourceTemplates(), LIST_TIMEOUT_MS, `listResourceTemplates ${serverId}`),
      ]);

      const resources: ResourceEntry[] = resResult.status === 'fulfilled'
        ? resResult.value.resources.map((r) => ({ uri: r.uri, name: r.name, description: r.description, mimeType: r.mimeType }))
        : [];
      const templates: ResourceTemplateEntry[] = tmplResult.status === 'fulfilled'
        ? tmplResult.value.resourceTemplates.map((t) => ({ uriTemplate: t.uriTemplate, name: t.name, description: t.description, mimeType: t.mimeType }))
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

  async readResource(serverId: string, uri: string): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }> }> {
    if (!this.breaker.isAllowed(serverId)) throw new Error(`readResource: circuit open for ${serverId}`);
    try {
      const conn = await this.connectWithReconnect(serverId);
      const result = await withTimeout(conn.client.readResource({ uri }), CALL_TIMEOUT_MS, `readResource ${serverId} ${uri}`);
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
      const result = await withTimeout(conn.client.listPrompts(), LIST_TIMEOUT_MS, `listPrompts ${serverId}`);
      const prompts: PromptEntry[] = result.prompts.map((p) => ({
        name: p.name,
        description: p.description,
        arguments: p.arguments?.map((a) => ({ name: a.name, description: a.description, required: a.required })),
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
    if (!this.breaker.isAllowed(serverId)) throw new Error(`getPrompt: circuit open for ${serverId}`);
    try {
      const conn = await this.connectWithReconnect(serverId);
      const result = await withTimeout(conn.client.getPrompt({ name, arguments: promptArgs }), CALL_TIMEOUT_MS, `getPrompt ${serverId} ${name}`);
      this.breaker.recordSuccess(serverId);
      return {
        description: result.description,
        messages: result.messages.map((m) => ({ role: m.role, content: m.content as ContentItem })),
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
      closePromises.push(conn.client.close().catch((err) => log.error(`Error closing remote ${id}: ${err}`)));
    }
    await Promise.allSettled(closePromises);
    this.connections.clear();
    this.connecting.clear();
    this.breaker.reset();
  }
}
