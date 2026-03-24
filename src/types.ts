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

export interface ServerStatus {
  id: string;
  name: string;
  type: 'local' | 'remote';
  enabled: boolean;
  connected: boolean;
  toolCount: number;
  toolCacheAge: number | null;
  error?: string;
}
