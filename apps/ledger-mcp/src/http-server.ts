import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  McpSessionManager,
  checkBearerToken,
  writeUnauthorized,
} from '@ch1tty/shared-mcp';
import type { McpServerFactory } from '@ch1tty/shared-mcp';
import { createLedgerServer } from './server.js';
import { LedgerClient } from './ledger-client.js';

export { McpSessionManager };
export type { McpServerFactory };

export interface LedgerMcpHttpAppOptions {
  mcpToken?: string;
  serverFactory?: McpServerFactory;
}

export interface LedgerMcpHttpApp {
  handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void>;
  manager: McpSessionManager;
}

/**
 * Create an HTTP request handler for ledger-mcp.
 *
 * Routes:
 *   GET  /health  — liveness probe, no auth required
 *   *    /mcp     — Streamable HTTP MCP endpoint (bearer-guarded when mcpToken is set)
 *   *    other    — 404
 */
export function createLedgerMcpHttpApp(options: LedgerMcpHttpAppOptions = {}): LedgerMcpHttpApp {
  const factory: McpServerFactory =
    options.serverFactory ?? (() => createLedgerServer(new LedgerClient()));
  const manager = new McpSessionManager(factory);

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '';

    if (req.method === 'GET' && url === '/health') {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok', service: 'ledger-mcp' }));
      return;
    }

    if (url === '/mcp' || url.startsWith('/mcp?') || url.startsWith('/mcp/')) {
      if (options.mcpToken && !checkBearerToken(req, options.mcpToken)) {
        writeUnauthorized(res);
        return;
      }
      await manager.handleRequest(req, res);
      return;
    }

    res.writeHead(404);
    res.end();
  }

  return { handleRequest, manager };
}
