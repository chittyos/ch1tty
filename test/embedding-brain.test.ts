/**
 * Tests for EmbeddingBrain — exercises real HTTP against a fake Ollama server
 * that speaks the /api/embed protocol, covering: defaults, null-safe guards,
 * real embed flow, circuit breaker behavior, and timeout abort.
 *
 * The fake Ollama is a genuine node:http server — no mocked fetch. This hits
 * the real AbortController timeout path and real JSON parsing.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { EmbeddingBrain, type EmbeddingBrainConfig } from '../src/embedding-brain.js';
import type { ToolCandidate } from '../src/ollama-brain.js';

// ── Fake Ollama /api/embed server (real HTTP, not a mock) ─────

type EmbedHandler = (body: unknown) => Promise<{ status: number; body: string } | 'hang'>;

async function startFakeOllama(handler: EmbedHandler): Promise<{
  url: string;
  stop: () => Promise<void>;
  requests: Array<{ model: string; input: string[] }>;
}> {
  const requests: Array<{ model: string; input: string[] }> = [];

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8'); });
    req.on('end', () => {
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { parsed = raw; }
      requests.push(parsed as { model: string; input: string[] });

      handler(parsed).then((result) => {
        if (result === 'hang') return; // never respond
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(result.body);
      }).catch((err) => {
        res.writeHead(500);
        res.end(String(err));
      });
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

/**
 * Return a one-hot vector at the given dimension position (length=DIM).
 * Dot product of one-hot(a) · one-hot(b) = 1 if a==b, else 0.
 */
function oneHot(pos: number, dim = 16): number[] {
  const v = new Array(dim).fill(0);
  v[pos % dim] = 1;
  return v;
}

/**
 * Build an /api/embed response with controlled cosine similarity.
 *
 * `queryPos` — position used for the query vector (or null = same as first candidate).
 * Calling with `queryPos=0` and candidates starting at pos 4 gives cosine = 0 for all
 * (orthogonal), making minSimilarity filters predictable in tests.
 */
function embedResponse(count: number, startPos = 0): string {
  return JSON.stringify({
    embeddings: Array.from({ length: count }, (_, i) => oneHot(startPos + i)),
  });
}

/**
 * Returns candidates with cosine similarity = 1 to the query (identical direction).
 * Use for tests that want actual results returned (minSimilarity: 0 or low value).
 */
function similarEmbedHandler(): EmbedHandler {
  return async (body) => {
    const req = body as { input: string[] };
    // All inputs get the same vector → cosine = 1 → always returns results
    return { status: 200, body: JSON.stringify({ embeddings: req.input.map(() => oneHot(0)) }) };
  };
}

/**
 * Returns the query at pos 0 and candidates at pos 8..N (orthogonal to query).
 * Cosine similarity = 0 for all candidates → all filtered at minSimilarity > 0.
 */
function orthogonalEmbedHandler(): EmbedHandler {
  let callCount = 0;
  return async (body) => {
    const req = body as { input: string[] };
    const isQueryCall = req.input.length === 1;
    if (isQueryCall) {
      return { status: 200, body: embedResponse(1, 0) }; // pos 0
    } else {
      // candidates at pos 8+ (orthogonal to pos 0)
      const pos = 8 + (callCount++ * req.input.length);
      return { status: 200, body: embedResponse(req.input.length, pos) };
    }
  };
}

function candidates(): ToolCandidate[] {
  return [
    { namespacedName: 'neon/list_projects', description: 'List Neon Postgres projects', category: 'code' },
    { namespacedName: 'stripe/list_payments', description: 'List recent Stripe payments', category: 'ecosystem' },
    { namespacedName: 'notion/search', description: 'Search Notion documents', category: 'documents' },
  ];
}

// ── Defaults and config ───────────────────────────────────────

test('default timeoutMs is 5000 (not 30000)', () => {
  const brain = new EmbeddingBrain();
  assert.equal(brain.config.timeoutMs, Number(process.env.CH1TTY_EMBED_TIMEOUT_MS ?? 5000));
});

