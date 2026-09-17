import { handleGptAction } from './gpt-actions.js';
import { handleOpenClawRoute } from './openclaw-facade.js';
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { checkBearerToken, McpSessionManager, writeUnauthorized } from '@ch1tty/shared-mcp';
import type { Aggregator } from './aggregator.js';
import { VERSION } from './utils.js';
import { log } from './logger.js';

export interface HttpServerOptions {
  port: number;
  bindAddress?: string;
  mcpToken?: string;
}

export class HttpMcpServer {
  private server: HttpServer;
  private port: number;
  private bindAddress: string;
  private mcpToken?: string;
  private mcpSessionManager: McpSessionManager;
  private boundPort: number | null = null;

  constructor(private aggregator: Aggregator, options: HttpServerOptions) {
    this.port = options.port;
    this.bindAddress = options.bindAddress ?? '0.0.0.0';
    this.mcpToken = options.mcpToken;

    this.mcpSessionManager = new McpSessionManager((getSessionId) => this.createMcpServer(getSessionId));
    this.mcpSessionManager.onSessionStart = (sessionId) => {
      this.aggregator.sessions.getOrCreate(sessionId, 'http');
      this.aggregator.coordinator.onSessionStart(sessionId, 'http');
    };
    this.mcpSessionManager.onSessionEnd = (sessionId) => {
      this.aggregator.sessions.remove(sessionId);
      this.aggregator.coordinator.onSessionEnd(sessionId);
    };

    this.server = createServer((req, res) => this.handleRequest(req, res));
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    /* c8 ignore next -- req.url is always defined for a real HTTP request */
    const url = req.url ?? '/';
    /* c8 ignore next -- split('?',1)[0] is always defined since url is req.url ?? '/' */
    const path = url.split('?', 1)[0] ?? '/';

    // GPT Actions facade
    if (path.startsWith('/gpt-actions')) {
      const sessionId = 'gpt-actions-' + (req.headers['x-conversation-id'] || 'default');
      if (handleGptAction(this.aggregator, sessionId, req, res, url)) return;
    }

    // OpenClaw facade
    if (path.startsWith('/openclaw')) {
      if (handleOpenClawRoute(this.aggregator, req, res, url)) return;
    }

    // Health endpoints — no auth required
    if (req.method === 'GET' && path === '/health') {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok', service: 'ch1tty', version: VERSION }));
      return;
    }

    if (req.method === 'GET' && path === '/api/v1/health') {
      res.setHeader('Content-Type', 'application/json');
      try {
        const { systemHealth, ledgerDlq } = this.aggregator.getStatusSnapshot();
        const httpStatus = systemHealth.status === 'degraded' ? 503 : 200;
        res.writeHead(httpStatus);
        const body: Record<string, unknown> = { status: systemHealth.status, service: 'ch1tty', systemHealth };
        if (httpStatus === 503) body.ledgerDlq = { entryCount: ledgerDlq.entryCount };
        if (systemHealth.status === 'warn' && systemHealth.brainDegraded) body.brainCircuitOpen = true;
        if (systemHealth.status === 'warn' && systemHealth.ledgerStatus === 'warn') body.ledgerWarn = true;
        if (systemHealth.status === 'ok' && systemHealth.ledgerStatus === 'ok') body.ledgerOk = true;
        res.end(JSON.stringify(body));
      } catch (err) {
        log.error(`Health check failed: ${err}`);
        res.writeHead(503);
        res.end(JSON.stringify({ status: 'degraded', service: 'ch1tty', error: 'internal' }));
      }
      return;
    }

    if (req.method === 'GET' && path === '/api/v1/status') {
      res.setHeader('Content-Type', 'application/json');
      try {
        const snapshot = this.aggregator.getStatusSnapshot();
        res.writeHead(200);
        res.end(JSON.stringify(snapshot));
      } catch (err) {
        // Never lie about health — log and surface a real 500 so monitors can detect the condition.
        log.error(`Status snapshot failed: ${err}`);
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'internal', service: 'ch1tty', version: VERSION }));
      }
      return;
    }

    // Sessions snapshot (operational)
    if (req.method === 'GET' && path === '/api/v1/sessions') {
      if (this.mcpToken && !checkBearerToken(req, this.mcpToken)) return writeUnauthorized(res);
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify({ sessions: this.aggregator.sessions.listSessions() }));
      return;
    }

    // MCP endpoint — bearer token required if configured
    if (path === '/mcp') {
      if (this.mcpToken && !checkBearerToken(req, this.mcpToken)) {
        writeUnauthorized(res);
        return;
      }

      void this.mcpSessionManager.handleRequest(req, res);
      return;
    }

    res.setHeader('Content-Type', 'application/json');
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  }

  private createMcpServer(getSessionId: () => string | undefined): Server {
    const server = new Server(
      { name: 'ch1tty', version: VERSION },
      { capabilities: { tools: {}, resources: {}, prompts: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return this.aggregator.listAllTools();
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      return this.aggregator.callTool(name, (args ?? {}) as Record<string, unknown>, getSessionId());
    });

    server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return this.aggregator.listAllResources();
    });

    server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
      return this.aggregator.listAllResourceTemplates();
    });

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      return this.aggregator.readResource(request.params.uri);
    });

    server.setRequestHandler(ListPromptsRequestSchema, async () => {
      return this.aggregator.listAllPrompts();
    });

    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      return this.aggregator.getPrompt(name, args);
    });

    return server;
  }

  start(): Promise<void> {
    // B2 — auth fail-closed guard. When no mcpToken is set, refuse to serve non-loopback
    // unless CH1TTY_ALLOW_UNAUTH=1 is explicitly set. Emit a loud warning either way.
    const loopback = this.bindAddress === '127.0.0.1' || this.bindAddress === '::1' || this.bindAddress === 'localhost';
    if (!this.mcpToken) {
      if (!loopback && process.env.CH1TTY_ALLOW_UNAUTH !== '1') {
        return Promise.reject(new Error(
          `Refusing to bind ${this.bindAddress}:${this.port} without CH1TTY_MCP_TOKEN. ` +
          'Set CH1TTY_MCP_TOKEN, bind to loopback, or set CH1TTY_ALLOW_UNAUTH=1 to opt in.',
        ));
      }
      log.warn(
        `Starting HTTP server without CH1TTY_MCP_TOKEN — auth is DISABLED on ${this.bindAddress}:${this.port}. ` +
        'All API routes and /mcp are publicly reachable.',
      );
    }
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.bindAddress, () => {
        this.server.removeListener('error', reject);
        const addr = this.server.address();
        /* c8 ignore next -- addr is always a non-null AddressInfo object on a successful bind */
        this.boundPort = typeof addr === 'object' && addr ? addr.port : this.port;
        resolve();
      });
    });
  }

  getPort(): number {
    if (this.boundPort == null) return this.port;
    return this.boundPort;
  }

  async stop(): Promise<void> {
    await this.mcpSessionManager.closeAll();
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }
}
