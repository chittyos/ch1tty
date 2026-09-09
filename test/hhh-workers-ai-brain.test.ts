/**
 * HHH — WorkersAiBrain unit tests (Workstream H).
 *
 * Covers the full src/workers-ai-brain.ts surface: cosine path, Vectorize
 * path, circuit breaker, candidate-vector cache, config clamping, stats, and
 * indexCandidates. The Ai and VectorizeIndex bindings are provided as typed
 * mock objects — no Cloudflare runtime needed.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkersAiBrain, EMBED_MODEL, type ToolCandidate } from '../src/workers-ai-brain.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a unit Float32Array where slot[idx]=1, everything else=0 (already L2-normalised). */
function unitVec(dim: number, idx: number): number[] {
  const v = new Array<number>(dim).fill(0);
  v[idx] = 1;
  return v;
}

type AiRunFn = (model: string, opts: { text: string[] }) => Promise<{ data?: number[][] }>;

/** Minimal Ai mock — just implements .run() for the embed model. */
function makeAi(runFn: AiRunFn): Ai {
  return { run: runFn } as unknown as Ai;
}

/** Make an Ai whose embed always succeeds, returning unit vectors per input. */
function makeEmbedAi(dim = 768): Ai {
  let callCount = 0;
  return makeAi(async (_model, { text }) => {
    const data = text.map((_, i) => unitVec(dim, (callCount * 10 + i) % dim));
    callCount++;
    return { data };
  });
}

/** Make an Ai that always throws. */
function makeFailAi(): Ai {
  return makeAi(async () => { throw new Error('AI unavailable'); });
}

/** Make an Ai that returns malformed data (empty array). */
function makeMalformedAi(): Ai {
  return makeAi(async () => ({ data: [] }));
}

type VectorizeQueryFn = (vec: number[], opts: { topK: number; returnMetadata: boolean }) => Promise<{
  matches: Array<{ id: string; score: number; metadata?: Record<string, unknown> }>;
}>;

/** Minimal VectorizeIndex mock. */
function makeVectorize(queryFn: VectorizeQueryFn): VectorizeIndex {
  const upserted: unknown[] = [];
  return {
    query: queryFn,
    upsert: async (items: unknown[]) => { upserted.push(...items); return { count: (items as unknown[]).length }; },
    _upserted: upserted,
  } as unknown as VectorizeIndex;
}

const candidate = (name: string, desc: string): ToolCandidate => ({
  namespacedName: name, description: desc, category: 'test',
});

// ── 1. Constructor config clamping ────────────────────────────────────────────

test('WorkersAiBrain: minSimilarity clamped to [0, 1]', () => {
  const lo = new WorkersAiBrain(makeEmbedAi(), undefined, { minSimilarity: -5 });
  assert.equal(lo.config.minSimilarity, 0);
  const hi = new WorkersAiBrain(makeEmbedAi(), undefined, { minSimilarity: 99 });
  assert.equal(hi.config.minSimilarity, 1);
  const ok = new WorkersAiBrain(makeEmbedAi(), undefined, { minSimilarity: 0.7 });
  assert.equal(ok.config.minSimilarity, 0.7);
});

test('WorkersAiBrain: maxCandidates and topK clamped to >= 1', () => {
  const b = new WorkersAiBrain(makeEmbedAi(), undefined, { maxCandidates: 0, topK: -3 });
  assert.equal(b.config.maxCandidates, 1);
  assert.equal(b.config.topK, 1);
});

