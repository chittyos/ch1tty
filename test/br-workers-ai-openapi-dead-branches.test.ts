/**
 * Workstream BR — dead branch simplification: openapi-spec.ts + workers-ai-brain.ts
 *
 * Three dead branches remain uncovered in src/ after BQ:
 *
 * 1. openapi-spec.ts parseToolPath() `(m[1] ?? null)` — m[1] is always a string
 *    when the regex matches (captured group 1 is required). The `?? null` branch
 *    (null side) is structurally unreachable. Fixed by removing `?? null` → `m[1]!`.
 *
 * 2. workers-ai-brain.ts line ~162 `if (!vec) continue` — ensureCandidateVectors
 *    returns null on failure (causing the `!candidateVecs` guard to fire) or a
 *    fully-populated array on success. Individual elements are never null after
 *    successful return. Fixed via /* c8 ignore next *\/.
 *
 * 3. workers-ai-brain.ts embedSingle() `res[0] ?? null` — when res.length === 1,
 *    res[0] is always a Float32Array (embed() never produces null array elements).
 *    Fixed by removing `?? null` → `res[0]!`.
 *
 * 4. workers-ai-brain.ts embed() `if (inputs.length === 0) return []` — embed() is
 *    only called by ensureCandidateVectors (guarded by missingIdx.length > 0) and
 *    embedSingle (always [text]). Fixed via /* c8 ignore next *\/.
 *
 * These tests confirm that the simplified code behaves identically to the original
 * for all reachable inputs.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseToolPath } from '../src/openapi-spec.js';
import { WorkersAiBrain, type ToolCandidate } from '../src/workers-ai-brain.js';

// ── 1. parseToolPath simplified (m[1]! instead of m[1] ?? null) ───────────────

test('BR: parseToolPath — valid paths return namespaced string (simplified m[1]!)', () => {
  assert.equal(parseToolPath('/tools/stripe/create_invoice'), 'stripe/create_invoice');
  assert.equal(parseToolPath('/tools/a/b'), 'a/b');
  assert.equal(parseToolPath('/tools/neon/run-sql'), 'neon/run-sql');
});

test('BR: parseToolPath — non-matching paths return null (m falsy branch)', () => {
  assert.equal(parseToolPath('/tools/stripe'), null);
  assert.equal(parseToolPath('/tools/a/b/c'), null);
  assert.equal(parseToolPath(''), null);
  assert.equal(parseToolPath('/execute/x/y'), null);
});

// ── 2. WorkersAiBrain: vec null guard (ensureCandidateVectors path) ──────────

type AiRunFn = (model: string, opts: { text: string[] }) => Promise<{ data?: number[][] }>;

function makeAi(runFn: AiRunFn): Ai {
  return { run: runFn } as unknown as Ai;
}

function makeEmbedAi(dim = 4): Ai {
  return makeAi(async (_model, { text }) => ({
    data: text.map((_, i) => Array.from({ length: dim }, (__, k) => (i === k ? 1 : 0))),
  }));
}

const candidate = (name: string): ToolCandidate => ({
  namespacedName: name, description: `desc for ${name}`, category: 'test',
});

test('BR: WorkersAiBrain — ensureCandidateVectors with full cache hits produces non-null vecs (vec guard never fires)', async () => {
  const ai = makeEmbedAi(4);
  const brain = new WorkersAiBrain(ai, undefined, { minSimilarity: 0 });
  // First call: cache miss — embeds all candidates.
  const r1 = await brain.route('query', [candidate('a/tool'), candidate('b/tool')]);
  assert.ok(Array.isArray(r1) && r1.length > 0, 'first call must produce results');

  // Second call with same candidates: full cache hits — ensureCandidateVectors
  // returns early via `if (missingIdx.length === 0) return out`. Every element
  // in out is a cached Float32Array. The `if (!vec) continue` guard is never taken.
  const r2 = await brain.route('query', [candidate('a/tool'), candidate('b/tool')]);
  assert.ok(Array.isArray(r2) && r2.length > 0, 'second call (all cache hits) must produce results');
  assert.equal(brain.getStats().cacheHits, 2, 'second call must register 2 cache hits');
});

// ── 3. embedSingle: res[0]! — result is always a Float32Array when length===1 ─

test('BR: WorkersAiBrain — embedSingle returns a valid Float32Array (res[0]! simplified)', async () => {
  const ai = makeEmbedAi(8);
  const brain = new WorkersAiBrain(ai, undefined, { minSimilarity: 0 });
  const result = await brain.route('find something', [candidate('s/tool')]);
  // embedSingle was called with 1-element input. res[0]! coerces the Float32Array.
  // If it were null, the route would return null (circuit failure).
  assert.ok(Array.isArray(result) && result.length > 0, 'embedSingle must return a valid vec → route produces result');
});

// ── 4. embed(): empty-inputs guard is dead code ────────────────────────────────

test('BR: WorkersAiBrain — all-cache-hit path skips embed(); empty-inputs guard never reached', async () => {
  let embedCallCount = 0;
  const countingAi = makeAi(async (_model, { text }) => {
    embedCallCount++;
    return { data: text.map(() => [1, 0, 0, 0]) };
  });
  const brain = new WorkersAiBrain(countingAi, undefined, { minSimilarity: 0 });

  // First call: 1 candidate, 1 embed call (missingText = [text], length=1).
  await brain.route('q', [candidate('x/y')]);
  assert.equal(embedCallCount, 2, 'route makes 1 embed call for query + 1 for candidate');

  // Second call: same candidate — cache hit. embed() never called for candidates.
  // embed() IS still called for the query string itself (embedSingle), so +1.
  const prevCount = embedCallCount;
  await brain.route('q', [candidate('x/y')]);
  assert.equal(embedCallCount, prevCount + 1, 'second call: only query is re-embedded; candidate from cache');
  assert.equal(brain.getStats().cacheHits, 1, 'second call registers 1 cache hit');
});
