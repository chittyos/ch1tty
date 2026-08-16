// OAuth 2.1 authorization endpoint for the ch1tty gateway.
// Handles GET /authorize (consent form) and POST /authorize (token validation + grant).
//
// Auth model: the holder of CH1TTY_MCP_TOKEN is the admin and can authorize any
// OAuth client. This is the right model for a self-hosted MCP gateway where the
// operator is the sole user. The OAuthProvider issues short-lived access tokens
// from this single-grant-per-operator model.
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import type { Env } from './types.js';

// Duck-typed shape of AuthorizationError — avoids importing the class (which
// transitively loads cloudflare:workers, breaking the Node.js test runner).
interface AuthErrLike {
  code: string;
  description: string;
  redirectUri?: string;
  state?: string;
  issuer?: string;
}

function isAuthError(err: unknown): err is AuthErrLike {
  return (
    err !== null &&
    typeof err === 'object' &&
    typeof (err as AuthErrLike).code === 'string' &&
    typeof (err as AuthErrLike).description === 'string'
  );
}

// Local type — OAuthProvider injects OAUTH_PROVIDER at runtime; not in wrangler.jsonc.
type AuthEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };

/** Constant-time string comparison — avoids leaking token length via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function authorizeHtml(oauthParams: string, errorMsg?: string): string {
  const errorBlock = errorMsg
    ? `<p class="err">${escHtml(errorMsg)}</p>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Authorize — Ch1tty</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:system-ui,sans-serif;max-width:440px;margin:5rem auto;padding:0 1.25rem;color:#1a1a1a}
    h1{font-size:1.25rem;margin:0 0 .4rem}
    .sub{color:#555;margin:0 0 1.5rem}
    label{display:block;font-weight:600;font-size:.875rem;margin-bottom:.35rem}
    input[type=password]{width:100%;padding:.55rem .75rem;border:1px solid #ccc;border-radius:6px;font-size:1rem}
    input[type=password]:focus{outline:2px solid #0057ff;border-color:#0057ff}
    button{margin-top:1.1rem;padding:.6rem 1.5rem;background:#0057ff;color:#fff;border:none;border-radius:6px;font-size:1rem;cursor:pointer;font-weight:600}
    button:hover{background:#0041cc}
    .err{color:#c00;margin:0 0 1rem;font-size:.9rem}
  </style>
</head>
<body>
  <h1>Authorize Ch1tty</h1>
  <p class="sub">Enter your admin token to grant this client access.</p>
  ${errorBlock}
  <form method="POST">
    <input type="hidden" name="oauth_params" value="${escAttr(oauthParams)}">
    <label for="tok">Admin token</label>
    <input id="tok" type="password" name="token" autocomplete="current-password" required autofocus>
    <button type="submit">Authorize</button>
  </form>
</body>
</html>`;
}

function oauthErrorRedirect(err: AuthErrLike): Response {
  if (!err.redirectUri) {
    return new Response(err.description, { status: 400, headers: { 'Content-Type': 'text/plain' } });
  }
  const u = new URL(err.redirectUri);
  u.searchParams.set('error', err.code);
  u.searchParams.set('error_description', err.description);
  if (err.state) u.searchParams.set('state', err.state);
  if (err.issuer) u.searchParams.set('iss', err.issuer);
  return Response.redirect(u.toString(), 302);
}

/**
 * Handle GET /authorize and POST /authorize for the ch1tty OAuth 2.1 flow.
 *
 * GET: parse and validate the OAuth request, return a consent form that
 *      preserves the original query string as a hidden field.
 * POST: re-parse OAuth params from the hidden field, validate the admin
 *       token, and complete the authorization grant.
 */
export async function handleAuthorize(req: Request, env: AuthEnv): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    let oauthReq;
    try {
      oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(req);
    } catch (err) {
      if (isAuthError(err)) return oauthErrorRedirect(err);
      throw err;
    }
    void oauthReq; // validated; original query string is preserved in the form
    return new Response(authorizeHtml(url.search), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  if (req.method === 'POST') {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return new Response('Bad request: invalid form body', { status: 400 });
    }

    const oauthParams = form.get('oauth_params');
    if (typeof oauthParams !== 'string' || !oauthParams) {
      return new Response('Bad request: missing oauth_params', { status: 400 });
    }

    // Reconstruct the original GET /authorize request from the preserved query string.
    const syntheticUrl = new URL(url.pathname + oauthParams, url.origin);
    const syntheticReq = new Request(syntheticUrl.toString(), { method: 'GET' });
    let oauthReq;
    try {
      oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(syntheticReq);
    } catch (err) {
      if (isAuthError(err)) return oauthErrorRedirect(err);
      throw err;
    }

    const adminToken = env.CH1TTY_MCP_TOKEN;
    if (!adminToken) {
      return new Response('OAuth not configured: CH1TTY_MCP_TOKEN must be set', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    const token = form.get('token');
    if (typeof token !== 'string' || !token) {
      return new Response(authorizeHtml(oauthParams, 'Token is required.'), {
        status: 400,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    if (!timingSafeEqual(token, adminToken)) {
      return new Response(authorizeHtml(oauthParams, 'Invalid token.'), {
        status: 401,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: oauthReq,
      userId: 'admin',
      scope: oauthReq.scope,
      props: {},
    });

    return Response.redirect(redirectTo, 302);
  }

  return new Response('Method not allowed', { status: 405 });
}
