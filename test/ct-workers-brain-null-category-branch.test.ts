/**
 * CT — WorkersAiBrain branch gaps: null category, non-string metadata, error paths
 *
 * Covers four branches missed by existing workers-ai-brain tests:
 *
 * 1. line 209 — `c.category ?? ''` FALSE branch: `indexCandidates()` is
 *    called with a candidate that has `category: undefined`; the
 *    nullish-coalescing fallback must produce `''` in upserted Vectorize
 *    metadata.
 *
 * 2. line 271 — `typeof m.category === 'string' ? m.category : undefined`
 *    FALSE branch: `candidateFromMetadata()` receives metadata with a
 *    non-string `category`; the returned candidate must have `category ===
 *    undefined`.
 *
 * 3. lines 182–186 — catch block in `route()`: `vectorize.query()` throws an
 *    unexpected error; `route()` must catch, record the failure, and return
 *    null rather than propagating.
 *
 * 4. lines 350–353 — `embed()` per-vector malformed check: AI responds with
 *    correct count but an individual item is not an array (or is empty);
 *    `embed()` must return null and record an error.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkersAiBrain, type ToolCandidate } from '../src/workers-ai-brain.js';

// ── Helpers (mirrored from hhh / bd) ─────────────────────────────────────────

function unitVec(dim: number, idx: number): number[] {
  const v = new Array<number>(dim).fill(0);
  v[idx] = 1;
  return v;
}

type AiRunFn = (model: string, opts: { text: string[] }) => Promise<{ data?: number[][] }>;

function makeAi(runFn: AiRunFn): Ai {
  return { run: runFn } as unknown as Ai;
}

function makeEmbedAi(dim = 4): Ai {
  let call = 0;
  return makeAi(async (_m, { text }) => {
    const data = text.map((_, i) => unitVec(dim, (call * 10 + i) % dim));
    call++;
    return { data };
  });
}

type VectorizeQueryFn = (
  vec: number[],
  opts: { topK: number; returnMetadata: boolean },
) => Promise<{ matches: Array<{ id: string; score: number; metadata?: Record<string, unknown> }> }>;

function makeVectorize(
  queryFn: VectorizeQueryFn,
  upserted: unknown[],
): VectorizeIndex {
  return {
    query: queryFn,
    upsert: async (items: unknown[]) => {
      upserted.push(...items);
      return { count: (items as unknown[]).length };
    },
  } as unknown as VectorizeIndex;
}

// ── 1. indexCandidates: category undefined → metadata.category === '' ─────────

test('indexCandidates(): candidate with undefined category produces metadata.category = ""', async () => {
  // ToolCandidate.category is optional, so omitting it exercises the `?? ''` branch.
  const nocatCandidate: ToolCandidate = {
    namespacedName: 'srv/nocat',
    description: 'a tool without a category',
    // category intentionally omitted → undefined
  };

  const upserted: Array<{ id: string; values: number[]; metadata: Record<string, unknown> }> = [];
  const vz = makeVectorize(async () => ({ matches: [] }), upserted);

  const brain = new WorkersAiBrain(makeEmbedAi(4), vz);
  const count = await brain.indexCandidates([nocatCandidate]);

  assert.equal(count, 1, 'indexCandidates() should return 1 for a single candidate');
  assert.equal(upserted.length, 1, 'one vector should have been upserted');
  assert.equal(
    upserted[0]!.metadata.category,
    '',
    'metadata.category must be empty string when candidate.category is undefined',
  );
  assert.equal(upserted[0]!.id, 'srv/nocat');
});

test('indexCandidates(): candidate with null-like serverName also produces metadata.serverName = ""', async () => {
  const candidate: ToolCandidate = {
    namespacedName: 'srv/noname',
    description: 'no server name',
    category: 'ecosystem',
    // serverName intentionally omitted → exercises `?? ''` on line 210
  };

  const upserted: Array<{ id: string; values: number[]; metadata: Record<string, unknown> }> = [];
  const vz = makeVectorize(async () => ({ matches: [] }), upserted);

  const brain = new WorkersAiBrain(makeEmbedAi(4), vz);
  const count = await brain.indexCandidates([candidate]);

  assert.equal(count, 1);
  assert.equal(upserted[0]!.metadata.serverName, '', 'serverName ?? "" branch must produce ""');
});

// ── 2. candidateFromMetadata: non-string category → candidate.category = undefined ──

test('candidateFromMetadata(): numeric metadata.category coerced to undefined', async () => {
  // Set up: a match whose id is NOT in the live byName map (so candidateFromMetadata
  // is called), and whose metadata.category is a number — exercises the
  // `typeof m.category === 'string' ? m.category : undefined` FALSE branch.
  const liveCand: ToolCandidate = { namespacedName: 'live/tool', description: 'a live tool' };

  let capturedResult: import('../src/workers-ai-brain.js').RoutedTool[] | null = null;

  const vz = makeVectorize(async () => ({
    matches: [
      {
        id: 'ghost/tool',                  // NOT in byName → candidateFromMetadata called
        score: 0.99,
        metadata: {
          namespacedName: 'ghost/tool',
          description: 'reconstructed from vectorize',
          category: 42,                    // non-string → FALSE branch at line 271
          serverName: 'ghost',
        },
      },
    ],
  }), []);

  const brain = new WorkersAiBrain(makeEmbedAi(4), vz, { minSimilarity: 0 });
  capturedResult = await brain.route('find ghost', [liveCand]);

  // The ghost tool should be returned (score=0.99 >= minSimilarity=0).
  assert.ok(capturedResult !== null, 'route() must return results');
  assert.ok(capturedResult.length > 0, 'ghost/tool must appear in results');
  const ghostResult = capturedResult.find((r) => r.tool.namespacedName === 'ghost/tool');
  assert.ok(ghostResult, 'ghost/tool must be in route() results');
  assert.strictEqual(
    ghostResult.tool.category,
    undefined,
    'non-string metadata.category must produce undefined (not the raw number)',
  );
});

test('candidateFromMetadata(): non-string metadata.serverName coerced to undefined', async () => {
  const liveCand: ToolCandidate = { namespacedName: 'live/tool', description: 'live' };
  const vz = makeVectorize(async () => ({
    matches: [
      {
        id: 'ghost2/tool',
        score: 0.95,
        metadata: {
          namespacedName: 'ghost2/tool',
          description: 'ghost reconstructed',
          category: 'code',
          serverName: true,              // non-string → `typeof m.serverName === 'string'` FALSE at line 272
        },
      },
    ],
  }), []);

  const brain = new WorkersAiBrain(makeEmbedAi(4), vz, { minSimilarity: 0 });
  const result = await brain.route('find ghost2', [liveCand]);

  assert.ok(result !== null && result.length > 0);
  const ghost = result?.find((r) => r.tool.namespacedName === 'ghost2/tool');
  assert.ok(ghost, 'ghost2/tool must be in results');
  assert.strictEqual(ghost.tool.serverName, undefined, 'non-string serverName must produce undefined');
});

// ── 3. route() catch block (lines 182–186): vectorize.query throws ────────────

test('route(): vectorize.query throwing is caught, errors incremented, returns null', async () => {
  const liveCand: ToolCandidate = { namespacedName: 'svc/t', description: 'a tool', category: 'code' };
  const throwingVz = makeVectorize(async () => {
    throw new Error('Vectorize unavailable');
  }, []);

  const brain = new WorkersAiBrain(makeEmbedAi(4), throwingVz, { minSimilarity: 0 });
  const statsBefore = brain.getStats();
  const result = await brain.route('any intent', [liveCand]);

  // The catch at lines 182–186 must absorb the error and return null.
  assert.strictEqual(result, null, 'route() must return null when vectorize.query throws');
  const statsAfter = brain.getStats();
  assert.equal(
    statsAfter.errors,
    statsBefore.errors + 1,
    'errors counter must increment on route() catch',
  );
});

// ── 4. embed() per-vector malformed check (lines 350–353) ────────────────────

test('embed(): AI response with correct count but non-array individual vector returns null', async () => {
  // data has correct length (1) but the element is not an array → lines 349-353.
  const malformedIndividualAi = makeAi(async (_model, { text }) => ({
    data: text.map(() => 'not-an-array' as unknown as number[]),
  }));
  const brain = new WorkersAiBrain(malformedIndividualAi);
  // Trigger embed by calling route() which calls embed([query]) then embed(candidates).
  // On the first embed call (query), malformed data → embed returns null → route returns null.
  const result = await brain.route('test', [{ namespacedName: 's/t', description: 'd' }]);
  assert.strictEqual(result, null, 'route() must return null when embed returns null');
  // errors counter must have been incremented inside embed().
  assert.ok(brain.getStats().errors >= 1, 'embed() malformed-vector branch must increment errors');
});

test('embed(): AI response with correct count but empty inner array returns null', async () => {
  // data has correct length (1) but the element is an empty array → raw.length === 0 → lines 350-353.
  const emptyVecAi = makeAi(async (_model, { text }) => ({
    data: text.map(() => [] as number[]),
  }));
  const brain = new WorkersAiBrain(emptyVecAi);
  const result = await brain.route('test', [{ namespacedName: 's/t', description: 'd' }]);
  assert.strictEqual(result, null, 'route() must return null when embed returns null for empty vector');
  assert.ok(brain.getStats().errors >= 1, 'embed() empty-vector branch must increment errors');
});
