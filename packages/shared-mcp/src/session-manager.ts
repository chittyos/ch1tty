import type { IncomingMessage, ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

/** Factory that creates an MCP Server for a new session. */
export type McpServerFactory = (getSessionId: () => string | undefined) => Server;

interface McpSession {
  server: Server;
  transport: StreamableHTTPServerTransport;
}

/**
 * Manages MCP session lifecycle over Streamable HTTP transport.
 *
 * Each POST to /mcp without an Mcp-Session-Id header creates a new session.
 * Subsequent requests carrying the session ID are routed to the existing session.
 * Sessions are cleaned up when the transport closes.
 */
export class McpSessionManager {
  private readonly sessions = new Map<string, McpSession>();

  constructor(private readonly createServer: McpServerFactory) {}

  /** Called when a new session is created. Override to hook session lifecycle. */
  onSessionStart?: (sessionId: string) => void;

  /** Called when a session's transport closes. Override to hook session lifecycle. */
  onSessionEnd?: (sessionId: string) => void;

  /** Handle a single HTTP request, routing to an existing session or creating one. */
  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res);
      return;
    }

    if (req.method === 'POST' && !sessionId) {
      let mcpSessionId: string | undefined;
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (newSessionId) => {
          mcpSessionId = newSessionId;
          this.sessions.set(newSessionId, { server: mcpServer, transport });
          this.onSessionStart?.(newSessionId);
        },
      });

      const mcpServer = this.createServer(() => mcpSessionId);

      let isClosing = false;
      transport.onclose = () => {
        if (isClosing) return;
        isClosing = true;
        const sid = [...this.sessions.entries()].find(([, s]) => s.transport === transport)?.[0];
        if (sid) {
          this.sessions.delete(sid);
          this.onSessionEnd?.(sid);
        }
        mcpServer.close().catch(() => {});
      };

      try {
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res);
      } catch {
        if (!res.headersSent) {
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(500);
          res.end(JSON.stringify({ error: 'internal' }));
        } else if (!res.writableEnded) {
          res.end();
        }
      }
      return;
    }

    res.setHeader('Content-Type', 'application/json');
    res.writeHead(400);
    res.end(JSON.stringify({ error: 'bad request', message: 'Missing or invalid session' }));
  }

  /** Close all active sessions and clean up resources. */
  async closeAll(): Promise<void> {
    for (const session of this.sessions.values()) {
      await session.transport.close().catch(() => {});
      await session.server.close().catch(() => {});
    }
    this.sessions.clear();
  }

  /** Number of currently active sessions. */
  get sessionCount(): number {
    return this.sessions.size;
  }
}
