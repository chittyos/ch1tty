/**
 * Integration tests for SessionCoordinator.routeIntent() — exercises the real
 * embeddingBrain.route() code path via a fake Ollama /api/embed server.
 *
 * What's not covered by existing tests:
 *  - embedding-brain.test.ts: unit-tests EmbeddingBrain in isolation.
 *  - scenario.test.ts / session-affinity.test.ts: use StubCoordinator that
 *    overrides routeIntent(), so the real dispatch path is never exercised.
 *
 * This file closes that gap: SessionCoordinator is constructed with a real
 * EmbeddingBrainConfig pointing at a fake HTTP embed server, then routeIntent()
 * is called end-to-end through the coordinator.
 *
 * Handler contract for the fake server: respond based on req.input.length
 * (not call order) so that the background warmup() call — which also sends
 * 1 input — doesn't interfere with the per-test embed logic.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ToolCandidate } from '../src/ollama-brain.js';

// ── Fake Ollama /api/embed server ─────────────────────────────

type EmbedRequest = { model: string; input: string[] };
type EmbedHandler = (req: EmbedRequest) => { status: number; body: string } | 'hang';

async function startFakeOllama(handler: EmbedHandler): Promise<{
  url: string;
  stop: () => Promise<void>;
}> {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8'); });
    req.on('end', () => {
      let parsed: EmbedRequest;
      try { parsed = JSON.parse(raw) as EmbedRequest; }
      catch { parsed = { model: '', input: [] }; }

      const result = handler(parsed);
      if (result === 'hang') return;
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(result.body);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;
  const stop = () =>
    new Promise<void>((resolve, reject) => {
      server.closeAllConnections?.();
      server.close((err) => (err ? reject(err) : resolve()));
    });

  return { url, stop };
}

/** One-hot vector: length `dim`, value 1 at `pos % dim`, 0 elsewhere. */
function oneHot(pos: number, dim = 16): number[] {
  const v = new Array<number>(dim).fill(0);
  v[pos % dim] = 1;
  return v;
}

/** Build a /api/embed response with `vecs.length` embeddings. */
function embedBody(vecs: number[][]): string {
  return JSON.stringify({ embeddings: vecs });
}

const CANDIDATES: ToolCandidate[] = [
  { namespacedName: 'stripe/charge', description: 'Create a Stripe charge', category: 'ecosystem' },
  { namespacedName: 'neon/query', description: 'Run a SQL query on Neon', category: 'code' },
  { namespacedName: 'notion/search', description: 'Search Notion pages', category: 'documents' },
];

// ── Tests ─────────────────────────────────────────────────────

test('routeIntent: returns embedding results when fake server responds', async () => {
  // query → oneHot(0), stripe → oneHot(0) (sim=1.0), others → orthogonal.
  // minSimilarity=0 so all pass; stripe wins because it has the highest similarity.
  const fake = await startFakeOllama((req) => {
    if (req.input.length === 1) {
      // query embed (and warmup — both fine with oneHot(0))
      return { status: 200, body: embedBody([oneHot(0)]) };
    }
    // candidate batch: stripe=oneHot(0), neon=oneHot(1), notion=oneHot(2)
    return { status: 200, body: embedBody(req.input.map((_, i) => oneHot(i))) };
  });

  const coord = new SessionCoordinator(
    {},
    { url: fake.url, enabled: true, timeoutMs: 2000, minSimilarity: 0, topK: 10 },
  );

  try {
    const result = await coord.routeIntent('charge payment', CANDIDATES);
    assert.ok(result !== null, 'expected non-null result from working embed server');
    assert.ok(result.length > 0, 'expected at least one routed tool');
    assert.equal(result[0]!.tool.namespacedName, 'stripe/charge',
      'stripe/charge (oneHot(0)) should rank first against query (oneHot(0))');
    assert.equal(result[0]!.reason, 'embedding similarity');
    assert.ok(result[0]!.confidence > 0 && result[0]!.confidence <= 1);
  } finally {
    await fake.stop();
  }
});

test('routeIntent: results sorted by cosine similarity (highest first)', async () => {
  // query → oneHot(2); notion (pos 2) has sim=1.0, others have sim=0.
  // With minSimilarity=0, all three pass; notion must sort first.
  const fake = await startFakeOllama((req) => {
    if (req.input.length === 1) {
      return { status: 200, body: embedBody([oneHot(2)]) };
    }
    return { status: 200, body: embedBody(req.input.map((_, i) => oneHot(i))) };
  });

  const coord = new SessionCoordinator(
    {},
    { url: fake.url, enabled: true, timeoutMs: 2000, minSimilarity: 0, topK: 10 },
  );

  try {
    const result = await coord.routeIntent('search documents', CANDIDATES);
    assert.ok(result !== null && result.length > 0, 'expected results');
    assert.equal(result[0]!.tool.namespacedName, 'notion/search',
      'notion/search (oneHot(2)) should rank first for query (oneHot(2))');
    for (let i = 1; i < result.length; i++) {
      assert.ok(result[i - 1]!.confidence >= result[i]!.confidence,
        'confidences must be non-increasing');
    }
  } finally {
    await fake.stop();
  }
});

