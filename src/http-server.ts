import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Aggregator } from './aggregator.js';
import { VERSION } from './utils.js';

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
  private sessions = new Map<string, { server: Server; transport: StreamableHTTPServerTransport }>();

  constructor(private aggregator: Aggregator, options: HttpServerOptions) {
    this.port = options.port;
    this.bindAddress = options.bindAddress ?? '0.0.0.0';
    this.mcpToken = options.mcpToken;

    this.server = createServer((req, res) => this.handleRequest(req, res));
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/';

    // Health endpoints — no auth required
    if (req.method === 'GET' && url === '/health') {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok', service: 'ch1tty', version: VERSION }));
      return;
    }

    if (req.method === 'GET' && url === '/api/v1/status') {
      res.setHeader('Content-Type', 'application/json');
      try {
        const snapshot = this.aggregator.getStatusSnapshot();
        res.writeHead(200);
        res.end(JSON.stringify(snapshot));
      } catch {
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ok', service: 'ch1tty', version: VERSION }));
      }
      return;
    }

    // MCP endpoint — bearer token required if configured
    if (url === '/mcp') {
      if (this.mcpToken && !this.checkAuth(req)) {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }

      this.handleMcp(req, res);
      return;
    }

    res.setHeader('Content-Type', 'application/json');
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  }

  private checkAuth(req: IncomingMessage): boolean {
    const auth = req.headers.authorization;
    if (!auth) return false;
    const [scheme, token] = auth.split(' ', 2);
    return scheme?.toLowerCase() === 'bearer' && token === this.mcpToken;
  }

  private async handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Get or create session from Mcp-Session-Id header
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && this.sessions.has(sessionId)) {
      // Existing session
      const session = this.sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res);
      return;
    }

    if (req.method === 'POST' && !sessionId) {
      // New session — create server + transport
      let mcpSessionId: string | undefined;
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (newSessionId) => {
          mcpSessionId = newSessionId;
          this.sessions.set(newSessionId, { server: mcpServer, transport });
          this.aggregator.sessions.getOrCreate(newSessionId, 'http');
        },
      });

      const mcpServer = this.createMcpServer(() => mcpSessionId);

      // Clean up on close
      transport.onclose = () => {
        const sid = [...this.sessions.entries()].find(([, s]) => s.transport === transport)?.[0];
        if (sid) {
          this.sessions.delete(sid);
          this.aggregator.sessions.remove(sid);
        }
        mcpServer.close().catch(() => {});
      };

      await mcpServer.connect(transport);
      await transport.handleRequest(req, res);
      return;
    }

    // Invalid — no session ID on non-POST, or session not found
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(400);
    res.end(JSON.stringify({ error: 'bad request', message: 'Missing or invalid session' }));
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
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.bindAddress, () => {
        this.server.removeListener('error', reject);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    // Close all MCP sessions
    for (const [, session] of this.sessions) {
      await session.transport.close().catch(() => {});
      await session.server.close().catch(() => {});
    }
    this.sessions.clear();

    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }
}
