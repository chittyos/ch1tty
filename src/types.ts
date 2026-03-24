export type ServerAccess = 'read' | 'write' | 'readwrite';
export type ServerCategory =
  | 'ecosystem'
  | 'code'
  | 'search'
  | 'reasoning'
  | 'desktop'
  | 'documents'
  | 'communication';

export interface ServerConfig {
  id: string;
  name: string;
  type: 'local' | 'remote';
  access: ServerAccess;
  category: ServerCategory;
  command?: string;
  args?: string[];
  endpoint?: string;
  authTokenKey?: string;
  lazy?: boolean;
  enabled?: boolean;
  env?: Record<string, string>;
}

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

export interface ToolCallResult {
  [key: string]: unknown;
  content: Array<{ type: string; text: string }>;
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
  getPrompt(serverId: string, name: string, args?: Record<string, string>): Promise<{ description?: string; messages: Array<{ role: string; content: { type: string; text: string } }> }>;

  shutdown(): Promise<void>;
}