test('routeIntent: returns null when embedding is disabled', async () => {
  const coord = new SessionCoordinator({}, { enabled: false });
  const result = await coord.routeIntent('find payment tool', CANDIDATES);
  assert.equal(result, null, 'disabled embedding should return null immediately');
});

test('routeIntent: returns null for empty candidates without calling embed server', async () => {
  const fake = await startFakeOllama(() => { throw new Error('should not be called'); });
  const coord = new SessionCoordinator(
    {},
    { url: fake.url, enabled: true, timeoutMs: 1000 },
  );
  try {
    const result = await coord.routeIntent('charge payment', []);
    assert.equal(result, null, 'empty candidates should return null');
  } finally {
    await fake.stop();
  }
});

test('routeIntent: returns null for whitespace-only query without calling embed server', async () => {
  const fake = await startFakeOllama(() => { throw new Error('should not be called'); });
  const coord = new SessionCoordinator(
    {},
    { url: fake.url, enabled: true, timeoutMs: 1000 },
  );
  try {
    const result = await coord.routeIntent('   ', CANDIDATES);
    assert.equal(result, null, 'whitespace-only query should return null');
  } finally {
    await fake.stop();
  }
});

test('routeIntent: returns null when all similarities fall below minSimilarity', async () => {
  // query → oneHot(0); all candidates → oneHot(8..10) — orthogonal, sim=0.
  // Default minSimilarity=0.5 drops all → empty results → null.
  const fake = await startFakeOllama((req) => {
    if (req.input.length === 1) {
      return { status: 200, body: embedBody([oneHot(0)]) };
    }
    // Candidates at positions 8, 9, 10 — orthogonal to query at 0
    return { status: 200, body: embedBody(req.input.map((_, i) => oneHot(8 + i))) };
  });

  const coord = new SessionCoordinator(
    {},
    { url: fake.url, enabled: true, timeoutMs: 2000, minSimilarity: 0.5 },
  );

  try {
    const result = await coord.routeIntent('charge payment', CANDIDATES);
    assert.equal(result, null,
      'all-orthogonal embeddings below minSimilarity threshold should return null');
  } finally {
    await fake.stop();
  }
});

test('routeIntent: returns null gracefully when embed server is unreachable', async () => {
  const coord = new SessionCoordinator(
    {},
    { url: 'http://127.0.0.1:1', enabled: true, timeoutMs: 500 },
  );
  // Must not throw — routeIntent contract: null on every failure mode
  const result = await coord.routeIntent('find something', CANDIDATES);
  assert.equal(result, null, 'unreachable embed server should return null, not throw');
});

test('routeIntent: circuit breaker opens after consecutive failures, returns immediately', async () => {
  const coord = new SessionCoordinator(
    {},
    {
      url: 'http://127.0.0.1:1',
      enabled: true,
      timeoutMs: 300,
      circuitBreakerThreshold: 2,
      circuitBreakerCooldownMs: 60_000,
    },
  );

  // Two consecutive failures trip the circuit
  await coord.routeIntent('first call', CANDIDATES);
  await coord.routeIntent('second call', CANDIDATES);

  assert.ok(coord.embeddingBrain.isCircuitOpen(), 'circuit should be open after threshold failures');

  // Third call returns null immediately (no network attempt, no 300ms wait)
  const t0 = Date.now();
  const result = await coord.routeIntent('third call', CANDIDATES);
  const elapsed = Date.now() - t0;

  assert.equal(result, null, 'open circuit should return null');
  assert.ok(elapsed < 100, `open circuit should return quickly, got ${elapsed}ms`);
});

test('routeIntent: topK=1 returns at most one result', async () => {
  // All inputs return same oneHot(0) → all candidates have sim=1.0 with query.
  // topK=1 should cap output at 1 tool regardless.
  const fake = await startFakeOllama((req) => ({
    status: 200,
    body: embedBody(req.input.map(() => oneHot(0))),
  }));

  const coord = new SessionCoordinator(
    {},
    { url: fake.url, enabled: true, timeoutMs: 2000, minSimilarity: 0, topK: 1 },
  );

  try {
    const result = await coord.routeIntent('any query', CANDIDATES);
    assert.ok(result !== null, 'expected non-null results from working embed server');
    assert.equal(result.length, 1, 'topK=1 should cap results at 1');
  } finally {
    await fake.stop();
  }
});

test('routeIntent: getSnapshot embeddingBrain.calls increments after each call', async () => {
  const fake = await startFakeOllama((req) => ({
    status: 200,
    body: embedBody(req.input.map(() => oneHot(0))),
  }));

  const coord = new SessionCoordinator(
    {},
    { url: fake.url, enabled: true, timeoutMs: 2000, minSimilarity: 0 },
  );

  try {
    await coord.routeIntent('first query', CANDIDATES);
    const snap1 = coord.getSnapshot();

    await coord.routeIntent('second query', CANDIDATES);
    const snap2 = coord.getSnapshot();

    assert.ok(snap1.embeddingBrain.calls > 0, 'calls should be positive after first routeIntent');
    assert.ok(snap2.embeddingBrain.calls > snap1.embeddingBrain.calls,
      'calls should increase with each routeIntent invocation');
    assert.ok(snap2.embeddingBrain.successes > 0, 'successes should be positive after valid embed');
  } finally {
    await fake.stop();
  }
});