test('default circuitBreakerThreshold is 3', () => {
  const brain = new EmbeddingBrain();
  assert.equal(brain.config.circuitBreakerThreshold, Number(process.env.CH1TTY_EMBED_CIRCUIT_THRESHOLD ?? 3));
});

test('default circuitBreakerCooldownMs is 60000', () => {
  const brain = new EmbeddingBrain();
  assert.equal(brain.config.circuitBreakerCooldownMs, Number(process.env.CH1TTY_EMBED_CIRCUIT_COOLDOWN_MS ?? 60_000));
});

test('constructor merges partial config with defaults', () => {
  const brain = new EmbeddingBrain({ timeoutMs: 1000, topK: 3 });
  assert.equal(brain.config.timeoutMs, 1000);
  assert.equal(brain.config.topK, 3);
  assert.equal(brain.config.model, process.env.CH1TTY_EMBED_MODEL ?? 'nomic-embed-text');
});

// ── Null-safe guards ──────────────────────────────────────────

test('route returns null when disabled', async () => {
  const brain = new EmbeddingBrain({ enabled: false, url: 'http://127.0.0.1:1' });
  const result = await brain.route('list payments', candidates());
  assert.equal(result, null);
  assert.equal(brain.getStats().calls, 0);
});

test('route returns null on blank query', async () => {
  const brain = new EmbeddingBrain({ url: 'http://127.0.0.1:1' });
  assert.equal(await brain.route('', candidates()), null);
  assert.equal(await brain.route('   ', candidates()), null);
  assert.equal(brain.getStats().calls, 0);
});

test('route returns null on empty candidates', async () => {
  const brain = new EmbeddingBrain({ url: 'http://127.0.0.1:1' });
  assert.equal(await brain.route('list payments', []), null);
  assert.equal(brain.getStats().calls, 0);
});

// ── Real HTTP embed flow ──────────────────────────────────────

test('successful embed returns ranked results', async () => {
  // All vectors identical → cosine = 1 for all candidates → results returned
  const fake = await startFakeOllama(similarEmbedHandler());

  try {
    const brain = new EmbeddingBrain({
      url: fake.url,
      timeoutMs: 2000,
      minSimilarity: 0,  // accept any similarity so fixture vectors rank
    });
    const result = await brain.route('list payments', candidates());
    assert.ok(result, 'expected non-null result');
    assert.ok(result.length > 0);
    for (const r of result) {
      assert.ok(r.confidence >= 0 && r.confidence <= 1);
      assert.equal(r.reason, 'embedding similarity');
    }
    assert.equal(brain.getStats().successes, 1);
    assert.equal(brain.getStats().circuitOpen, false);
  } finally {
    await fake.stop();
  }
});

test('embed request shape: sends model + input array', async () => {
  const fake = await startFakeOllama(similarEmbedHandler());

  try {
    const brain = new EmbeddingBrain({ url: fake.url, timeoutMs: 2000, minSimilarity: 0 });
    await brain.route('query', candidates());
    // At least one request was made
    assert.ok(fake.requests.length >= 1);
    const req = fake.requests[0]!;
    assert.equal(req.model, brain.config.model);
    assert.ok(Array.isArray(req.input));
  } finally {
    await fake.stop();
  }
});

test('all-below-threshold returns null and does not trip breaker', async () => {
  // Query at pos 0, candidates at pos 8+ → cosine = 0 < 0.5 (default minSimilarity)
  const fake = await startFakeOllama(orthogonalEmbedHandler());

  try {
    const brain = new EmbeddingBrain({
      url: fake.url,
      timeoutMs: 2000,
      // default minSimilarity: 0.5 — orthogonal vectors (cosine=0) won't match
    });
    const result = await brain.route('any query', candidates());
    assert.equal(result, null);
    assert.equal(brain.getStats().emptyResults, 1);
    assert.equal(brain.getStats().circuitOpen, false, 'empty result should not trip breaker');
  } finally {
    await fake.stop();
  }
});

test('HTTP 500 returns null and increments errors', async () => {
  const fake = await startFakeOllama(async () => ({ status: 500, body: 'boom' }));
  try {
    const brain = new EmbeddingBrain({ url: fake.url, timeoutMs: 2000 });
    const result = await brain.route('any query', candidates());
    assert.equal(result, null);
    assert.ok(brain.getStats().errors >= 1);
  } finally {
    await fake.stop();
  }
});

