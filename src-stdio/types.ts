/**
 * Re-exports all shared types from @ch1tty/shared-types.
 * This file is the gateway-local import point; canonical definitions live in packages/shared-types/src/index.ts.
 */
export type {
  ServerAccess,
  ServerCategory,
  LocalServerConfig,
  RemoteServerConfig,
  ServerConfig,
  ServersConfig,
  AggregatedTool,
  ContentItem,
  ToolCallResult,
  ResourceEntry,
  ResourceTemplateEntry,
  PromptEntry,
  BackendStatus,
  ServerStatus,
  ToolEntry,
  Backend,
} from '@ch1tty/shared-types';
