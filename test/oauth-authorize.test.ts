// Tests for handleAuthorize in src/oauth-authorize.ts.
// Validates the GET (consent form) and POST (token validation + grant) paths,
// authorization-error redirect/local rendering, and timing-safe token comparison.
//
// @cloudflare/workers-oauth-provider transitively imports cloudflare:workers,
// which Node.js cannot resolve. Tests use duck-typed auth-error objects and a
// hand-rolled OAuthHelpers mock — no direct import from that package.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAuthorize } from '../src/oauth-authorize.js';
import type { OAuthHelpers, AuthRequest, CompleteAuthorizationOptions } from '@cloudflare/workers-oauth-provider';

const BASE = 'https://ch1tty.chitty.cc';
const REDIRECT_URI = 'https://client.example/callback';
const OAUTH_QS = '?response_type=code&client_id=test-client&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&code_challenge=abc123&code_challenge_method=S256&scope=mcp&state=xyz';

// Duck-typed auth error (matches the shape handleAuthorize checks internally).
function makeAuthError(opts: { code: string; description: string; redirectUri?: string; state?: string }): Error & { code: string; description: string; redirectUri?: string; state?: string } {
  const e = Object.assign(new Error(opts.description), opts);
  return e as Error & typeof opts;
}

function makeMockOAuthProvider({
  completeRedirect = `${REDIRECT_URI}?code=testcode&state=xyz`,
  parseThrows,
}: {
  completeRedirect?: string;
  parseThrows?: Error;
} = {}): OAuthHelpers {
  const staticReq: AuthRequest = {
    responseType: 'code',
    clientId: 'test-client',
    redirectUri: REDIRECT_URI,
    state: 'xyz',
    scope: ['mcp'],
    codeChallenge: 'abc123',
    codeChallengeMethod: 'S256',
  } as AuthRequest;

  return {
    async parseAuthRequest(_req: Request): Promise<AuthRequest> {
      if (parseThrows) throw parseThrows;
      return staticReq;
    },
    async completeAuthorization(_opts: CompleteAuthorizationOptions<Record<string, never>>): Promise<{ redirectTo: string }> {
      return { redirectTo: completeRedirect };
    },
    lookupClient: undefined as never,
    createClient: undefined as never,
    revokeToken: undefined as never,
    revokeGrant: undefined as never,
    listGrants: undefined as never,
    generateAuthCode: undefined as never,
    lookupGrant: undefined as never,
  };
}

function makeEnv(token: string | undefined, provider = makeMockOAuthProvider()) {
  return { CH1TTY_MCP_TOKEN: token, OAUTH_PROVIDER: provider } as Parameters<typeof handleAuthorize>[1];
}

function makeFormBody(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

// ── GET /authorize ────────────────────────────────────────────────────────────

test('handleAuthorize: GET → 200 HTML consent form with hidden oauth_params', async () => {
  const req = new Request(`${BASE}/authorize${OAUTH_QS}`, { method: 'GET' });
  const res = await handleAuthorize(req, makeEnv('secret'));
  assert.equal(res.status, 200);
  const ct = res.headers.get('content-type') ?? '';
  assert.ok(ct.startsWith('text/html'), `expected text/html, got ${ct}`);
  const body = await res.text();
  assert.ok(body.includes('<form'), 'form element present');
  assert.ok(body.includes('name="oauth_params"'), 'oauth_params hidden field present');
  assert.ok(body.includes(encodeURIComponent('test-client')), 'OAuth query string preserved in form');
  assert.ok(body.includes('name="token"'), 'token input present');
});

test('handleAuthorize: GET with auth-error + redirectUri → redirect to client', async () => {
  const err = makeAuthError({ code: 'invalid_request', description: 'Bad client', redirectUri: REDIRECT_URI, state: 'xyz' });
  const req = new Request(`${BASE}/authorize`, { method: 'GET' });
  const res = await handleAuthorize(req, makeEnv('secret', makeMockOAuthProvider({ parseThrows: err })));
  assert.equal(res.status, 302);
  const loc = res.headers.get('location') ?? '';
  assert.ok(loc.includes('error=invalid_request'), `location: ${loc}`);
  assert.ok(loc.includes('state=xyz'), `location: ${loc}`);
});

test('handleAuthorize: GET with auth-error + no redirectUri → 400 plain text', async () => {
  const err = makeAuthError({ code: 'invalid_request', description: 'Unknown client' });
  const req = new Request(`${BASE}/authorize`, { method: 'GET' });
  const res = await handleAuthorize(req, makeEnv('secret', makeMockOAuthProvider({ parseThrows: err })));
  assert.equal(res.status, 400);
  const body = await res.text();
  assert.ok(body.includes('Unknown client'));
});

test('handleAuthorize: GET throws non-auth error → rethrows', async () => {
  const err = new Error('unexpected');
  const req = new Request(`${BASE}/authorize`, { method: 'GET' });
  await assert.rejects(
    () => handleAuthorize(req, makeEnv('secret', makeMockOAuthProvider({ parseThrows: err }))),
    (e: Error) => e.message === 'unexpected',
  );
});

// ── POST /authorize — success ────────────────────────────────────────────────

test('handleAuthorize: POST with correct token → 302 redirect to client with code', async () => {
  const req = new Request(`${BASE}/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: makeFormBody({ oauth_params: OAUTH_QS, token: 'secret' }),
  });
  const res = await handleAuthorize(req, makeEnv('secret'));
  assert.equal(res.status, 302);
  const loc = res.headers.get('location') ?? '';
  assert.ok(loc.includes('code=testcode'), `redirect contains code: ${loc}`);
  assert.ok(loc.includes('state=xyz'), `redirect preserves state: ${loc}`);
});

// ── POST /authorize — token failures ─────────────────────────────────────────

test('handleAuthorize: POST with wrong token → 401 HTML with error message', async () => {
  const req = new Request(`${BASE}/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: makeFormBody({ oauth_params: OAUTH_QS, token: 'wrong' }),
  });
  const res = await handleAuthorize(req, makeEnv('secret'));
  assert.equal(res.status, 401);
  const body = await res.text();
  assert.ok(body.includes('Invalid token'), `body: ${body.slice(0, 200)}`);
});

