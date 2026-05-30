/**
 * Tests for EmbeddingBrain candidate-vector cache — ensureCandidateVectors()
 * in src/embedding-brain.ts:258–296.
 *
 * The cache is keyed by `namespacedName` and invalidated by a SHA-256 content
 * hash of `describeForEmbed(candidate)` (name + category + description). These
 * tests verify:
 *   1. Repeated calls with identical candidates hit the cache on the second call
 *      (no re-embed for already-cached candidates).
 *   2. Changed description → hash mismatch → cache miss → re-embed.
 *   3. Changed category → hash mismatch → cache miss (category is part of the
 *      embed text via `describeForEmbed`).
 *   4. Partial cache hit: only the new candidate is embedded when one candidate
 *      is added to an otherwise-cached list.
 *   5. cacheHits / cacheMisses / cacheSize counters track accurately across calls.
 *
 * Uses a real node:http fake /api/embed server — same pattern as
 * embedding-brain.test.ts. All fixture vectors are identical unit vectors
 * (cosine = 1) so similarity filtering never blocks results.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { EmbeddingBrain } from '../src/embedding-brain.js';
import type { ToolCandidate } from '../src/ollama-brain.js';

// ── Fake /api/embed server ────────────────────────────────────────────────────

interface EmbedRequest {
  model: string;
  input: string[];
}

async function startFakeEmbedServer(): Promise<{
  url: string;
  stop: () => Promise<void>;
  requests: EmbedRequest[];
}> {
  const requests: EmbedRequest[] = [];

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8'); });
    req.on('end', () => {
      const parsed = JSON.parse(raw) as EmbedRequest;
      requests.push(parsed);
      // Return identical [1,0,0,0] unit vectors for every input — cosine = 1 for
      // all pairs. This ensures route() always returns non-null results so
      // cache behaviour is observable without fighting similarity thresholds.
      const embeddings = parsed.input.map(() => [1, 0, 0, 0]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ embeddings }));
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

  return { url, stop, requests };
}

function mkBrain(url: string): EmbeddingBrain {
  return new EmbeddingBrain({
    url,
    timeoutMs: 2000,
    minSimilarity: 0,           // accept any similarity so fixture vectors always rank
    circuitBreakerThreshold: 20, // high threshold — prevent accidental tripping
  });
}

function cand(namespacedName: string, description: string, category: string = 'code'): ToolCandidate {
  return { namespacedName, description, category } as ToolCandidate;
}

// ── 1. Cache hit on repeated identical calls ──────────────────────────────────

test('repeated route() call with same candidates: second call is all cache hits', async () => {
  const fake = await startFakeEmbedServer();
  try {
    const brain = mkBrain(fake.url);
    const candidates = [
      cand('neon/query', 'Run SQL on Neon database'),
      cand('github/search', 'Search GitHub repositories'),
    ];

    // First call: both candidates are cache misses
    await brain.route('query database', candidates);
    const s1 = brain.getStats();
    assert.equal(s1.cacheMisses, 2, 'first call: both candidates miss');
    assert.equal(s1.cacheHits, 0, 'first call: no hits');
    assert.equal(s1.cacheSize, 2, 'first call: cache grows to 2');

    const reqCountAfterFirst = fake.requests.length;

    // Second call: both candidates already cached
    await brain.route('query database', candidates);
    const s2 = brain.getStats();
    assert.equal(s2.cacheHits, 2, 'second call: both candidates hit cache');
    assert.equal(s2.cacheMisses, 2, 'second call: no new misses (unchanged from first call)');
    assert.equal(s2.cacheSize, 2, 'cache size unchanged');

    // Query embed always fires (no per-query cache), but candidates embed is skipped.
    // Second call = 1 server request (query only) vs first call's 2 (query + candidates).
    const newServerRequests = fake.requests.length - reqCountAfterFirst;
    assert.equal(newServerRequests, 1, 'second call sends only the query embed — candidates are cached');
  } finally {
    await fake.stop();
  }
});

// ── 2. Cache miss on changed description ──────────────────────────────────────

test('changed description triggers cache miss and re-embed', async () => {
  const fake = await startFakeEmbedServer();
  try {
    const brain = mkBrain(fake.url);

    // First call with original description
    await brain.route('query database', [cand('neon/query', 'Run SQL on Neon database')]);
    const s1 = brain.getStats();
    assert.equal(s1.cacheMisses, 1, 'first call: cache miss');
    assert.equal(s1.cacheSize, 1);

    // Same namespacedName but different description → content hash changes → miss
    await brain.route('query database', [cand('neon/query', 'Execute queries against Neon Postgres')]);
    const s2 = brain.getStats();
    assert.equal(s2.cacheMisses, 2, 'changed description: fresh cache miss (re-embed)');
    assert.equal(s2.cacheHits, 0, 'no hits — description changed, hash invalidated');
    assert.equal(s2.cacheSize, 1, 'cache entry replaced (same key, new hash)');
  } finally {
    await fake.stop();
  }
});

// ── 3. Cache miss on changed category ─────────────────────────────────────────

test('changed category triggers cache miss (category is part of embed text)', async () => {
  const fake = await startFakeEmbedServer();
  try {
    const brain = mkBrain(fake.url);

    // describeForEmbed() includes category in the embed string: "${name} [${category}]: ${desc}"
    // So changing category changes the hash.
    await brain.route('run query', [cand('neon/query', 'Run SQL queries', 'code')]);
    const s1 = brain.getStats();
    assert.equal(s1.cacheMisses, 1, 'first call: cache miss');

    // Same name + description, different category → different embed text → miss
    await brain.route('run query', [cand('neon/query', 'Run SQL queries', 'ecosystem')]);
    const s2 = brain.getStats();
    assert.equal(s2.cacheMisses, 2, 'category change: cache miss');
    assert.equal(s2.cacheHits, 0, 'no cache hits — category changed the embed text');
    assert.equal(s2.cacheSize, 1, 'cache entry replaced (same namespacedName key)');
  } finally {
    await fake.stop();
  }
});

// ── 4. Partial cache hit: one new candidate alongside cached ones ──────────────

test('partial cache hit: only the new candidate is embedded on second call', async () => {
  const fake = await startFakeEmbedServer();
  try {
    const brain = mkBrain(fake.url);
    const candA = cand('neon/query', 'Run SQL');
    const candB = cand('github/search', 'Search GitHub');
    const candC = cand('notion/search', 'Search Notion documents');

    // First call with [A, B]: 2 misses, server receives query + [A,B] batch
    await brain.route('search data', [candA, candB]);
    const s1 = brain.getStats();
    assert.equal(s1.cacheMisses, 2, 'first call: A and B miss');
    assert.equal(s1.cacheSize, 2);
    const reqsAfterFirst = fake.requests.length;

    // Second call with [A, B, C]: A and B hit, only C misses
    await brain.route('search data', [candA, candB, candC]);
    const s2 = brain.getStats();
    assert.equal(s2.cacheHits, 2, 'A and B hit cache');
    assert.equal(s2.cacheMisses, 3, 'C is a new miss (cumulative)');
    assert.equal(s2.cacheSize, 3, 'cache grows by 1 (C added)');

    // Verify the candidate embed batch sent to server on second call has only 1 entry (C),
    // not 2 or 3 (which would indicate A and B were re-embedded).
    // Second call sends: 1 query request + 1 candidate-batch request (C only).
    const secondCallReqs = fake.requests.slice(reqsAfterFirst);
    // Both are length-1 (query text and C's embed text). No length-2 or length-3 batch.
    const largeBatches = secondCallReqs.filter((r) => r.input.length >= 2);
    assert.equal(largeBatches.length, 0, 'second call must not re-embed A+B in a batch');
    assert.equal(secondCallReqs.length, 2, 'second call = 1 query embed + 1 single-candidate embed');
  } finally {
    await fake.stop();
  }
});

// ── 5. Cumulative stats across three identical calls ──────────────────────────

test('cache stats accumulate correctly across three identical calls', async () => {
  const fake = await startFakeEmbedServer();
  try {
    const brain = mkBrain(fake.url);
    const candidates = [
      cand('stripe/charge', 'Create a Stripe charge'),
      cand('ledger/post', 'Post a transaction to the ledger'),
    ];

    // Call 1: 0 hits, 2 misses
    await brain.route('payment', candidates);
    assert.equal(brain.getStats().cacheHits, 0);
    assert.equal(brain.getStats().cacheMisses, 2);
    assert.equal(brain.getStats().cacheSize, 2);

    // Call 2: 2 hits, no new misses (cumulative: 0 hits→2, 2 misses→2)
    await brain.route('payment', candidates);
    assert.equal(brain.getStats().cacheHits, 2);
    assert.equal(brain.getStats().cacheMisses, 2);

    // Call 3: cumulative 4 hits, still 2 misses
    await brain.route('payment', candidates);
    assert.equal(brain.getStats().cacheHits, 4);
    assert.equal(brain.getStats().cacheMisses, 2);
    assert.equal(brain.getStats().cacheSize, 2, 'cache size stable across repeated calls');
  } finally {
    await fake.stop();
  }
});

// ── 6. Empty description does not break the cache ─────────────────────────────

test('candidate with empty description is cached correctly', async () => {
  const fake = await startFakeEmbedServer();
  try {
    const brain = mkBrain(fake.url);
    const noDesc = cand('mystery/tool', '', 'ecosystem');

    await brain.route('do something', [noDesc]);
    assert.equal(brain.getStats().cacheMisses, 1, 'first call: empty-desc candidate misses');
    assert.equal(brain.getStats().cacheSize, 1);

    // Second call with the same empty-description candidate → cache hit
    await brain.route('do something', [noDesc]);
    assert.equal(brain.getStats().cacheHits, 1, 'second call: empty-desc candidate hits cache');
    assert.equal(brain.getStats().cacheMisses, 1, 'no new misses');
  } finally {
    await fake.stop();
  }
});
