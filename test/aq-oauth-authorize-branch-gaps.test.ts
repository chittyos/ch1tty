// Workstream AQ — oauth-authorize.ts uncovered branch gaps.
// Targets 5 branches not reached by test/oauth-authorize.test.ts:
//   1. oauthErrorRedirect: redirectUri present but state absent (false branch of `if (err.state)`)
//   2. oauthErrorRedirect: issuer set (true branch of `if (err.issuer)`)
//   3. POST: req.formData() throws → 400 "Bad request: invalid form body"
//   4. POST synthetic re-parse: auth-error without redirectUri → 400 plain text
//   5. POST synthetic re-parse: non-auth error → rethrows
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAuthorize } from '../src/oauth-authorize.js';
import type { OAuthHelpers, AuthRequest, CompleteAuthorizationOptions } from '@cloudflare/workers-oauth-provider';

const BASE = 'https://ch1tty.chitty.cc';
const REDIRECT_URI = 'https://client.example/callback';
const OAUTH_QS = '?response_type=code&client_id=test-client&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&code_challenge=abc&code_challenge_method=S256&scope=mcp&state=s1';

function makeAuthErrLike(opts: { code: string; description: string; redirectUri?: string; state?: string; issuer?: string }) {
  return Object.assign(new Error(opts.description), opts) as Error & typeof opts;
}

function makeProvider(opts: {
  parseThrows?: Error;
  parseReturns?: AuthRequest;
} = {}): OAuthHelpers {
  const staticReq: AuthRequest = opts.parseReturns ?? ({
    responseType: 'code',
    clientId: 'test-client',
    redirectUri: REDIRECT_URI,
    state: 's1',
    scope: ['mcp'],
    codeChallenge: 'abc',
    codeChallengeMethod: 'S256',
  } as AuthRequest);

  return {
    async parseAuthRequest(_req: Request): Promise<AuthRequest> {
      if (opts.parseThrows) throw opts.parseThrows;
      return staticReq;
    },
    async completeAuthorization(_o: CompleteAuthorizationOptions<Record<string, never>>): Promise<{ redirectTo: string }> {
      return { redirectTo: `${REDIRECT_URI}?code=ok&state=s1` };
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

function makeEnv(token: string | undefined, provider = makeProvider()) {
  return { CH1TTY_MCP_TOKEN: token, OAUTH_PROVIDER: provider } as Parameters<typeof handleAuthorize>[1];
}

// 1. oauthErrorRedirect — redirectUri present, state absent (if (err.state) false branch)
test('oauthErrorRedirect: redirectUri present, no state → redirect without state param', async () => {
  const err = makeAuthErrLike({ code: 'invalid_request', description: 'Bad client', redirectUri: REDIRECT_URI });
  // state is absent; the redirect should not include a state= param
  const req = new Request(`${BASE}/authorize`, { method: 'GET' });
  const res = await handleAuthorize(req, makeEnv('secret', makeProvider({ parseThrows: err })));
  assert.equal(res.status, 302);
  const loc = res.headers.get('location') ?? '';
  assert.ok(loc.includes('error=invalid_request'), `loc: ${loc}`);
  assert.ok(!loc.includes('state='), `no state param expected in: ${loc}`);
  assert.ok(!loc.includes('iss='), `no iss param expected in: ${loc}`);
});

// 2. oauthErrorRedirect — issuer set (if (err.issuer) true branch)
test('oauthErrorRedirect: issuer set → iss= included in redirect', async () => {
  const err = makeAuthErrLike({
    code: 'invalid_request',
    description: 'Bad client',
    redirectUri: REDIRECT_URI,
    state: 's1',
    issuer: 'https://ch1tty.chitty.cc',
  });
  const req = new Request(`${BASE}/authorize`, { method: 'GET' });
  const res = await handleAuthorize(req, makeEnv('secret', makeProvider({ parseThrows: err })));
  assert.equal(res.status, 302);
  const loc = res.headers.get('location') ?? '';
  assert.ok(loc.includes('iss='), `iss param expected in: ${loc}`);
  assert.ok(loc.includes(encodeURIComponent('https://ch1tty.chitty.cc')), `issuer encoded in: ${loc}`);
});

// 3. POST: req.formData() throws → 400 "Bad request: invalid form body"
test('handleAuthorize POST: formData() parse fails → 400 plain text', async () => {
  // Send a body with wrong Content-Type so formData() throws.
  const req = new Request(`${BASE}/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"oauth_params":"?foo=bar","token":"secret"}',
  });
  const res = await handleAuthorize(req, makeEnv('secret'));
  assert.equal(res.status, 400);
  const body = await res.text();
  assert.ok(body.includes('invalid form body'), `body: ${body}`);
});

// 4. POST synthetic re-parse: auth-error WITHOUT redirectUri → 400 plain text
test('handleAuthorize POST: synthetic re-parse auth-error without redirectUri → 400 plain text', async () => {
  // First call (GET to parse the synthetic URL) throws an auth-error with no redirectUri.
  const err = makeAuthErrLike({ code: 'invalid_client', description: 'Client not found' });
  const req = new Request(`${BASE}/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ oauth_params: OAUTH_QS, token: 'secret' }).toString(),
  });
  const res = await handleAuthorize(req, makeEnv('secret', makeProvider({ parseThrows: err })));
  assert.equal(res.status, 400);
  const body = await res.text();
  assert.ok(body.includes('Client not found'), `body: ${body}`);
});

// 5. POST synthetic re-parse: non-auth error → rethrows
test('handleAuthorize POST: synthetic re-parse throws non-auth error → rethrows', async () => {
  const err = new Error('network failure');
  const req = new Request(`${BASE}/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ oauth_params: OAUTH_QS, token: 'secret' }).toString(),
  });
  await assert.rejects(
    () => handleAuthorize(req, makeEnv('secret', makeProvider({ parseThrows: err }))),
    (e: Error) => e.message === 'network failure',
  );
});
