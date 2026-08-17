// Worker entry. Routes to:
//   /mcp2      — McpAgent (OAuth 2.1 protected, via OAuthProvider)
//   /mcp-api   — ApiAgent (bearer-token protected, fail-closed)
//   /mcp       — Legacy DO path (bearer-token, fail-open when unset)
//   /authorize — OAuth consent form
//   /health, /api/v1/* — operational endpoints (no auth)
//
// Phase 3: /mcp2 moved behind OAuthProvider. Clients get tokens via the
// /authorize → /oauth/token flow instead of a static bearer secret.
// The legacy /mcp path keeps its existing fail-open bearer semantics.
import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { Ch1ttyDO } from './ch1tty-do.js';
import { Ch1ttyMcpAgent } from './mcp-agent.js';
import { Ch1ttyApiAgent } from './api-agent.js';
import { handleAuthorize } from './oauth-authorize.js';
import type { Env } from './types.js';
import { VERSION } from './utils.js';

export { Ch1ttyDO, Ch1ttyMcpAgent, Ch1ttyApiAgent };

function mintSessionId(): string {
  return crypto.randomUUID();
}

/** Bearer check for the LEGACY /mcp DO path and /mcp-api (static token). */
function checkAuth(req: Request, token?: string): boolean {
  if (!token) return true; // no token configured → open (warned at deploy)
  const auth = req.headers.get('authorization');
  if (!auth) return false;
  const [scheme, value] = auth.split(' ', 2);
  const enc = new TextEncoder();
  const ab = enc.encode(value ?? '');
  const bb = enc.encode(token);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return scheme?.toLowerCase() === 'bearer' && diff === 0;
}

// The McpAgent handler for /mcp2 — receives requests that passed OAuth validation.
const mcp2Handler = {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return Ch1ttyMcpAgent.serve('/mcp2', { binding: 'MCP_OBJECT' }).fetch(req, env, ctx);
  },
};

// All routes except /mcp2 (which OAuthProvider handles).
const defaultHandler = {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // Health — no auth.
    if (req.method === 'GET' && path === '/health') {
      return Response.json({ status: 'ok', service: 'ch1tty', version: VERSION });
    }

    // Per-session status / health snapshot: GET /api/v1/status?session=<id>.
    if (req.method === 'GET' && (path === '/api/v1/status' || path === '/api/v1/health')) {
      const sessionId = url.searchParams.get('session') ?? 'default';
      const id = env.CH1TTY.idFromName(sessionId);
      const stub = env.CH1TTY.get(id);
      const doReq = new Request('https://do/status', { method: 'GET' });
      const res = await stub.fetch(doReq);
      const snap = await res.json();
      if (path === '/api/v1/health') {
        const status = (snap as { systemHealth?: { status?: string } }).systemHealth?.status ?? 'ok';
        return Response.json(
          { status, service: 'ch1tty', systemHealth: (snap as { systemHealth?: unknown }).systemHealth },
          { status: status === 'degraded' ? 503 : 200 },
        );
      }
      return Response.json(snap);
    }

    // OAuth consent form — GET shows the form, POST processes it.
    if (path === '/authorize') {
      return handleAuthorize(req, env as Parameters<typeof handleAuthorize>[1]);
    }

    // openApiMcpServer surface: typed search+execute over the ch1tty tool
    // registry exposed as an OpenAPI 3.1 spec. Fail-closed bearer auth.
    if (path === '/mcp-api' || path.startsWith('/mcp-api/')) {
      const tokenSecret = typeof env.CH1TTY_MCP_TOKEN === 'string' && env.CH1TTY_MCP_TOKEN
        ? env.CH1TTY_MCP_TOKEN : undefined;
      if (!tokenSecret) {
        return Response.json(
          { error: 'POLICY_BLOCKED_MCPAPI_TOKEN_UNBOUND', message: 'CH1TTY_MCP_TOKEN is not configured; /mcp-api refuses to serve unauthenticated.' },
          { status: 503 },
        );
      }
      if (!checkAuth(req, tokenSecret)) {
        return Response.json({ error: 'unauthorized' }, { status: 401 });
      }
      return Ch1ttyApiAgent.serve('/mcp-api', { binding: 'API_OBJECT' }).fetch(req, env, ctx);
    }

    // MCP endpoint (legacy JSON-RPC DO path — untouched; fail-open when no token).
    if (path === '/mcp') {
      const tokenSecret = typeof env.CH1TTY_MCP_TOKEN === 'string' ? env.CH1TTY_MCP_TOKEN : undefined;
      if (!checkAuth(req, tokenSecret)) {
        return Response.json({ error: 'unauthorized' }, { status: 401 });
      }
      const sessionId = req.headers.get('mcp-session-id') ?? mintSessionId();
      const id = env.CH1TTY.idFromName(sessionId);
      const stub = env.CH1TTY.get(id);
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

export default new OAuthProvider<Env>({
  // /mcp2 is OAuth-protected — OAuthProvider validates the bearer token
  // before forwarding to mcp2Handler. Unauthenticated requests receive a 401
  // with a WWW-Authenticate challenge that MCP clients can follow.
  apiRoute: '/mcp2',
  apiHandler: mcp2Handler,

  // All other routes (health, legacy /mcp, /mcp-api, /authorize, etc.).
  defaultHandler,

  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/oauth/token',

  // DCR lets clients register themselves without pre-coordination.
  clientRegistrationEndpoint: '/oauth/register',

  scopesSupported: ['mcp'],

  resourceMetadata: {
    resource: 'https://ch1tty.chitty.cc/mcp2',
    authorization_servers: ['https://ch1tty.chitty.cc'],
    scopes_supported: ['mcp'],
    bearer_methods_supported: ['header'],
    resource_name: 'Ch1tty MCP Gateway',
  },

  // Enables client-id metadata document discovery (RFC 9728 / CIMD).
  // Requires global_fetch_strictly_public (already set in wrangler.jsonc).
  clientIdMetadataDocumentEnabled: true,
});
