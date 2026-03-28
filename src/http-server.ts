import { createServer, type Server as NodeHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Aggregator } from './aggregator.js';
import { createMcpServer } from './mcp-server.js';
import { VERSION } from './utils.js';

export interface HttpServerOptions {
  port: number;
  bindAddress?: string;
  /** Enable the /mcp endpoint for remote MCP clients */
  enableMcp?: boolean;
  /** Bearer token required for /mcp access. If unset, no auth is enforced. */
  mcpToken?: string;
}

/**
 * HTTP server providing:
 *   GET  /health       — liveness probe
 *   GET  /api/v1/status — full gateway snapshot
 *   *    /mcp          — Streamable HTTP MCP transport (tools, resources, prompts)
 *
 * The /mcp endpoint lets remote clients (CF Agents, ChatGPT, other MCP clients)
 * access all ch1tty backends — including local stdio servers like Neon that can't
 * run on Cloudflare Workers.
 */
export class HttpServer {
  private server: NodeHttpServer;
  private port: number;
  private bindAddress: string;
  private sessions = new Map<string, StreamableHTTPServerTransport>();

  constructor(
    private aggregator: Aggregator,
    private options: HttpServerOptions,
  ) {
    this.port = options.port;
    this.bindAddress = options.bindAddress ?? '0.0.0.0';

    this.server = createServer(async (req, res) => {
      try {
        await this.handleRequest(req, res);
      } catch (err) {
        process.stderr.write(`[ch1tty:http] Request error: ${err}\n`);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'internal server error' }));
        }
      }
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id',
        'Access-Control-Expose-Headers': 'Mcp-Session-Id',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    // Add CORS headers to all responses
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

    switch (url.pathname) {
      case '/health':
        this.handleHealth(res);
        return;

      case '/api/v1/status':
        this.handleStatus(res);
        return;

      case '/mcp':
        if (this.options.enableMcp) {
          await this.handleMcp(req, res);
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'MCP endpoint not enabled' }));
        }
        return;

      default:
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
    }
  }

  private handleHealth(res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'ch1tty', version: VERSION }));
  }

  private handleStatus(res: ServerResponse): void {
    try {
      const snapshot = this.aggregator.getStatusSnapshot();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(snapshot));
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'ch1tty', version: VERSION, transport: 'stdio' }));
    }
  }

  private async handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Auth check
    if (this.options.mcpToken) {
      const auth = req.headers.authorization;
      if (!auth || auth !== `Bearer ${this.options.mcpToken}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
    }

    // Check for existing session
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && this.sessions.has(sessionId)) {
      // Existing session — route to its transport
      const transport = this.sessions.get(sessionId)!;
      await transport.handleRequest(req, res);
      return;
    }

    if (sessionId && !this.sessions.has(sessionId)) {
      // Unknown session ID
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'session not found' }));
      return;
    }

    // New session — create transport + server
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        this.sessions.set(newSessionId, transport);
        process.stderr.write(`[ch1tty:mcp] Session started: ${newSessionId}\n`);
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        this.sessions.delete(transport.sessionId);
        process.stderr.write(`[ch1tty:mcp] Session closed: ${transport.sessionId}\n`);
      }
    };

    const mcpServer = createMcpServer(this.aggregator);
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.bindAddress, () => {
        this.server.removeListener('error', reject);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    // Close all active MCP sessions
    for (const [id, transport] of this.sessions) {
      try {
        await transport.close();
      } catch {
        process.stderr.write(`[ch1tty:mcp] Error closing session ${id}\n`);
      }
    }
    this.sessions.clear();

    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }
}
