// Ported verbatim from the stdio gateway (src/types.ts). Transport-agnostic —
// no Node coupling. The Backend interface is implemented by RemoteProxy (the
// only backend in the Worker; the stdio ChildManager is dropped — see worker.ts).
export type ServerAccess = 'read' | 'write' | 'readwrite';
export type ServerCategory =
  | 'ecosystem'
  | 'code'
  | 'search'
  | 'reasoning'
  | 'desktop'
  | 'documents'
  | 'communication';

interface BaseServerConfig {
  id: string;
  name: string;
  access: ServerAccess;
  category: ServerCategory;
  lazy?: boolean;
  enabled?: boolean;
}

export interface LocalServerConfig extends BaseServerConfig {
  type: 'local';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface RemoteServerConfig extends BaseServerConfig {
  type: 'remote';
  endpoint: string;
  /**
   * Secret name resolved from the Worker env (Secrets Store binding or var).
   * Replaces the stdio gateway's `chitty-mcp-token <key>` subprocess: in a
   * Worker there is no process to spawn, so the bearer token is delivered as a
   * binding and looked up by this key. See remote-proxy.ts resolveAuthToken().
   */
  authTokenKey?: string;
  headers?: Record<string, string>;
  /** header name -> env var name. Resolved from Worker env at connect time. */
  envHeaders?: Record<string, string>;
}

export type ServerConfig = LocalServerConfig | RemoteServerConfig;

export interface ServersConfig {
  servers: ServerConfig[];
}

export interface AggregatedTool {
  serverId: string;
  originalName: string;
  namespacedName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** MCP content item — supports text, image, and resource types. */
export type ContentItem =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; resource: { uri: string; mimeType?: string; text?: string; blob?: string } };

export interface ToolCallResult {
  [key: string]: unknown;
  content: ContentItem[];
  isError?: boolean;
}

export interface ResourceEntry {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface ResourceTemplateEntry {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface PromptEntry {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export interface BackendStatus {
  connected: boolean;
  toolCount: number;
  toolCacheAge: number | null;
}

export interface ServerStatus extends BackendStatus {
  id: string;
  name: string;
  type: 'local' | 'remote';
  enabled: boolean;
  error?: string;
}

export interface ToolEntry {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Common interface for MCP backends. In the Worker only RemoteProxy implements
 * this (HTTP/streamable-MCP transport). The stdio ChildManager is gone.
 */
export interface Backend {
  registerServer(config: ServerConfig): void;
  isRegistered(serverId: string): boolean;
  getStatus(serverId: string): BackendStatus;

  listTools(serverId: string): Promise<ToolEntry[]>;
  callTool(serverId: string, toolName: string, args?: Record<string, unknown>, options?: { timeoutMs?: number }): Promise<ToolCallResult>;

  listResources(serverId: string): Promise<{ resources: ResourceEntry[]; templates: ResourceTemplateEntry[] }>;
  readResource(serverId: string, uri: string): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }> }>;

  listPrompts(serverId: string): Promise<PromptEntry[]>;
  getPrompt(serverId: string, name: string, args?: Record<string, string>): Promise<{ description?: string; messages: Array<{ role: 'user' | 'assistant'; content: ContentItem }> }>;

  shutdown(): Promise<void>;
}

/** Worker environment bindings. */
export interface Env {
  /** Workers AI binding (embedding brain). */
  AI: Ai;
  /** Worker Loader binding for codemode DynamicWorkerExecutor. */
  LOADER: unknown;
  /** Browser Rendering binding */
  BROWSER?: unknown;
  /** Agent Memory binding */
  MEMORY?: any;
  /** Per-session Durable Object namespace. */
  CH1TTY: DurableObjectNamespace;
  /** Vectorize index for tool-embedding search (768-dim, cosine). */
  VECTORIZE?: VectorizeIndex;
  /** Optional bearer token guarding the /mcp endpoint. */
  CH1TTY_MCP_TOKEN?: string;
  /** Secrets Store secret: ChittyMCP broker token (servers.json authTokenKey "chittymcp"). */
  CHITTY_MCP_TOKEN?: SecretsStoreSecret | string;
  CLOUDFLARE_MCP_TOKEN?: SecretsStoreSecret | string;
  CLOUDFLARE_BUILDS_MCP_TOKEN?: SecretsStoreSecret | string;
  CHITTYEVIDENCE_SEARCH_TOKEN?: SecretsStoreSecret | string;
  CLOUDFLARE_BROWSER_RENDERING_TOKEN?: SecretsStoreSecret | string;
  LINEAR_MCP_TOKEN?: SecretsStoreSecret | string;
  /** "Bearer <PAT>" for github upstream (servers.json envHeaders Authorization). */
  GITHUB_MCP_AUTHORIZATION?: SecretsStoreSecret | string;
  /** CF Access service-token pair for mcp.chitty.cc-proxied upstreams. */
  CHITTY_CF_ACCESS_CLIENT_ID?: SecretsStoreSecret | string;
  CHITTY_CF_ACCESS_CLIENT_SECRET?: SecretsStoreSecret | string;
  [key: string]: unknown;
}