test('route(): maxCandidates prunes candidate batch passed to AI', async () => {
  const batchSizes: number[] = [];
  const models: string[] = [];
  const ai = makeAi(async (model, { text }) => {
    models.push(model);
    batchSizes.push(text.length);
    return { data: text.map(() => unitVec(2, 0)) };
  });
  const brain = new WorkersAiBrain(ai, undefined, { maxCandidates: 2, minSimilarity: 0 });
  const cands = Array.from({ length: 5 }, (_, i) => candidate(`svc/t${i}`, `desc ${i}`));
  await brain.route('q', cands);
  // First batch = query embed (1 item); second batch = candidate embed (≤ maxCandidates=2 items).
  const candidateBatch = batchSizes.find(n => n > 1) ?? batchSizes[1] ?? 0;
  assert.ok(candidateBatch <= 2, `Expected candidate batch ≤ maxCandidates=2, got ${candidateBatch}`);
  assert.ok(models.length > 0 && models.every((m) => m === EMBED_MODEL),
    `All AI calls must use EMBED_MODEL=${EMBED_MODEL}, got [${models.join(', ')}]`);
});

// ── 2. route() early-returns ──────────────────────────────────────────────────

test('route(): disabled config returns null without invoking Workers AI', async () => {
  let aiCalls = 0;
  const countingAi = makeAi(async (_m, { text }) => { aiCalls++; return { data: text.map(() => unitVec(2, 0)) }; });
  const brain = new WorkersAiBrain(countingAi, undefined, { enabled: false });
  const result = await brain.route('find me a tool', [candidate('a/b', 'desc')]);
  assert.equal(result, null);
  assert.equal(aiCalls, 0, 'AI.run() must not be called when enabled=false');
});

test('route(): empty query returns null without invoking Workers AI', async () => {
  let aiCalls = 0;
  const countingAi = makeAi(async (_m, { text }) => { aiCalls++; return { data: text.map(() => unitVec(2, 0)) }; });
  const brain = new WorkersAiBrain(countingAi);
  assert.equal(await brain.route('', [candidate('a/b', 'desc')]), null);
  assert.equal(await brain.route('   ', [candidate('a/b', 'desc')]), null);
  assert.equal(aiCalls, 0, 'AI.run() must not be called for blank queries');
});

test('route(): empty candidates list returns null without invoking Workers AI', async () => {
  let aiCalls = 0;
  const countingAi = makeAi(async (_m, { text }) => { aiCalls++; return { data: text.map(() => unitVec(2, 0)) }; });
  const brain = new WorkersAiBrain(countingAi);
  assert.equal(await brain.route('something', []), null);
  assert.equal(aiCalls, 0, 'AI.run() must not be called for empty candidates');
});

test('route(): Workers AI is invoked with EMBED_MODEL model identifier', async () => {
  const capturedModels: string[] = [];
  const modelCheckAi = makeAi(async (model, { text }) => {
    capturedModels.push(model as string);
    return { data: text.map(() => unitVec(4, 0)) };
  });
  const brain = new WorkersAiBrain(modelCheckAi, undefined, { minSimilarity: 0 });
  await brain.route('test query', [candidate('svc/t', 'desc')]);
  assert.ok(capturedModels.length > 0, 'AI.run() must be called at least once');
  for (const m of capturedModels) {
    assert.equal(m, EMBED_MODEL, `Workers AI must be called with EMBED_MODEL="${EMBED_MODEL}", got "${m}"`);
  }
});

// ── 3. Cosine path: successful routing ───────────────────────────────────────

test('route(): cosine path returns correctly sorted results with distinct confidences', async () => {
  // embedSingle (query) and ensureCandidateVectors (candidates) are two separate AI calls.
  // We use a call counter to assign non-orthogonal vectors so similarities are distinct:
  //   query  = [1, 0, 0, 0]
  //   tool-a = [0.8, 0.6, 0, 0] → dot(query, tool-a) = 0.8
  //   tool-b = [0.6, 0.8, 0, 0] → dot(query, tool-b) = 0.6
  // After normalizeInPlace these are already unit vectors. Sort must put tool-a before tool-b.
  let callNum = 0;
  const sortAi = makeAi(async (_m, { text }) => {
    const isQuery = callNum++ === 0;
    return {
      data: isQuery
        ? [[1, 0, 0, 0]]
        : text.map((_, i) => (i === 0 ? [0.8, 0.6, 0, 0] : [0.6, 0.8, 0, 0])),
    };
  });

  const brain = new WorkersAiBrain(sortAi, undefined, { minSimilarity: 0.0, topK: 3 });
  const candidates = [candidate('svc/tool-a', 'alpha'), candidate('svc/tool-b', 'beta')];

  const results = await brain.route('query', candidates);
  assert.ok(results !== null, 'cosine path must return results');
  assert.equal(results!.length, 2);
  for (const r of results!) {
    assert.ok(typeof r.tool.namespacedName === 'string');
    assert.ok(r.confidence >= 0 && r.confidence <= 1);
    assert.equal(r.reason, 'embedding similarity');
  }
  // tool-a has higher similarity → must be first.
  assert.equal(results![0]!.tool.namespacedName, 'svc/tool-a', 'higher-similarity tool must be first');
  assert.ok(results![0]!.confidence > results![1]!.confidence, 'results must be strictly sorted descending');
});

