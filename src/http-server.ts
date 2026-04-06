/**
 * HTTP server for ch1tty MCP gateway.
 *
 * Express-based, providing:
 *   GET  /.well-known/oauth-authorization-server  — RFC 8414 AS metadata
 *   GET  /.well-known/oauth-protected-resource/mcp — RFC 9728 RS metadata
 *   GET  /authorize                                — OAuth authorization endpoint
 *   POST /token                                    — OAuth token endpoint
 *   POST /register                                 — Dynamic client registration (RFC 7591)
 *   POST /revoke                                   — Token revocation
 *   GET  /health                                   — Liveness probe
 *   GET  /api/v1/status                            — Full gateway snapshot
 *   *    /mcp                                      — Streamable HTTP MCP transport
 */
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createServer, type Server as NodeHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import type { Aggregator } from './aggregator.js';
import { createMcpServer } from './mcp-server.js';
import { VERSION } from './utils.js';
import { Ch1ttyOAuthProvider } from './auth-provider.js';
import { ChittyTaskClient } from './task-client.js';

export interface HttpServerOptions {
  port: number;
  bindAddress?: string;
  /** Enable the /mcp endpoint for remote MCP clients */
  enableMcp?: boolean;
  /** Bearer token for legacy direct-token auth. Also used as the gateway approval secret for OAuth authorize. */
  mcpToken?: string;
  /** The public-facing base URL (e.g. https://ch1tty.chitty.cc). Required for OAuth metadata. */
  publicUrl?: string;
}

export class HttpServer {
  private server: NodeHttpServer;
  private port: number;
  private bindAddress: string;
  private sessions = new Map<string, StreamableHTTPServerTransport>();
  private oauthProvider: Ch1ttyOAuthProvider | undefined;
  private taskClient = new ChittyTaskClient();

  constructor(
    private aggregator: Aggregator,
    private options: HttpServerOptions,
  ) {
    this.port = options.port;
    this.bindAddress = options.bindAddress ?? '0.0.0.0';

    const app = express();

    // Determine base URL for OAuth metadata
    const baseUrl = options.publicUrl
      ?? `http://localhost:${this.port}`;

    // ── OAuth routes ──────────────────────────────────────────────
    if (options.enableMcp) {
      this.oauthProvider = new Ch1ttyOAuthProvider(options.mcpToken);

      const issuerUrl = new URL(baseUrl);
      const resourceServerUrl = new URL('/mcp', baseUrl);

      app.use(mcpAuthRouter({
        provider: this.oauthProvider,
        issuerUrl,
        resourceServerUrl,
        resourceName: 'ch1tty MCP Gateway',
        scopesSupported: ['mcp:tools', 'mcp:resources', 'mcp:prompts'],
        clientRegistrationOptions: { rateLimit: false },
        authorizationOptions: { rateLimit: false },
        tokenOptions: { rateLimit: false },
        revocationOptions: { rateLimit: false },
      }));
    }

    // ── CORS ──────────────────────────────────────────────────────
    app.use((_req: Request, res: Response, next: NextFunction) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
      next();
    });

