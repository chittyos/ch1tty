// Worker entry. Replaces the stdio main() (Server + StdioServerTransport) and
// the node:http HttpMcpServer. The router Worker resolves a session id from the
// `mcp-session-id` header (or mints one), then forwards the MCP request to the
// per-session Durable Object Ch1ttyDO addressed by idFromName(sessionId).
// Never one mega-DO — one DO per session (the coordinator already sharded ~32
// sessions; here each is its own isolate with its own SQLite + circuit state).
import { Ch1ttyDO } from './ch1tty-do.js';
import type { Env } from './types.js';
import { VERSION } from './utils.js';

export { Ch1ttyDO };

function mintSessionId(): string {
  return crypto.randomUUID();
}

function checkAuth(req: Request, token?: string): boolean {
  if (!token) return true; // no token configured → open (warned at deploy)
  const auth = req.headers.get('authorization');
  if (!auth) return false;
  const [scheme, value] = auth.split(' ', 2);
  return scheme?.toLowerCase() === 'bearer' && value === token;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // Health — no auth.
    if (req.method === 'GET' && (path === '/health')) {
      return Response.json({ status: 'ok', service: 'ch1tty', version: VERSION });
    }

    // Per-session status snapshot (operational): GET /api/v1/status?session=<id>.
    if (req.method === 'GET' && (path === '/api/v1/status' || path === '/api/v1/health')) {
      const sessionId = url.searchParams.get('session') ?? 'default';
      const id = env.CH1TTY.idFromName(sessionId);
      const stub = env.CH1TTY.get(id);
      const doReq = new Request(`https://do/status`, { method: 'GET' });
      const res = await stub.fetch(doReq);
      const snap = await res.json();
      if (path === '/api/v1/health') {
        const status = (snap as { systemHealth?: { status?: string } }).systemHealth?.status ?? 'ok';
        return Response.json({ status, service: 'ch1tty', systemHealth: (snap as { systemHealth?: unknown }).systemHealth }, { status: status === 'degraded' ? 503 : 200 });
      }
      return Response.json(snap);
    }

    // MCP endpoint.
    if (path === '/mcp') {
      const tokenSecret = typeof env.CH1TTY_MCP_TOKEN === 'string' ? env.CH1TTY_MCP_TOKEN : undefined;
      if (!checkAuth(req, tokenSecret)) {
        return Response.json({ error: 'unauthorized' }, { status: 401 });
      }
      const sessionId = req.headers.get('mcp-session-id') ?? mintSessionId();
      const id = env.CH1TTY.idFromName(sessionId);
      const stub = env.CH1TTY.get(id);

      // Forward the body + the (possibly minted) session id to the DO.
      const fwd = new Request('https://do/mcp', {
        method: req.method,
        headers: (() => {
          const h = new Headers(req.headers);
          h.set('mcp-session-id', sessionId);
          return h;
        })(),
        body: req.method === 'POST' ? await req.text() : undefined,
      });
      return stub.fetch(fwd);
    }

    return Response.json({ error: 'not found' }, { status: 404 });
  },
};