test('route(): clips results to topK', async () => {
  // All candidates get the same unit vector as the query → sim=1 → all match.
  const ai = makeAi(async (_m, { text }) => ({
    data: text.map(() => unitVec(2, 0)),
  }));
  const brain = new WorkersAiBrain(ai, undefined, { minSimilarity: 0.0, topK: 2 });
  const candidates = Array.from({ length: 5 }, (_, i) => candidate(`svc/tool-${i}`, `desc ${i}`));
  const results = await brain.route('query', candidates);
  assert.ok(results !== null);
  // All 5 candidates match (sim=1 ≥ minSimilarity=0); topK=2 clips to exactly 2.
  assert.equal(results!.length, 2, `Expected exactly topK=2, got ${results!.length}`);
});

test('route(): below minSimilarity → null (emptyResults++)', async () => {
  // embedSingle (query) and ensureCandidateVectors (candidates) are separate AI calls made
  // in sequence via Promise.all. We assign slot 0 to all queries and slot 2 to the candidate
  // so they are always orthogonal (dot=0 < minSimilarity=0.99 → null) — including in repeated
  // loop calls where the candidate is already cached and only the query is re-embedded.
  let callNum = 0;
  const orthoAi = makeAi(async (_m, { text }) => {
    // Call 0 = query (embedSingle), call 1 = candidate (ensureCandidateVectors, first route only).
    // Subsequent calls are always query-only (candidate cached); all get slot 0.
    const slot = callNum === 1 ? 2 : 0;
    callNum++;
    return { data: text.map(() => unitVec(3, slot)) };
  });
  const brain = new WorkersAiBrain(orthoAi, undefined, { minSimilarity: 0.99 });
  const result = await brain.route('q', [candidate('s/t', 'desc')]);
  assert.equal(result, null, 'orthogonal vectors must be below minSimilarity=0.99 → null');
  assert.equal(brain.getStats().emptyResults, 1, 'emptyResults must be 1 after below-threshold route');
  // Repeat through configured threshold — every repeated call must also return null (orthogonal
  // query vs cached candidate), and empty/low-similarity results must never trip the circuit breaker.
  const threshold = brain.config.circuitBreakerThreshold;
  const loopResults: unknown[] = [];
  for (let i = 0; i < threshold; i++) {
    loopResults.push(await brain.route('q', [candidate('s/t', 'desc')]));
  }
  assert.ok(loopResults.every(r => r === null), 'all repeated queries must be null (always orthogonal to cached candidate)');
  assert.equal(brain.getStats().circuitOpen, false, 'cosine empty results must not trip circuit breaker');
});

// ── 4. Circuit breaker ────────────────────────────────────────────────────────

test('circuit breaker: opens after threshold consecutive AI failures', async () => {
  const brain = new WorkersAiBrain(makeFailAi(), undefined, {
    circuitBreakerThreshold: 2,
    circuitBreakerCooldownMs: 60_000,
  });
  const cands = [candidate('s/t', 'desc')];

  // Two failures → circuit opens.
  await brain.route('q', cands);
  await brain.route('q', cands);

  const stats = brain.getStats();
  assert.equal(stats.circuitOpen, true);
  assert.ok(stats.circuitCooldownRemainingMs > 0);

  // Third call: circuit is open → returns null without calling AI (calls count doesn't increase by 1).
  const callsBefore = stats.calls;
  const result = await brain.route('q', cands);
  assert.equal(result, null);
  // calls is NOT incremented when circuit is open (short-circuits before calls++).
  assert.equal(brain.getStats().calls, callsBefore, 'no new call counted while circuit open');
});

