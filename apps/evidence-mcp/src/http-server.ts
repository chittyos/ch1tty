import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  McpSessionManager,
  checkBearerToken,
  writeUnauthorized,
} from '@ch1tty/shared-mcp';
import type { McpServerFactory } from '@ch1tty/shared-mcp';
import { createEvidenceServer } from './server.js';
import { EvidenceClient } from './evidence-client.js';

export { McpSessionManager };
export type { McpServerFactory };

export interface EvidenceHttpAppOptions {
  mcpToken?: string;
  serverFactory?: McpServerFactory;
}

export interface EvidenceHttpApp {
  handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void>;
  manager: McpSessionManager;
}

/**
 * Create an HTTP request handler for evidence-mcp.
 *
 * Routes:
 *   GET  /health  — liveness probe, no auth required
 *   *    /mcp     — Streamable HTTP MCP endpoint (bearer-guarded when mcpToken is set)
 *   *    other    — 404
 */
export function createEvidenceHttpApp(options: EvidenceHttpAppOptions = {}): EvidenceHttpApp {
  const factory: McpServerFactory =
    options.serverFactory ?? (() => createEvidenceServer(new EvidenceClient()));
  const manager = new McpSessionManager(factory);

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '';

    if (req.method === 'GET' && url === '/health') {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok', service: 'evidence-mcp' }));
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