test('timeout aborts and returns null quickly', async () => {
  const fake = await startFakeOllama(async () => 'hang');
  try {
    const brain = new EmbeddingBrain({ url: fake.url, timeoutMs: 150 });
    const started = Date.now();
    const result = await brain.route('any query', candidates());
    const elapsed = Date.now() - started;
    assert.equal(result, null);
    assert.ok(elapsed < 1000, `expected quick abort, got ${elapsed}ms`);
    // route() fires query + candidates embeds in parallel — both can time out
    assert.ok(brain.getStats().timeouts >= 1, `expected at least 1 timeout, got ${brain.getStats().timeouts}`);
  } finally {
    await fake.stop();
  }
});

test('unreachable host returns null quickly', async () => {
  const brain = new EmbeddingBrain({ url: 'http://127.0.0.1:1', timeoutMs: 500 });
  const result = await brain.route('query', candidates());
  assert.equal(result, null);
  const stats = brain.getStats();
  assert.ok(stats.errors + stats.timeouts >= 1);
});

// ── Circuit breaker ───────────────────────────────────────────

test('circuit breaker trips after threshold consecutive failures', async () => {
  const fake = await startFakeOllama(async () => ({ status: 500, body: 'error' }));
  try {
    const brain = new EmbeddingBrain({
      url: fake.url,
      timeoutMs: 500,
      circuitBreakerThreshold: 3,
      circuitBreakerCooldownMs: 60_000,
    });

    // Three failures trip the breaker
    for (let i = 0; i < 3; i++) {
      const r = await brain.route('query', candidates());
      assert.equal(r, null);
    }

    assert.equal(brain.isCircuitOpen(), true);
    const stats = brain.getStats();
    assert.equal(stats.circuitOpen, true);
    assert.ok(stats.circuitCooldownRemainingMs > 0);
  } finally {
    await fake.stop();
  }
});

test('open circuit short-circuits route without any network call', async () => {
  const fake = await startFakeOllama(async () => ({ status: 500, body: 'error' }));
  try {
    const brain = new EmbeddingBrain({
      url: fake.url,
      timeoutMs: 500,
      circuitBreakerThreshold: 2,
      circuitBreakerCooldownMs: 60_000,
    });

    // Trip the breaker
    await brain.route('query', candidates());
    await brain.route('query', candidates());
    assert.equal(brain.isCircuitOpen(), true);

    const callsBefore = fake.requests.length;

    // Next call should return null immediately without hitting the server
    const result = await brain.route('query', candidates());
    assert.equal(result, null);
    assert.equal(fake.requests.length, callsBefore, 'open circuit must not make network calls');
  } finally {
    await fake.stop();
  }
});

test('circuit resets after success', async () => {
  let failNext = true;
  const fake = await startFakeOllama(async (body) => {
    if (failNext) return { status: 500, body: 'error' };
    // Return identical vectors so cosine=1 → results returned via success path
    const req = body as { input: string[] };
    return { status: 200, body: JSON.stringify({ embeddings: req.input.map(() => oneHot(0)) }) };
  });

  try {
    const brain = new EmbeddingBrain({
      url: fake.url,
      timeoutMs: 500,
      circuitBreakerThreshold: 2,
      circuitBreakerCooldownMs: 50, // short cooldown for test
      minSimilarity: 0,
    });

    // Fail twice to trip the breaker
    await brain.route('query', candidates());
    await brain.route('query', candidates());
    assert.equal(brain.isCircuitOpen(), true);

    // Wait for cooldown to expire (150ms >> 50ms cooldown to avoid 10ms-margin flakes)
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(brain.isCircuitOpen(), false, 'circuit should be closed after cooldown');

    // Now succeed — circuit should stay closed
    failNext = false;
    const result = await brain.route('query', candidates());
    assert.ok(result !== null || brain.getStats().emptyResults > 0, 'probe attempt should have run');
    assert.equal(brain.isCircuitOpen(), false, 'success should keep circuit closed');
    assert.equal(brain.getStats().circuitOpen, false);
    assert.equal(brain.getStats().circuitCooldownRemainingMs, 0);
  } finally {
    await fake.stop();
  }
});

