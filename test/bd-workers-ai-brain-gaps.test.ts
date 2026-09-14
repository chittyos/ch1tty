/**
 * Workstream BD — targeted branch gaps in src/workers-ai-brain.ts
 *
 * Covers branches NOT exercised by test/hhh-workers-ai-brain.test.ts:
 *
 * 1. candidateFromMetadata() line 266 — `!m` TRUE branch: match.metadata is absent
 *    → function returns null → match skipped in routeVectorize loop.
 *
 * 2. candidateFromMetadata() line 266 — `typeof m.namespacedName !== 'string'` TRUE branch:
 *    metadata present but namespacedName is not a string (missing or numeric)
 *    → function returns null → match skipped.
 *
 * 3. candidateFromMetadata() line 269 — `typeof m.description === 'string'` FALSE branch:
 *    metadata lacks a string description → description defaults to ''.
 *
 * 4. dot() line 401 — `a.length !== b.length` TRUE branch: query embedding has a different
 *    dimension than candidate embedding → dot returns 0 → similarity 0 < minSimilarity.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkersAiBrain, type ToolCandidate } from '../src/workers-ai-brain.js';

// ── Helpers (mirrors hhh-workers-ai-brain.test.ts) ────────────────────────────

function unitVec(dim: number, idx: number): number[] {
  const v = new Array<number>(dim).fill(0);
  v[idx] = 1;
  return v;
}

type AiRunFn = (model: string, opts: { text: string[] }) => Promise<{ data?: number[][] }>;

function makeAi(runFn: AiRunFn): Ai {
  return { run: runFn } as unknown as Ai;
}

function makeEmbedAi(dim = 768): Ai {
  let callCount = 0;
  return makeAi(async (_model, { text }) => {
    const data = text.map((_, i) => unitVec(dim, (callCount * 10 + i) % dim));
    callCount++;
    return { data };
  });
}

type VectorizeQueryFn = (
  vec: number[],
  opts: { topK: number; returnMetadata: boolean },
) => Promise<{ matches: Array<{ id: string; score: number; metadata?: Record<string, unknown> }> }>;

function makeVectorize(queryFn: VectorizeQueryFn): VectorizeIndex {
  return {
    query: queryFn,
    upsert: async (items: unknown[]) => ({ count: (items as unknown[]).length }),
  } as unknown as VectorizeIndex;
}

const candidate = (name: string, desc: string): ToolCandidate => ({
  namespacedName: name, description: desc, category: 'test',
});

// ── 1. candidateFromMetadata: !m TRUE branch — metadata absent ────────────────

test('candidateFromMetadata: absent metadata → !m branch returns null, match skipped', async () => {
  // The match has no metadata field at all. byName.get(match.id) returns undefined
  // (ghost/absent not in live candidates), so candidateFromMetadata is called.
  // match.metadata is undefined → !m is true → returns null → if (!cand) continue.
  // out stays empty → routeVectorize returns [] → route() sees result.length=0 →
  // emptyResults++ → returns null.
  const vz = makeVectorize(async () => ({
    matches: [
      {
        id: 'ghost/absent',
        score: 0.98,
        // metadata field intentionally absent
      },
    ],
  }));
  const brain = new WorkersAiBrain(makeEmbedAi(4), vz, { minSimilarity: 0 });
  const result = await brain.route('query', [candidate('live/tool', 'live')]);
  assert.equal(result, null, 'match with absent metadata must be skipped → no routed tools → null');
  assert.equal(brain.getStats().emptyResults, 1, 'empty result from skipped match increments emptyResults');
  assert.equal(brain.getStats().circuitOpen, false, 'missing metadata is not a circuit-breaker error');
});

test('candidateFromMetadata: metadata is null → !m branch returns null', async () => {
  const vz = makeVectorize(async () => ({
    matches: [
      {
        id: 'ghost/null-meta',
        score: 0.95,
        metadata: null as unknown as Record<string, unknown>,
      },
    ],
  }));
  const brain = new WorkersAiBrain(makeEmbedAi(4), vz, { minSimilarity: 0 });
  const result = await brain.route('query', [candidate('live/other', 'desc')]);
  assert.equal(result, null, 'match with null metadata must be skipped');
});

// ── 2. candidateFromMetadata: namespacedName not a string ─────────────────────

test('candidateFromMetadata: non-string namespacedName → typeof branch returns null, match skipped', async () => {
  // metadata is present but namespacedName is a number, not a string.
  // typeof m.namespacedName !== 'string' is TRUE → returns null → match skipped.
  const vz = makeVectorize(async () => ({
    matches: [
      {
        id: 'ghost/bad-name',
        score: 0.92,
        metadata: {
          namespacedName: 12345,   // number, not string
          description: 'some tool',
          category: 'test',
          serverName: 'svc',
        },
      },
    ],
  }));
  const brain = new WorkersAiBrain(makeEmbedAi(4), vz, { minSimilarity: 0 });
  const result = await brain.route('query', [candidate('live/tool', 'desc')]);
  assert.equal(result, null, 'match with non-string namespacedName must be skipped');
  assert.equal(brain.getStats().emptyResults, 1);
});

test('candidateFromMetadata: missing namespacedName key → typeof branch returns null', async () => {
  const vz = makeVectorize(async () => ({
    matches: [
      {
        id: 'ghost/no-ns',
        score: 0.9,
        metadata: { description: 'something', category: 'test' }, // no namespacedName
      },
    ],
  }));
  const brain = new WorkersAiBrain(makeEmbedAi(4), vz, { minSimilarity: 0 });
  const result = await brain.route('query', [candidate('live/a', 'a')]);
  assert.equal(result, null, 'match with missing namespacedName must be skipped');
});

// ── 3. candidateFromMetadata: description not a string ────────────────────────

test('candidateFromMetadata: non-string description → empty string fallback', async () => {
  // description is a number → typeof m.description === 'string' is FALSE → '' fallback.
  // The candidate IS reconstructed (namespacedName is a valid string), just with description=''.
  const vz = makeVectorize(async () => ({
    matches: [
      {
        id: 'ghost/num-desc',
        score: 0.88,
        metadata: {
          namespacedName: 'ghost/num-desc',
          description: 42,           // number, not string → '' fallback
          category: 'test',
          serverName: 'svc',
        },
      },
    ],
  }));
  const brain = new WorkersAiBrain(makeEmbedAi(4), vz, { minSimilarity: 0 });
  const result = await brain.route('query', [candidate('live/b', 'b')]);
  // ghost/num-desc scores 0.88 ≥ minSimilarity=0 → appears in results with description=''.
  assert.ok(Array.isArray(result) && result.length > 0, 'tool from metadata must be surfaced');
  assert.equal(result![0]!.tool.description, '', 'non-string description must default to empty string');
});

test('candidateFromMetadata: missing description key → empty string fallback', async () => {
  const vz = makeVectorize(async () => ({
    matches: [
      {
        id: 'ghost/no-desc',
        score: 0.85,
        metadata: {
          namespacedName: 'ghost/no-desc',
          // description key absent
          category: 'test',
        },
      },
    ],
  }));
  const brain = new WorkersAiBrain(makeEmbedAi(4), vz, { minSimilarity: 0 });
  const result = await brain.route('query', [candidate('live/c', 'c')]);
  assert.ok(Array.isArray(result) && result.length > 0, 'tool with absent description must still be surfaced');
  assert.equal(result![0]!.tool.description, '', 'absent description must default to empty string');
});

// ── 4. dot(): a.length !== b.length TRUE branch ───────────────────────────────

test('dot(): mismatched vector dimensions → returns 0 → similarity 0 → no result', async () => {
  // To exercise dot(a, b) when a.length !== b.length, we produce:
  //   queryVec  (from embedSingle)       : dim=2, via call 0
  //   candidateVec (from ensureCandidateVectors): dim=4, via call 1
  // dot([1,0], [0,0,0,1]) → a.length=2, b.length=4 → returns 0 early.
  // sim=0 < minSimilarity=0.5 → tool not included → scored.length=0 → null.
  let callNum = 0;
  const mismatchAi = makeAi(async (_model, { text }) => {
    const dim = callNum++ === 0 ? 2 : 4;
    return { data: text.map((_, i) => unitVec(dim, i % dim)) };
  });

  const brain = new WorkersAiBrain(mismatchAi, undefined, { minSimilarity: 0.5 });
  const result = await brain.route('query', [candidate('s/t', 'desc')]);
  // dot returns 0 → sim=0 < minSimilarity=0.5 → no match → emptyResults++.
  assert.equal(result, null, 'mismatched vector dims must yield sim=0 → below threshold → null');
  assert.equal(brain.getStats().emptyResults, 1, 'zero-sim result must count as emptyResults');
  assert.equal(brain.getStats().circuitOpen, false, 'dim mismatch is not a circuit-breaker error');
});

test('dot(): mismatched dims with minSimilarity=0 → sim=0 still included in results', async () => {
  // With minSimilarity=0, sim=0 passes the threshold. dot() returns 0 but the tool is still
  // included with confidence=0.
  let callNum = 0;
  const mismatchAi = makeAi(async (_model, { text }) => {
    const dim = callNum++ === 0 ? 2 : 4;
    return { data: text.map((_, i) => unitVec(dim, i % dim)) };
  });

  const brain = new WorkersAiBrain(mismatchAi, undefined, { minSimilarity: 0 });
  const result = await brain.route('query', [candidate('s/t', 'desc')]);
  assert.ok(Array.isArray(result) && result.length > 0, 'sim=0 passes minSimilarity=0 filter');
  assert.equal(result![0]!.confidence, 0, 'confidence is 0 when dot returns 0 from dim mismatch');
});
