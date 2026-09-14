/**
 * Workstream BB: branch gaps in workers-ai-brain.ts and oauth-authorize.ts.
 *
 * 1. workers-ai-brain.ts:266 — candidateFromMetadata() returns null when match
 *    has no metadata (or namespacedName is not a string); match is skipped.
 * 2. workers-ai-brain.ts:269 — description '' fallback when metadata.description
 *    is absent; tool still surfaces.
 * 3. workers-ai-brain.ts:401 — dot() returns 0 for mismatched-dimension vectors.
 * 4. oauth-authorize.ts:40  — ?? 0 in timingSafeEqual fires when submitted token
 *    is shorter than CH1TTY_MCP_TOKEN (loop runs past end of shorter array).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkersAiBrain, type ToolCandidate } from '../src/workers-ai-brain.js';
import { handleAuthorize } from '../src/oauth-authorize.js';
import type { OAuthHelpers, AuthRequest, CompleteAuthorizationOptions } from '@cloudflare/workers-oauth-provider';

// ── Helpers shared with hhh-workers-ai-brain.test.ts style ───────────────────

type AiRunFn = (model: string, opts: { text: string[] }) => Promise<{ data?: number[][] }>;

function makeAi(runFn: AiRunFn): Ai {
  return { run: runFn } as unknown as Ai;
}

type VectorizeQueryFn = (
  vec: number[],
  opts: { topK: number; returnMetadata: boolean },
) => Promise<{ matches: Array<{ id: string; score: number; metadata?: Record<string, unknown> }> }>;

function makeVectorize(queryFn: VectorizeQueryFn): VectorizeIndex {
  return {
    query: queryFn,
    upsert: async () => ({ count: 0 }),
  } as unknown as VectorizeIndex;
}

function cand(name: string, desc = 'desc'): ToolCandidate {
  return { namespacedName: name, description: desc };
}

// ── OAuth helpers ─────────────────────────────────────────────────────────────

const OAUTH_QS =
  '?response_type=code&client_id=c&redirect_uri=https%3A%2F%2Fclient%2Fcb&' +
  'code_challenge=abc&code_challenge_method=S256&scope=mcp&state=s1';

function makeProvider(): OAuthHelpers {
  return {
    async parseAuthRequest(): Promise<AuthRequest> {
      return {
        responseType: 'code',
        clientId: 'c',
        redirectUri: 'https://client/cb',
        state: 's1',
        scope: ['mcp'],
        codeChallenge: 'abc',
        codeChallengeMethod: 'S256',
      } as AuthRequest;
    },
    async completeAuthorization(
      _o: CompleteAuthorizationOptions<Record<string, never>>,
    ): Promise<{ redirectTo: string }> {
      return { redirectTo: 'https://client/cb?code=ok&state=s1' };
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

function makeEnv(token: string) {
  return {
    CH1TTY_MCP_TOKEN: token,
    OAUTH_PROVIDER: makeProvider(),
  } as Parameters<typeof handleAuthorize>[1];
}

// ── 1. candidateFromMetadata: null return when metadata is absent ─────────────

test('workers-ai-brain.ts:266 — match with no metadata is skipped (candidateFromMetadata returns null)', async () => {
  // The match id 'ghost/tool' is NOT in the candidate list, so candidateFromMetadata
  // is called. metadata is undefined → !m → return null → match is skipped via continue.
  let callN = 0;
  const ai = makeAi(async (_m, { text }) => {
    callN++;
    return { data: text.map(() => [1, 0, 0, 0]) };
  });
  const vz = makeVectorize(async () => ({
    matches: [
      // ghost/tool has no metadata → skipped
      { id: 'ghost/tool', score: 0.99 },
      // real/tool IS in candidates map (byName hit) → NOT via candidateFromMetadata
      { id: 'real/tool', score: 0.8, metadata: { namespacedName: 'real/tool', description: 'real' } },
    ],
  }));
  const brain = new WorkersAiBrain(ai, vz, { minSimilarity: 0 });
  const result = await brain.route('query', [cand('real/tool', 'real')]);
  assert.ok(callN >= 1, 'embed must have been called');
  // ghost/tool must not appear in results (it was skipped)
  assert.ok(
    result.every(r => r.tool.namespacedName !== 'ghost/tool'),
    'match with no metadata must be skipped',
  );
});

// ── 2. candidateFromMetadata: description '' fallback ─────────────────────────

test('workers-ai-brain.ts:269 — match metadata without description → description defaults to empty string', async () => {
  // match id 'x/nodesc' is NOT in candidates; metadata has namespacedName but no description.
  // candidateFromMetadata() takes the false branch: typeof m.description !== 'string' → ''
  let callN = 0;
  const ai = makeAi(async (_m, { text }) => {
    callN++;
    return { data: text.map(() => [1, 0, 0, 0]) };
  });
  const vz = makeVectorize(async () => ({
    matches: [
      {
        id: 'x/nodesc',
        score: 0.9,
        // no description field → undefined → typeof === 'string' false → '' fallback
        metadata: { namespacedName: 'x/nodesc', category: 'test' },
      },
    ],
  }));
  const brain = new WorkersAiBrain(ai, vz, { minSimilarity: 0 });
  const result = await brain.route('query', [cand('other/tool')]);
  assert.ok(callN >= 1, 'embed must have been called');
  const match = result.find(r => r.tool.namespacedName === 'x/nodesc');
  assert.ok(match, 'tool from metadata without description must still surface');
  assert.equal(match!.tool.description, '', 'description must default to empty string');
});

// ── 3. dot(): different-dimension vectors → returns 0 ────────────────────────

test('workers-ai-brain.ts:401 — dot() returns 0 for mismatched vector dimensions', async () => {
  // Cosine path (no vectorize). AI returns dim=2 for the query embed call and
  // dim=4 for the candidate embed call. dot(queryVec[2], candVec[4]) hits the
  // a.length !== b.length guard → returns 0 → confidence is 0.
  let callN = 0;
  const ai = makeAi(async (_m, { text }) => {
    callN++;
    const dim = callN === 1 ? 2 : 4; // query=2-dim, candidates=4-dim
    return { data: text.map(() => new Array<number>(dim).fill(0.5)) };
  });
  const brain = new WorkersAiBrain(ai, undefined, { minSimilarity: 0 });
  const result = await brain.route('intent', [cand('s/tool')]);
  assert.ok(callN >= 2, 'embed must have been called at least twice');
  // With minSimilarity=0, the tool is still returned even when dot=0.
  assert.ok(Array.isArray(result) && result.length > 0, 'tool must be returned when minSimilarity=0');
  assert.equal(result[0]!.confidence, 0, 'confidence must be 0 when dot returns 0 for mismatched dims');
});

// ── 4. timingSafeEqual: ?? 0 fires for shorter submitted token ────────────────

test('oauth-authorize.ts:40 — ab[i] ?? 0 fires when submitted token is shorter than CH1TTY_MCP_TOKEN', async () => {
  // 'short' (5 chars) vs 'a-much-longer-admin-token' (25 chars).
  // In timingSafeEqual(a='short', b='a-much-longer-admin-token'):
  //   len = 25; for i >= 5, ab[i] is undefined → ab[i] ?? 0 fires.
  // The tokens differ so the response is 401 "Invalid token".
  const req = new Request('https://ch1tty.chitty.cc/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      oauth_params: OAUTH_QS,
      token: 'short',
    }).toString(),
  });
  const res = await handleAuthorize(req, makeEnv('a-much-longer-admin-token'));
  assert.equal(res.status, 401, 'wrong token must return 401');
  const body = await res.text();
  assert.ok(body.includes('Invalid token'), `body must contain "Invalid token", got: ${body.slice(0, 200)}`);
});

test('oauth-authorize.ts:40 — bb[i] ?? 0 fires when submitted token is longer than CH1TTY_MCP_TOKEN', async () => {
  // 'a-very-long-submitted-token' (27 chars) vs 'tiny' (4 chars).
  // In timingSafeEqual(a='a-very-long-submitted-token', b='tiny'):
  //   len = 27; for i >= 4, bb[i] is undefined → bb[i] ?? 0 fires.
  // The tokens differ so the response is 401 "Invalid token".
  const req = new Request('https://ch1tty.chitty.cc/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      oauth_params: OAUTH_QS,
      token: 'a-very-long-submitted-token',
    }).toString(),
  });
  const res = await handleAuthorize(req, makeEnv('tiny'));
  assert.equal(res.status, 401, 'wrong token must return 401');
  const body = await res.text();
  assert.ok(body.includes('Invalid token'), `body must contain "Invalid token", got: ${body.slice(0, 200)}`);
});