test('circuit breaker: does not open before threshold', async () => {
  const brain = new WorkersAiBrain(makeFailAi(), undefined, {
    circuitBreakerThreshold: 3,
    circuitBreakerCooldownMs: 60_000,
  });
  const cands = [candidate('s/t', 'desc')];

  // Two failures — threshold is 3, so circuit should still be closed.
  await brain.route('q', cands);
  await brain.route('q', cands);

  assert.equal(brain.getStats().circuitOpen, false, 'circuit must be closed before threshold');
});

test('circuit breaker: success resets consecutive failure count', async () => {
  let fail = true;
  const ai = makeAi(async (_m, { text }) => {
    if (fail) throw new Error('fail');
    return { data: text.map(() => unitVec(2, 0)) };
  });
  const brain = new WorkersAiBrain(ai, undefined, {
    circuitBreakerThreshold: 3,
    circuitBreakerCooldownMs: 60_000,
    minSimilarity: 0,
  });
  const cands = [candidate('s/t', 'desc')];

  // Two failures (below threshold).
  await brain.route('q', cands);
  await brain.route('q', cands);

  // Successful call — resets failures.
  fail = false;
  await brain.route('q', cands);

  // Two more failures — should NOT open circuit (count was reset).
  fail = true;
  await brain.route('q', cands);
  await brain.route('q', cands);

  assert.equal(brain.getStats().circuitOpen, false, 'reset means 2 failures do not trip threshold=3');
});

test('circuit breaker: half-open probe — only one concurrent probe allowed', async () => {
  const brain = new WorkersAiBrain(makeFailAi(), undefined, {
    circuitBreakerThreshold: 1,
    circuitBreakerCooldownMs: 100,
  });
  const cands = [candidate('s/t', 'desc')];

  // Trip the circuit (1 failure at threshold=1).
  await brain.route('q', cands);
  assert.equal(brain.getStats().circuitOpen, true, 'circuit must open after threshold=1 failure');

  // Wait for cooldown to expire (150ms > 100ms cooldown).
  await new Promise<void>((resolve) => setTimeout(resolve, 150));
  assert.equal(brain.getStats().circuitOpen, false, 'cooldown expired → circuit in half-open state');

  // Launch two concurrent probes. route() sets this.probing = true synchronously before
  // the first await, so the second call sees probing=true and returns null immediately.
  const [r1, r2] = await Promise.all([
    brain.route('q', cands),
    brain.route('q', cands),
  ]);

  assert.equal(r1, null, 'probe 1 returns null (makeFailAi causes failure)');
  assert.equal(r2, null, 'probe 2 blocked by probing=true → null immediately');

  // Trip call increments calls once; only probe 1 reaches AI (probe 2 is blocked).
  assert.equal(brain.getStats().calls, 2, 'exactly one probe attempt must reach AI');
});

// ── 5. Candidate vector cache ─────────────────────────────────────────────────

