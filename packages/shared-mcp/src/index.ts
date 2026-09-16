/**
 * @ch1tty/shared-mcp
 *
 * Shared MCP HTTP transport utilities for the ch1tty gateway (src-stdio/) and
 * focused MCP servers (apps/*-mcp). Provides bearer-auth helpers and a
 * session manager for Streamable HTTP transport.
 *
 * A follow-up PR will update src-stdio/http-server.ts to use these canonical
 * implementations and update apps/*-mcp index files to use McpSessionManager
 * when they add HTTP transport.
 */

export * from './bearer-auth.js';
export * from './session-manager.js';