    // Handle CORS preflight for all routes
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
        res.setHeader('Access-Control-Max-Age', '86400');
        res.status(204).end();
        return;
      }
      next();
    });

    // ── Health & status ───────────────────────────────────────────
    app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', service: 'ch1tty', version: VERSION });
    });

    app.get('/api/v1/status', (_req: Request, res: Response) => {
      try {
        res.json(this.aggregator.getStatusSnapshot());
      } catch {
        res.json({ status: 'ok', service: 'ch1tty', version: VERSION, transport: 'stdio' });
      }
    });

    // ── MCP endpoint ──────────────────────────────────────────────
    if (options.enableMcp) {
      // Bearer auth middleware for /mcp — validates OAuth tokens
      const bearerAuth = this.oauthProvider
        ? requireBearerAuth({
            verifier: this.oauthProvider,
            resourceMetadataUrl: new URL('/.well-known/oauth-protected-resource/mcp', baseUrl).href,
          })
        : undefined;

      const mcpHandler = async (req: Request, res: Response) => {
        try {
          await this.handleMcp(req, res);
        } catch (err) {
          process.stderr.write(`[ch1tty:mcp] Request error: ${err}\n`);
          if (!res.headersSent) {
            res.status(500).json({ error: 'internal server error' });
          }
        }
      };

      if (bearerAuth) {
        app.get('/api/v1/tasks', bearerAuth, (req, res) => void this.handleTaskList(req, res));
        app.post('/api/v1/tasks', bearerAuth, express.json(), (req, res) => void this.handleTaskCreate(req, res));
        app.get('/api/v1/tasks/:taskId', bearerAuth, (req, res) => void this.handleTaskGet(req, res));
        app.patch('/api/v1/tasks/:taskId', bearerAuth, express.json(), (req, res) => void this.handleTaskUpdate(req, res));
        app.all('/mcp', bearerAuth, mcpHandler);
      } else {
        app.all('/mcp', mcpHandler);
      }
    }

    // ── 404 fallthrough ───────────────────────────────────────────
    app.use((_req: Request, res: Response) => {
      res.status(404).json({ error: 'not found' });
    });

    this.server = createServer(app);
  }

  private async handleMcp(req: Request, res: Response): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && this.sessions.has(sessionId)) {
      const transport = this.sessions.get(sessionId)!;
      await transport.handleRequest(req, res);
      return;
    }

    if (sessionId && !this.sessions.has(sessionId)) {
      res.status(404).json({ error: 'session not found' });
      return;
    }

    // New session
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

  private async handleTaskList(req: Request, res: Response): Promise<void> {
    try {
      if (!this.taskClient.isConfigured()) {
        res.status(503).json({ error: 'task_management_unconfigured' });
        return;
      }

      const payload = await this.taskClient.listTasks({
        sessionId: queryString(req.query.sessionId) ?? this.deriveTaskSessionId(req),
        status: queryString(req.query.status),
        limit: queryNumber(req.query.limit),
      }, this.taskContextFromRequest(req));

      res.json(payload);
    } catch (err) {
      res.status(502).json({ error: 'task_proxy_failed', message: String(err) });
    }
  }

  private async handleTaskCreate(req: Request, res: Response): Promise<void> {
    try {
      if (!this.taskClient.isConfigured()) {
        res.status(503).json({ error: 'task_management_unconfigured' });
        return;
      }

      const title = bodyString(req.body?.title);
      if (!title) {
        res.status(400).json({ error: 'title_required' });
        return;
      }

      const payload = await this.taskClient.createTask({
        title,
        description: bodyString(req.body?.description),
        taskType: bodyString(req.body?.taskType),
        priority: bodyString(req.body?.priority),
        metadata: bodyRecord(req.body?.metadata),
        sessionId: bodyString(req.body?.sessionId) ?? this.deriveTaskSessionId(req),
      }, this.taskContextFromRequest(req));

      res.status(201).json(payload);
    } catch (err) {
      res.status(502).json({ error: 'task_proxy_failed', message: String(err) });
    }
  }

  private async handleTaskGet(req: Request, res: Response): Promise<void> {
    try {
      if (!this.taskClient.isConfigured()) {
        res.status(503).json({ error: 'task_management_unconfigured' });
        return;
      }

      const taskId = Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId;
      const payload = await this.taskClient.getTask(taskId);
      res.json(payload);
    } catch (err) {
      res.status(502).json({ error: 'task_proxy_failed', message: String(err) });
    }
  }

  private async handleTaskUpdate(req: Request, res: Response): Promise<void> {
    try {
      if (!this.taskClient.isConfigured()) {
        res.status(503).json({ error: 'task_management_unconfigured' });
        return;
      }

      const taskId = Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId;
      const payload = await this.taskClient.updateTask(taskId, {
        status: bodyString(req.body?.status),
        title: bodyString(req.body?.title),
        description: bodyString(req.body?.description),
        priority: bodyString(req.body?.priority),
        assignedService: bodyString(req.body?.assignedService),
        result: bodyRecord(req.body?.result),
        error: bodyString(req.body?.error),
      }, this.taskContextFromRequest(req));

      res.json(payload);
    } catch (err) {
      res.status(502).json({ error: 'task_proxy_failed', message: String(err) });
    }
  }

  private deriveTaskSessionId(req: Request): string | undefined {
    return bodyString(req.headers['mcp-session-id']) ?? req.auth?.clientId;
  }

  private taskContextFromRequest(req: Request): {
    sessionId?: string;
    auth?: {
      clientId?: string;
      scopes?: string[];
      token?: string;
    };
  } {
    return {
      sessionId: this.deriveTaskSessionId(req),
      auth: req.auth
        ? {
            clientId: req.auth.clientId,
            scopes: req.auth.scopes,
            token: req.auth.token,
          }
        : undefined,
    };
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

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function queryNumber(value: unknown): number | undefined {
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function bodyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function bodyRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}