test('candidate cache: second route() call uses cached vectors (cacheHits > 0)', async () => {
  let totalAiCalls = 0;
  const ai = makeAi(async (_m, { text }) => {
    totalAiCalls++;
    return { data: text.map(() => unitVec(4, 0)) };
  });
  const brain = new WorkersAiBrain(ai, undefined, { minSimilarity: 0 });
  const cands = [candidate('svc/tool-a', 'alpha'), candidate('svc/tool-b', 'beta')];

  // First call — populates cache.
  await brain.route('q1', cands);
  const afterFirst = brain.getStats();
  assert.equal(afterFirst.cacheMisses, cands.length, 'all candidates are cache misses on first call');
  assert.equal(afterFirst.cacheSize, cands.length, 'cache populated');

  // Second call with same candidates — should hit cache.
  const aiCallsAfterFirst = totalAiCalls;
  await brain.route('q2', cands);
  const afterSecond = brain.getStats();
  assert.equal(afterSecond.cacheHits, cands.length, `Expected cacheHits === ${cands.length} (every candidate served from cache), got ${afterSecond.cacheHits}`);
  // Cache hits must skip re-embedding candidates: second route must call AI exactly once (query only).
  assert.equal(totalAiCalls - aiCallsAfterFirst, 1, 'second route must embed only the query (1 AI call); cached candidates must not be re-embedded');

  // Third call with a candidate whose content has changed — must be a cache miss and trigger re-embed.
  const changedCands = [
    { ...cands[0]!, description: 'updated description' },
    cands[1]!,
  ];
  await brain.route('q3', changedCands);
  const afterThird = brain.getStats();
  // The changed candidate must produce a new miss; unchanged candidate must hit.
  assert.ok(afterThird.cacheMisses > afterSecond.cacheMisses, 'changed candidate description must invalidate cache (cache miss)');
  assert.ok(afterThird.cacheHits > afterSecond.cacheHits, 'unchanged candidate must still hit cache');
});

// ── 6. getStats() ─────────────────────────────────────────────────────────────

test('getStats(): fresh instance has zero stats', () => {
  const brain = new WorkersAiBrain(makeEmbedAi());
  const stats = brain.getStats();
  assert.equal(stats.calls, 0);
  assert.equal(stats.successes, 0);
  assert.equal(stats.errors, 0);
  assert.equal(stats.emptyResults, 0);
  assert.equal(stats.avgLatencyMs, 0);
  assert.equal(stats.cacheSize, 0);
  assert.equal(stats.cacheHits, 0);
  assert.equal(stats.cacheMisses, 0);
  assert.equal(stats.circuitOpen, false);
  assert.equal(stats.circuitCooldownRemainingMs, 0);
  assert.equal(stats.vectorize, false);
});

test('getStats(): vectorize=true when bound', () => {
  const brain = new WorkersAiBrain(makeEmbedAi(), makeVectorize(async () => ({ matches: [] })));
  assert.equal(brain.getStats().vectorize, true);
});

test('getStats(): calls increments each route() call (when not circuit-open)', async () => {
  const brain = new WorkersAiBrain(makeFailAi(), undefined, {
    circuitBreakerThreshold: 100,
  });
  const cands = [candidate('s/t', 'd')];
  await brain.route('q', cands);
  await brain.route('q', cands);
  const stats = brain.getStats();
  assert.equal(stats.calls, 2);
  // embed() is called twice per route() (query + candidates), each increments errors on failure.
  assert.ok(stats.errors >= 2, `Expected errors >= 2 (one per embed call), got ${stats.errors}`);
});

// ── 7. Vectorize path ─────────────────────────────────────────────────────────

test('route() Vectorize path: returns matches above minSimilarity', async () => {
  const ai = makeAi(async (_m, { text }) => ({
    data: text.map(() => unitVec(4, 0)),
  }));
  const vz = makeVectorize(async () => ({
    matches: [
      { id: 'svc/tool-a', score: 0.9, metadata: { namespacedName: 'svc/tool-a', description: 'alpha', category: 'test', serverName: 's' } },
      { id: 'svc/tool-b', score: 0.3, metadata: { namespacedName: 'svc/tool-b', description: 'beta', category: 'test', serverName: 's' } },
    ],
  }));
  const brain = new WorkersAiBrain(ai, vz, { minSimilarity: 0.5 });
  const results = await brain.route('q', [candidate('svc/tool-a', 'alpha'), candidate('svc/tool-b', 'beta')]);
  assert.ok(results !== null);
  assert.equal(results!.length, 1, 'only score=0.9 passes minSimilarity=0.5');
  assert.equal(results![0]!.tool.namespacedName, 'svc/tool-a');
  assert.equal(results![0]!.reason, 'vectorize similarity');
});

