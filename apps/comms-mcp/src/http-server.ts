import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  McpSessionManager,
  checkBearerToken,
  writeUnauthorized,
} from '@ch1tty/shared-mcp';
import type { McpServerFactory } from '@ch1tty/shared-mcp';
import { McpClientDispatch } from './dispatch.js';
import { createCommsMcpServer } from './server.js';
import type { OwnerIdentity } from './types.js';

export { McpSessionManager };
export type { McpServerFactory };

function ownerIdentity(): OwnerIdentity {
  const raw = process.env['COMMS_MCP_OWNER_IDENTIFIERS'] ?? '';
  return {
    identifiers: raw.split(',').map((s) => s.trim()).filter(Boolean),
    displayName: process.env['COMMS_MCP_OWNER_DISPLAY_NAME'] ?? null,
    chittyId: process.env['COMMS_MCP_OWNER_CHITTYID'] ?? null,
  };
}

export interface CommsHttpAppOptions {
  mcpToken?: string;
  serverFactory?: McpServerFactory;
}

export interface CommsHttpApp {
  handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void>;
  manager: McpSessionManager;
}

/**
 * Create an HTTP request handler for comms-mcp.
 *
 * Routes:
 *   GET  /health  — liveness probe, no auth required
 *   *    /mcp     — Streamable HTTP MCP endpoint (bearer-guarded when mcpToken is set)
 *   *    other    — 404
 */
export function createCommsHttpApp(options: CommsHttpAppOptions = {}): CommsHttpApp {
  const factory: McpServerFactory =
    options.serverFactory ?? (() => createCommsMcpServer(new McpClientDispatch(), ownerIdentity()));
  const manager = new McpSessionManager(factory);

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '';

    if (req.method === 'GET' && url === '/health') {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok', service: 'comms-mcp' }));
      return;
    }

    if (url === '/mcp' || url.startsWith('/mcp?') || url.startsWith('/mcp/')) {
      // Reject browser-originated requests to prevent DNS rebinding (CWE-346).
      // comms-mcp is a server-to-server service; no browser Origin is expected.
      if (req.headers['origin'] !== undefined) {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(403);
        res.end(JSON.stringify({ error: 'forbidden' }));
        return;
      }
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
