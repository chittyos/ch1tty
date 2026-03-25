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
  authTokenKey?: string;
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
 * Common interface for MCP backends.
 * ChildManager uses stdio transport, RemoteProxy uses HTTP transport.
 */
export interface Backend {
  registerServer(config: ServerConfig): void;
  isRegistered(serverId: string): boolean;
  getStatus(serverId: string): BackendStatus;

  listTools(serverId: string): Promise<ToolEntry[]>;
  callTool(serverId: string, toolName: string, args?: Record<string, unknown>): Promise<ToolCallResult>;

  listResources(serverId: string): Promise<{ resources: ResourceEntry[]; templates: ResourceTemplateEntry[] }>;
  readResource(serverId: string, uri: string): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }> }>;

  listPrompts(serverId: string): Promise<PromptEntry[]>;
  getPrompt(serverId: string, name: string, args?: Record<string, string>): Promise<{ description?: string; messages: Array<{ role: string; content: ContentItem }> }>;

  shutdown(): Promise<void>;
}