test('route() Vectorize path: empty matches → null (emptyResults) and does NOT trip circuit', async () => {
  const ai = makeAi(async (_m, { text }) => ({
    data: text.map(() => unitVec(4, 0)),
  }));
  const vz = makeVectorize(async () => ({ matches: [] }));
  const brain = new WorkersAiBrain(ai, vz, { minSimilarity: 0.5, circuitBreakerThreshold: 2 });
  const result = await brain.route('q', [candidate('s/t', 'd')]);
  assert.equal(result, null);
  assert.equal(brain.getStats().emptyResults, 1);
  // A second empty-match call reaches threshold=2 but must NOT open the circuit —
  // empty results are not failures; the circuit only opens on embed/AI errors.
  await brain.route('q', [candidate('s/t', 'd')]);
  assert.equal(brain.getStats().circuitOpen, false, 'empty Vectorize results must not trip circuit breaker');
});

test('route() Vectorize path: AI embed failure → null + circuit failure', async () => {
  const vz = makeVectorize(async () => ({ matches: [] }));
  const brain = new WorkersAiBrain(makeFailAi(), vz, {
    circuitBreakerThreshold: 1,
    circuitBreakerCooldownMs: 60_000,
  });
  const result = await brain.route('q', [candidate('s/t', 'd')]);
  assert.equal(result, null);
  // One failure should open circuit.
  assert.equal(brain.getStats().circuitOpen, true);
});

test('route() Vectorize path: match not in live candidates reconstructed from metadata', async () => {
  const ai = makeAi(async (_m, { text }) => ({
    data: text.map(() => unitVec(4, 0)),
  }));
  let capturedQueryOptions: { topK?: number; returnMetadata?: boolean } | undefined;
  const vz = makeVectorize(async (_vec, opts) => {
    capturedQueryOptions = opts;
    return {
      matches: [
        { id: 'svc/ghost', score: 0.95, metadata: { namespacedName: 'svc/ghost', description: 'ghost tool', category: 'other', serverName: 'svc' } },
      ],
    };
  });
  const brain = new WorkersAiBrain(ai, vz, { minSimilarity: 0.5 });
  // 'svc/ghost' is NOT in the live candidates list.
  const results = await brain.route('q', [candidate('svc/tool-a', 'alpha')]);
  // score=0.95 > minSimilarity=0.5, so match is guaranteed.
  assert.ok(results !== null, 'vectorize match with score 0.95 > minSimilarity 0.5 must be non-null');
  assert.equal(results![0]!.tool.namespacedName, 'svc/ghost');
  assert.equal(results![0]!.tool.description, 'ghost tool');
  // Production code must request metadata so ghost-tool reconstruction works.
  assert.equal(capturedQueryOptions?.returnMetadata, true, 'Vectorize query must include returnMetadata: true');
  // topK must be at least the configured final topK so enough candidates can be returned.
  assert.ok((capturedQueryOptions?.topK ?? 0) >= brain.config.topK, `Vectorize topK must be >= config.topK=${brain.config.topK}`);
});

// ── 8. indexCandidates() ──────────────────────────────────────────────────────

test('indexCandidates(): no-op without Vectorize binding and does not invoke Workers AI', async () => {
  let aiCalls = 0;
  const countingAi = makeAi(async (_m, { text }) => { aiCalls++; return { data: text.map(() => unitVec(2, 0)) }; });
  const brain = new WorkersAiBrain(countingAi);
  const n = await brain.indexCandidates([candidate('s/t', 'd')]);
  assert.equal(n, 0);
  assert.equal(aiCalls, 0, 'AI.run() must not be called when there is no Vectorize binding');
});

