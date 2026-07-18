// Worker entry. Replaces the stdio main() (Server + StdioServerTransport) and
// the node:http HttpMcpServer. The router Worker resolves a session id from the
// `mcp-session-id` header (or mints one), then forwards the MCP request to the
// per-session Durable Object Ch1ttyDO addressed by idFromName(sessionId).
// Never one mega-DO — one DO per session (the coordinator already sharded ~32
// sessions; here each is its own isolate with its own SQLite + circuit state).
import { Ch1ttyDO } from './ch1tty-do.js';
import { Ch1ttyMcpAgent } from './mcp-agent.js';
import type { Env } from './types.js';
import { VERSION } from './utils.js';

export { Ch1ttyDO, Ch1ttyMcpAgent };

function mintSessionId(): string {
  return crypto.randomUUID();
}

/** Constant-time string compare — avoids leaking token length/prefix via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  // Compare fixed-length UTF-8 byte views. Length difference still returns
  // false, but the byte loop runs over max(len) so it doesn't short-circuit on
  // the first differing byte.
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Bearer check for the LEGACY /mcp DO path. Preserves prior behavior: when no
 * token is configured it stays open (warned at deploy). The new /mcp2 surface
 * does NOT use this — it fails closed (see fetch()), because it exposes `code`
 * (sandboxed code exec) and `provision` (infra mutation).
 */
function checkAuth(req: Request, token?: string): boolean {
  if (!token) return true; // no token configured → open (warned at deploy)
  const auth = req.headers.get('authorization');
  if (!auth) return false;
  const [scheme, value] = auth.split(' ', 2);
  return scheme?.toLowerCase() === 'bearer' && typeof value === 'string' && timingSafeEqual(value, token);
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

    // McpAgent transport (streamable HTTP via Agents SDK). Parallel to the
    // legacy DO path at /mcp — same bearer check, same Ch1ttyCore underneath.
    if (path === '/mcp2' || path.startsWith('/mcp2/')) {
      const tokenSecret = typeof env.CH1TTY_MCP_TOKEN === 'string' && env.CH1TTY_MCP_TOKEN
        ? env.CH1TTY_MCP_TOKEN : undefined;
      // FAIL CLOSED: /mcp2 exposes code (sandbox exec) + provision (infra
      // mutation). Unlike the legacy /mcp path, an unbound token is a
      // misconfiguration, not "open" — refuse rather than expose these tools.
      if (!tokenSecret) {
        return Response.json(
          { error: 'POLICY_BLOCKED_MCP2_TOKEN_UNBOUND', message: 'CH1TTY_MCP_TOKEN is not configured; /mcp2 refuses to serve unauthenticated.' },
          { status: 503 },
        );
      }
      if (!checkAuth(req, tokenSecret)) {
        return Response.json({ error: 'unauthorized' }, { status: 401 });
      }
      return Ch1ttyMcpAgent.serve('/mcp2', { binding: 'MCP_OBJECT' }).fetch(req, env, ctx);
    }

    // MCP endpoint (legacy JSON-RPC DO path — untouched).
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