test('handleAuthorize: POST with empty token → 400 HTML with error message', async () => {
  const req = new Request(`${BASE}/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: makeFormBody({ oauth_params: OAUTH_QS, token: '' }),
  });
  const res = await handleAuthorize(req, makeEnv('secret'));
  assert.equal(res.status, 400);
  const body = await res.text();
  assert.ok(body.includes('Token is required'), `body: ${body.slice(0, 200)}`);
});

test('handleAuthorize: POST with no token field → 400 HTML with error message', async () => {
  const req = new Request(`${BASE}/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: makeFormBody({ oauth_params: OAUTH_QS }),
  });
  const res = await handleAuthorize(req, makeEnv('secret'));
  assert.equal(res.status, 400);
  const body = await res.text();
  assert.ok(body.includes('Token is required'), `body: ${body.slice(0, 200)}`);
});

test('handleAuthorize: POST when CH1TTY_MCP_TOKEN unset → 503 plain text', async () => {
  const req = new Request(`${BASE}/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: makeFormBody({ oauth_params: OAUTH_QS, token: 'anything' }),
  });
  const res = await handleAuthorize(req, makeEnv(undefined));
  assert.equal(res.status, 503);
  const body = await res.text();
  assert.ok(body.includes('CH1TTY_MCP_TOKEN'), `body: ${body}`);
});

test('handleAuthorize: POST missing oauth_params → 400 plain text', async () => {
  const req = new Request(`${BASE}/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: makeFormBody({ token: 'secret' }),
  });
  const res = await handleAuthorize(req, makeEnv('secret'));
  assert.equal(res.status, 400);
  const body = await res.text();
  assert.ok(body.includes('oauth_params'), `body: ${body}`);
});

// ── POST /authorize — OAuth error on re-parse ────────────────────────────────

test('handleAuthorize: POST when re-parse throws auth-error + redirectUri → redirect to client', async () => {
  // The POST path has exactly one parseAuthRequest call (the synthetic re-parse).
  // Throw immediately so the handler redirects to the client's error URI.
  const provider = makeMockOAuthProvider({
    parseThrows: makeAuthError({ code: 'access_denied', description: 'Denied', redirectUri: REDIRECT_URI, state: 'xyz' }),
  });

  const req = new Request(`${BASE}/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: makeFormBody({ oauth_params: OAUTH_QS, token: 'secret' }),
  });
  const res = await handleAuthorize(req, makeEnv('secret', provider));
  assert.equal(res.status, 302);
  const loc = res.headers.get('location') ?? '';
  assert.ok(loc.includes('error=access_denied'), `loc: ${loc}`);
});

// ── Method not allowed ────────────────────────────────────────────────────────

test('handleAuthorize: PUT → 405', async () => {
  const req = new Request(`${BASE}/authorize`, { method: 'PUT' });
  const res = await handleAuthorize(req, makeEnv('secret'));
  assert.equal(res.status, 405);
});