test('indexCandidates(): no-op with empty candidates — no Vectorize request', async () => {
  let upsertCalls = 0;
  const vz = {
    query: async () => ({ matches: [] }),
    upsert: async (items: unknown[]) => { upsertCalls++; return { count: (items as unknown[]).length }; },
  } as unknown as VectorizeIndex;
  const brain = new WorkersAiBrain(makeEmbedAi(), vz);
  const n = await brain.indexCandidates([]);
  assert.equal(n, 0);
  assert.equal(upsertCalls, 0, 'Vectorize.upsert must not be called for empty candidates');
});

test('indexCandidates(): upserts correct count when Vectorize bound', async () => {
  // Return distinct unit vectors per batch position so a regression that swaps
  // candidate embeddings would cause a values mismatch assertion below.
  const ai = makeAi(async (_m, { text }) => ({
    data: text.map((_, i) => unitVec(4, i % 4)),
  }));
  const upserted: unknown[] = [];
  const vz = {
    query: async () => ({ matches: [] }),
    upsert: async (items: unknown[]) => { upserted.push(...items); return { count: (items as unknown[]).length }; },
  } as unknown as VectorizeIndex;
  const brain = new WorkersAiBrain(ai, vz);
  // Candidates in alphabetical name order so sort below is a no-op (stable index mapping).
  const cands = [
    candidate('svc/a', 'alpha'),   // batch index 0 → unitVec(4, 0) = [1,0,0,0]
    candidate('svc/b', 'beta'),    // batch index 1 → unitVec(4, 1) = [0,1,0,0]
    candidate('svc/c', 'gamma'),   // batch index 2 → unitVec(4, 2) = [0,0,1,0]
  ];
  const n = await brain.indexCandidates(cands);
  assert.equal(n, 3);
  assert.equal(upserted.length, 3);
  // Each upserted item must match its candidate: id, distinct values vector, and metadata.
  const sorted = (upserted as Array<{ id: string; values: number[]; metadata: Record<string, string> }>)
    .sort((a, b) => a.id.localeCompare(b.id));
  const sortedCands = [...cands].sort((a, b) => a.namespacedName.localeCompare(b.namespacedName));
  for (let i = 0; i < sortedCands.length; i++) {
    assert.equal(sorted[i]!.id, sortedCands[i]!.namespacedName, `upserted id must match candidate namespacedName`);
    assert.ok(Array.isArray(sorted[i]!.values) && sorted[i]!.values.length > 0, 'values must be non-empty');
    assert.deepEqual(sorted[i]!.values, unitVec(4, i), `upserted values for ${sortedCands[i]!.namespacedName} must match its distinct embedding`);
    assert.equal(sorted[i]!.metadata.namespacedName, sortedCands[i]!.namespacedName, 'metadata.namespacedName must match');
  }
});

test('indexCandidates(): returns 0 when embed fails', async () => {
  const vz = makeVectorize(async () => ({ matches: [] }));
  const brain = new WorkersAiBrain(makeFailAi(), vz);
  const n = await brain.indexCandidates([candidate('s/t', 'd')]);
  assert.equal(n, 0);
});

// ── 9. Malformed AI response ──────────────────────────────────────────────────

test('route(): AI returns wrong-length data array → null', async () => {
  // Returns fewer embeddings than inputs.
  const ai = makeAi(async () => ({ data: [unitVec(4, 0)] }));
  // Two candidates → embed called with text.length >= 2; data.length=1 is wrong.
  const brain = new WorkersAiBrain(ai, undefined, { circuitBreakerThreshold: 100 });
  const result = await brain.route('q', [candidate('s/a', 'd'), candidate('s/b', 'd')]);
  // ensureCandidateVectors gets 2 inputs but AI returns only 1 vector → length mismatch → embed() → null.
  assert.equal(result, null, 'wrong-length data array must produce null');
});

test('route(): AI returns data with non-finite vector value → null', async () => {
  const ai = makeAi(async (_m, { text }) => ({
    data: text.map(() => [NaN, 0, 0, 0]),  // non-finite
  }));
  const brain = new WorkersAiBrain(ai, undefined, { circuitBreakerThreshold: 100 });
  const result = await brain.route('q', [candidate('s/t', 'd')]);
  assert.equal(result, null);
});
