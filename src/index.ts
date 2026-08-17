// Worker entry. Routes to:
//   /mcp2      — McpAgent (OAuth 2.1 protected, via OAuthProvider) — canonical endpoint
//   /mcp-api   — ApiAgent (bearer-token protected, fail-closed)
//   /mcp       — DECOMMISSIONED (Phase 4) — returns 410 Gone; migrate to /mcp2
//   /authorize — OAuth consent form
//   /health, /api/v1/* — operational endpoints (no auth)
//
// Phase 4: /mcp retired. All requests return 410 Gone with migration instructions.
// Ch1ttyDO is kept exported so the Cloudflare migration chain (v1 tag) stays intact;
// the CH1TTY binding remains in wrangler.jsonc until all DO instances are drained.
import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { Ch1ttyDO } from './ch1tty-do.js';
import { Ch1ttyMcpAgent } from './mcp-agent.js';
import { Ch1ttyApiAgent } from './api-agent.js';
import { handleAuthorize } from './oauth-authorize.js';
import { handleMcpDeprecated } from './mcp-deprecated.js';
import type { Env } from './types.js';
import { VERSION } from './utils.js';

export { Ch1ttyDO, Ch1ttyMcpAgent, Ch1ttyApiAgent };

/** Bearer check for /mcp-api (static token, fail-closed). */
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

    // /mcp — DECOMMISSIONED (Phase 4). Returns 410 Gone for all methods.
    if (path === '/mcp') {
      return handleMcpDeprecated(req);
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

  // All other routes (health, /mcp 410 tombstone, /mcp-api, /authorize, etc.).
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