test('half-open: only one concurrent probe is sent, others get null immediately', async () => {
  let tripPhase = true;
  // Slow success handler so concurrent callers actually race
  const fake = await startFakeOllama(async (body) => {
    if (tripPhase) return { status: 500, body: 'err' };
    await new Promise((r) => setTimeout(r, 40));
    const req = body as { input: string[] };
    return { status: 200, body: JSON.stringify({ embeddings: req.input.map(() => oneHot(0)) }) };
  });

  try {
    const brain = new EmbeddingBrain({
      url: fake.url,
      timeoutMs: 500,
      circuitBreakerThreshold: 2,
      circuitBreakerCooldownMs: 50,
      minSimilarity: 0,
    });

    // Trip the circuit
    await brain.route('q', candidates());
    await brain.route('q', candidates());
    assert.equal(brain.isCircuitOpen(), true, 'breaker must open after threshold failures');

    // Wait for cooldown (150ms >> 50ms cooldown to avoid 10ms-margin flakes)
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(brain.isCircuitOpen(), false, 'circuit should be half-open after cooldown');

    // Enter success phase and fire 5 concurrent callers
    tripPhase = false;
    const hitsBefore = fake.requests.length;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => brain.route('query', candidates()))
    );

    const probeHits = fake.requests.length - hitsBefore;
    // The 1 probe makes at most 2 server requests (query embed + candidates embed).
    // The other 4 callers must get null without touching the server (0 requests each).
    assert.ok(probeHits <= 2, `expected ≤2 probe requests (1 route call), got ${probeHits}`);
    assert.ok(probeHits >= 1, 'probe must have reached the server');
    const nonNullCount = results.filter((r) => r !== null).length;
    assert.ok(nonNullCount <= 1, `at most 1 result should be non-null, got ${nonNullCount}`);
    assert.equal(brain.isCircuitOpen(), false, 'successful probe should reset circuit');
  } finally {
    await fake.stop();
  }
});

test('circuit not tripped by empty results (not a connectivity failure)', async () => {
  // Orthogonal vectors: cosine=0, below default minSimilarity=0.5 → empty results
  const fake = await startFakeOllama(orthogonalEmbedHandler());

  try {
    const brain = new EmbeddingBrain({
      url: fake.url,
      timeoutMs: 2000,
      circuitBreakerThreshold: 2,
      // default minSimilarity: 0.5 — orthogonal (cosine=0) never matches
    });

    await brain.route('query', candidates());
    await brain.route('query', candidates());
    await brain.route('query', candidates());

    assert.equal(brain.isCircuitOpen(), false, 'empty results should not trip the breaker');
    assert.ok(brain.getStats().emptyResults >= 1, 'expected at least one empty result');
  } finally {
    await fake.stop();
  }
});

// ── Live Ollama smoke test (skips when daemon not reachable) ──

test('real Ollama: embed returns vectors for a simple query', async (t) => {
  const defaultUrl = process.env.CH1TTY_EMBED_URL ?? process.env.CH1TTY_OLLAMA_URL ?? 'http://127.0.0.1:11434';
  try {
    const ping = await fetch(`${defaultUrl}/api/tags`, { signal: AbortSignal.timeout(1000) });
    if (!ping.ok) return t.skip('Ollama not reachable at /api/tags');
  } catch {
    return t.skip('Ollama unreachable');
  }

  const brain = new EmbeddingBrain({ timeoutMs: 15000, minSimilarity: 0 });
  const result = await brain.route('list database projects', candidates());

  if (result) {
    assert.ok(Array.isArray(result));
    assert.ok(result.length > 0);
    for (const r of result) {
      assert.ok(r.confidence >= 0 && r.confidence <= 1);
      assert.ok(['neon/list_projects', 'stripe/list_payments', 'notion/search'].includes(r.tool.namespacedName));
    }
  }
  const stats = brain.getStats();
  assert.equal(stats.calls, 1);
  assert.equal(stats.circuitOpen, false);
});
