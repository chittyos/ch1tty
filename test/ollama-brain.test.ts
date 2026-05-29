/**
 * Tests for OllamaBrain — exercise real HTTP against disposable fixtures,
 * not mocked fetch. The "Fake Ollama" helper is a genuine node:http server
 * that the brain calls with real network I/O; it validates request shape
 * and returns configurable responses. This hits the real fetch path,
 * real AbortController behavior, and real JSON parsing.
 *
 * One smoke test runs against the actual local Ollama daemon when it's
 * reachable, proving the prompt + parser cope with real model output.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { OllamaBrain, type ToolCandidate } from '../src/ollama-brain.js';

// ── Fake Ollama server (real HTTP, not a mock) ────────────────

interface FakeOllamaHandler {
  (req: http.IncomingMessage, body: string): Promise<{ status: number; body: string } | 'hang'>;
}

async function startFakeOllama(handler: FakeOllamaHandler): Promise<{ url: string; stop: () => Promise<void>; requests: Array<{ path: string; body: unknown }> }> {
  const requests: Array<{ path: string; body: unknown }> = [];

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8'); });
    req.on('end', () => {
      try {
        requests.push({ path: req.url ?? '/', body: JSON.parse(raw) });
      } catch {
        requests.push({ path: req.url ?? '/', body: raw });
      }
      handler(req, raw).then((result) => {
        if (result === 'hang') {
          // Intentionally never respond — exercises client-side timeout
          return;
        }
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

  const stop = () => new Promise<void>((resolve, reject) => {
    server.closeAllConnections?.();
    server.close((err) => (err ? reject(err) : resolve()));
  });

  return { url, stop, requests };
}

function candidates(): ToolCandidate[] {
  return [
    { namespacedName: 'evidence/collect', description: 'Collect and stage legal documents for ingestion', category: 'documents' },
    { namespacedName: 'chitty/deploy', description: 'Deploy a ChittyOS worker to Cloudflare', category: 'code' },
    { namespacedName: 'neon/list_projects', description: 'List Neon Postgres projects', category: 'code' },
    { namespacedName: 'docket/status', description: 'Fetch current court docket for active cases', category: 'documents' },
  ];
}

// ── Config/shape tests ────────────────────────────────────────

test('constructor applies defaults', () => {
  const brain = new OllamaBrain();
  assert.equal(brain.config.model, process.env.CH1TTY_OLLAMA_MODEL ?? 'llama3.2:3b');
  assert.equal(brain.config.minConfidence, Number(process.env.CH1TTY_OLLAMA_MIN_CONFIDENCE ?? 0.75));
  assert.equal(brain.config.maxCandidates, Number(process.env.CH1TTY_OLLAMA_MAX_CANDIDATES ?? 30));
  assert.equal(typeof brain.config.url, 'string');
});

test('constructor overrides merge with defaults', () => {
  const brain = new OllamaBrain({ minConfidence: 0.9, maxCandidates: 5 });
  assert.equal(brain.config.minConfidence, 0.9);
  assert.equal(brain.config.maxCandidates, 5);
  // Unspecified fields still default
  assert.equal(brain.config.enabled, process.env.CH1TTY_OLLAMA_ENABLED !== 'false');
});

// ── Null-safe guards ──────────────────────────────────────────

test('route returns null when disabled', async () => {
  const brain = new OllamaBrain({ enabled: false, url: 'http://127.0.0.1:1' });
  const result = await brain.route('find documents', candidates());
  assert.equal(result, null);
  assert.equal(brain.getStats().calls, 0); // short-circuits before any call
});

test('route returns null on empty candidates', async () => {
  const brain = new OllamaBrain({ url: 'http://127.0.0.1:1' });
  const result = await brain.route('find documents', []);
  assert.equal(result, null);
});

test('route returns null on blank query', async () => {
  const brain = new OllamaBrain({ url: 'http://127.0.0.1:1' });
  assert.equal(await brain.route('', candidates()), null);
  assert.equal(await brain.route('   ', candidates()), null);
});

// ── Real HTTP behavior tests (fake Ollama fixture) ────────────

test('successful route parses high-confidence matches', async () => {
  const fake = await startFakeOllama(async () => ({
    status: 200,
    body: JSON.stringify({
      response: JSON.stringify({
        matches: [
          { tool: 'evidence/collect', confidence: 0.92, reason: 'direct document collection intent' },
          { tool: 'docket/status', confidence: 0.81, reason: 'related court record lookup' },
        ],
      }),
    }),
  }));

  try {
    const brain = new OllamaBrain({ url: fake.url, timeoutMs: 2000 });
    const result = await brain.route('pull case documents', candidates());
    assert.ok(result, 'expected non-null routed result');
    assert.equal(result.length, 2);
    assert.equal(result[0].tool.namespacedName, 'evidence/collect'); // sorted by confidence
    assert.equal(result[0].confidence, 0.92);
    assert.equal(result[1].tool.namespacedName, 'docket/status');
    assert.equal(brain.getStats().successes, 1);

    // Verify the full request shape — regression protection
    assert.equal(fake.requests.length, 1);
    assert.equal(fake.requests[0].path, '/api/generate');
    const req = fake.requests[0].body as { model: string; prompt: string; format: string; stream: boolean; options?: { temperature?: number } };
    assert.equal(req.format, 'json');
    assert.equal(req.stream, false);
    assert.equal(req.model, 'llama3.2:3b');
    assert.equal(req.options?.temperature, 0.1);
    assert.match(req.prompt, /evidence\/collect/);
    // Query should be JSON-escaped in the prompt (prompt injection hardening)
    assert.match(req.prompt, /"pull case documents"/);
  } finally {
    await fake.stop();
  }
});

test('confidence below threshold is dropped', async () => {
  const fake = await startFakeOllama(async () => ({
    status: 200,
    body: JSON.stringify({
      response: JSON.stringify({
        matches: [
          { tool: 'evidence/collect', confidence: 0.6, reason: 'weak' },
          { tool: 'docket/status', confidence: 0.92, reason: 'strong' },
        ],
      }),
    }),
  }));

  try {
    const brain = new OllamaBrain({ url: fake.url, minConfidence: 0.75, timeoutMs: 2000 });
    const result = await brain.route('court activity', candidates());
    assert.ok(result);
    assert.equal(result.length, 1, 'only 0.92 match should survive 0.75 threshold');
    assert.equal(result[0].tool.namespacedName, 'docket/status');
  } finally {
    await fake.stop();
  }
});

test('hallucinated tool names are rejected', async () => {
  const fake = await startFakeOllama(async () => ({
    status: 200,
    body: JSON.stringify({
      response: JSON.stringify({
        matches: [
          { tool: 'made_up/tool', confidence: 0.99, reason: 'imagined' },
          { tool: 'evidence/collect', confidence: 0.85, reason: 'real' },
        ],
      }),
    }),
  }));

  try {
    const brain = new OllamaBrain({ url: fake.url, timeoutMs: 2000 });
    const result = await brain.route('collect docs', candidates());
    assert.ok(result);
    assert.equal(result.length, 1);
    assert.equal(result[0].tool.namespacedName, 'evidence/collect');
  } finally {
    await fake.stop();
  }
});

test('empty matches array returns null (not empty array)', async () => {
  const fake = await startFakeOllama(async () => ({
    status: 200,
    body: JSON.stringify({ response: JSON.stringify({ matches: [] }) }),
  }));

  try {
    const brain = new OllamaBrain({ url: fake.url, timeoutMs: 2000 });
    const result = await brain.route('unrelated query', candidates());
    assert.equal(result, null);
    assert.equal(brain.getStats().emptyResults, 1);
  } finally {
    await fake.stop();
  }
});

test('HTTP 500 returns null and increments errors', async () => {
  const fake = await startFakeOllama(async () => ({ status: 500, body: 'boom' }));
  try {
    const brain = new OllamaBrain({ url: fake.url, timeoutMs: 2000 });
    const result = await brain.route('any query', candidates());
    assert.equal(result, null);
    assert.equal(brain.getStats().errors, 1);
  } finally {
    await fake.stop();
  }
});

test('malformed model response returns null', async () => {
  const fake = await startFakeOllama(async () => ({
    status: 200,
    body: JSON.stringify({ response: 'not-json-at-all {{' }),
  }));
  try {
    const brain = new OllamaBrain({ url: fake.url, timeoutMs: 2000 });
    const result = await brain.route('any query', candidates());
    assert.equal(result, null);
    assert.equal(brain.getStats().errors, 1);
  } finally {
    await fake.stop();
  }
});

test('missing response field returns null', async () => {
  const fake = await startFakeOllama(async () => ({
    status: 200,
    body: JSON.stringify({ done: true }), // no `response` key
  }));
  try {
    const brain = new OllamaBrain({ url: fake.url, timeoutMs: 2000 });
    const result = await brain.route('any query', candidates());
    assert.equal(result, null);
  } finally {
    await fake.stop();
  }
});

test('timeout aborts and returns null', async () => {
  const fake = await startFakeOllama(async () => 'hang'); // never responds
  try {
    const brain = new OllamaBrain({ url: fake.url, timeoutMs: 200 });
    const started = Date.now();
    const result = await brain.route('any query', candidates());
    const elapsed = Date.now() - started;
    assert.equal(result, null);
    assert.ok(elapsed < 1000, `expected quick abort, got ${elapsed}ms`);
    assert.equal(brain.getStats().timeouts, 1);
  } finally {
    await fake.stop();
  }
});

test('unreachable host returns null', async () => {
  // Port 1 is reserved and should refuse/fail fast on Linux
  const brain = new OllamaBrain({ url: 'http://127.0.0.1:1', timeoutMs: 500 });
  const result = await brain.route('any query', candidates());
  assert.equal(result, null);
  const stats = brain.getStats();
  assert.ok(stats.errors + stats.timeouts >= 1, 'expected error or timeout');
});

test('candidates beyond maxCandidates are clamped from prompt', async () => {
  const fake = await startFakeOllama(async () => ({
    status: 200,
    body: JSON.stringify({ response: JSON.stringify({ matches: [] }) }),
  }));
  try {
    const brain = new OllamaBrain({ url: fake.url, maxCandidates: 2, timeoutMs: 2000 });
    await brain.route('query', candidates());
    const sentPrompt = (fake.requests[0].body as { prompt: string }).prompt;
    // First two candidates should appear, later ones should not
    assert.match(sentPrompt, /evidence\/collect/);
    assert.match(sentPrompt, /chitty\/deploy/);
    assert.doesNotMatch(sentPrompt, /neon\/list_projects/);
    assert.doesNotMatch(sentPrompt, /docket\/status/);
  } finally {
    await fake.stop();
  }
});

test('confidence values are clamped to [0, 1]', async () => {
  const fake = await startFakeOllama(async () => ({
    status: 200,
    body: JSON.stringify({
      response: JSON.stringify({
        matches: [
          { tool: 'evidence/collect', confidence: 1.5, reason: 'over-confident' },
          { tool: 'chitty/deploy', confidence: 0.8, reason: 'normal' },
        ],
      }),
    }),
  }));
  try {
    const brain = new OllamaBrain({ url: fake.url, timeoutMs: 2000 });
    const result = await brain.route('deploy evidence', candidates());
    assert.ok(result);
    const overConfident = result.find((r) => r.tool.namespacedName === 'evidence/collect');
    assert.ok(overConfident);
    assert.equal(overConfident.confidence, 1, 'confidence > 1 should be clamped to 1');
    assert.ok(overConfident.confidence <= 1);
  } finally {
    await fake.stop();
  }
});

test('constructor clamps invalid config values', () => {
  const brain = new OllamaBrain({ minConfidence: 1.5, maxCandidates: -1, timeoutMs: 0 });
  assert.equal(brain.config.minConfidence, 1);
  assert.equal(brain.config.maxCandidates, 1);
  assert.equal(brain.config.timeoutMs, 100);
});

// ── Circuit breaker ───────────────────────────────────────────

test('getStats includes circuitOpen and circuitCooldownRemainingMs', () => {
  const brain = new OllamaBrain({ url: 'http://127.0.0.1:1' });
  const stats = brain.getStats();
  assert.equal(stats.circuitOpen, false);
  assert.equal(stats.circuitCooldownRemainingMs, 0);
});

test('default circuitBreakerThreshold is 3', () => {
  const brain = new OllamaBrain();
  assert.equal(brain.config.circuitBreakerThreshold, Number(process.env.CH1TTY_OLLAMA_CIRCUIT_THRESHOLD ?? 3));
});

test('NaN circuitBreakerThreshold falls back to default 3', () => {
  const brain = new OllamaBrain({ circuitBreakerThreshold: NaN });
  assert.equal(brain.config.circuitBreakerThreshold, 3);
});

test('NaN circuitBreakerCooldownMs falls back to default 60000', () => {
  const brain = new OllamaBrain({ circuitBreakerCooldownMs: NaN });
  assert.equal(brain.config.circuitBreakerCooldownMs, 60_000);
});

test('default circuitBreakerCooldownMs is 60000', () => {
  const brain = new OllamaBrain();
  assert.equal(brain.config.circuitBreakerCooldownMs, Number(process.env.CH1TTY_OLLAMA_CIRCUIT_COOLDOWN_MS ?? 60_000));
});

test('circuit opens after threshold consecutive timeouts', async () => {
  const fake = await startFakeOllama(async () => 'hang');
  try {
    const brain = new OllamaBrain({
      url: fake.url,
      timeoutMs: 100,
      circuitBreakerThreshold: 3,
      circuitBreakerCooldownMs: 60_000,
    });

    // Three timeouts trip the breaker
    for (let i = 0; i < 3; i++) {
      const r = await brain.route('any query', candidates());
      assert.equal(r, null);
    }

    const stats = brain.getStats();
    assert.equal(stats.circuitOpen, true);
    assert.ok(stats.circuitCooldownRemainingMs > 0);
    assert.equal(brain.isCircuitOpen(), true);
  } finally {
    await fake.stop();
  }
});

test('open circuit returns null without making any network call', async () => {
  const fake = await startFakeOllama(async () => 'hang');
  try {
    const brain = new OllamaBrain({
      url: fake.url,
      timeoutMs: 100,
      circuitBreakerThreshold: 2,
      circuitBreakerCooldownMs: 60_000,
    });

    // Trip the breaker
    await brain.route('q', candidates());
    await brain.route('q', candidates());
    assert.equal(brain.isCircuitOpen(), true);
    const callsBefore = fake.requests.length;

    // These calls should return null immediately — no new network calls
    await brain.route('q', candidates());
    await brain.route('q', candidates());
    assert.equal(fake.requests.length, callsBefore, 'open circuit must not make network calls');
    assert.equal(brain.getStats().circuitOpen, true);
  } finally {
    await fake.stop();
  }
});

test('circuit resets after a successful probe', async () => {
  const fake = await startFakeOllama(async (_req, body) => {
    const parsed = JSON.parse(body) as { prompt?: string };
    // First two calls: hang (trips circuit); subsequent: succeed
    if (fake.requests.length <= 2) return 'hang';
    return {
      status: 200,
      body: JSON.stringify({
        response: JSON.stringify({
          matches: [{ tool: 'evidence/collect', confidence: 0.9, reason: 'test' }],
        }),
      }),
    };
    void parsed;
  });
  try {
    const brain = new OllamaBrain({
      url: fake.url,
      timeoutMs: 100,
      circuitBreakerThreshold: 2,
      circuitBreakerCooldownMs: 50,
    });

    // Trip the breaker with two timeouts
    await brain.route('q', candidates());
    await brain.route('q', candidates());
    assert.equal(brain.isCircuitOpen(), true);

    // Wait for cooldown to expire
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(brain.isCircuitOpen(), false, 'circuit should be half-open after cooldown');

    // Now succeed — circuit should close
    const result = await brain.route('collect documents', candidates());
    assert.ok(result, 'expected successful probe result');
    assert.equal(brain.isCircuitOpen(), false, 'success should keep circuit closed');
    assert.equal(brain.getStats().circuitOpen, false);
    assert.equal(brain.getStats().circuitCooldownRemainingMs, 0);
  } finally {
    await fake.stop();
  }
});

test('empty results do not trip the circuit breaker', async () => {
  const fake = await startFakeOllama(async () => ({
    status: 200,
    body: JSON.stringify({ response: JSON.stringify({ matches: [] }) }),
  }));
  try {
    const brain = new OllamaBrain({
      url: fake.url,
      timeoutMs: 2000,
      circuitBreakerThreshold: 2,
      circuitBreakerCooldownMs: 60_000,
    });

    // Many empty results should not trip the breaker
    for (let i = 0; i < 5; i++) {
      const r = await brain.route('unrelated', candidates());
      assert.equal(r, null);
    }
    assert.equal(brain.isCircuitOpen(), false, 'empty results should not trip the breaker');
    assert.equal(brain.getStats().circuitOpen, false);
  } finally {
    await fake.stop();
  }
});

test('empty half-open probe closes the circuit (no perpetual half-open limbo)', async () => {
  const emptyFake = await startFakeOllama(async () => ({
    status: 200,
    body: JSON.stringify({ response: JSON.stringify({ matches: [] }) }),
  }));
  const errFake = await startFakeOllama(async () => ({ status: 500, body: 'err' }));
  try {
    // Trip the circuit
    const brain = new OllamaBrain({
      url: errFake.url,
      timeoutMs: 2000,
      circuitBreakerThreshold: 2,
      circuitBreakerCooldownMs: 50,
    });
    await brain.route('q', candidates());
    await brain.route('q', candidates());
    assert.equal(brain.isCircuitOpen(), true, 'circuit must open');

    // Wait for cooldown
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(brain.isCircuitOpen(), false, 'circuit half-open after cooldown');

    // Point at the empty-results server and probe
    (brain as unknown as { config: { url: string } }).config.url = emptyFake.url;
    const result = await brain.route('q', candidates());
    assert.equal(result, null);

    // circuitOpenUntil must now be cleared — isCircuitOpen() false AND getStats().circuitOpen false
    assert.equal(brain.isCircuitOpen(), false, 'circuit must be closed after empty half-open probe');
    assert.equal(brain.getStats().circuitOpen, false, 'getStats must report closed');

    // Next call must proceed normally (not be short-circuited or stuck probing)
    const result2 = await brain.route('q', candidates());
    assert.equal(result2, null);
    assert.equal(brain.getStats().emptyResults, 2, 'both calls counted as emptyResults');
  } finally {
    await emptyFake.stop();
    await errFake.stop();
  }
});

test('half-open: only one concurrent probe is sent, others get null immediately', async () => {
  let serverHits = 0;
  const fake = await startFakeOllama(async () => {
    serverHits++;
    // Delay so concurrent callers pile up before the first probe completes
    await new Promise((r) => setTimeout(r, 50));
    return {
      status: 200,
      body: JSON.stringify({
        response: JSON.stringify({
          matches: [{ tool: 'evidence/collect', confidence: 0.9, reason: 'probe' }],
        }),
      }),
    };
  });
  try {
    const brain = new OllamaBrain({
      url: fake.url,
      timeoutMs: 2000,
      circuitBreakerThreshold: 2,
      circuitBreakerCooldownMs: 50,
    });

    // Trip the circuit with two error responses
    const errFake = await startFakeOllama(async () => ({ status: 500, body: 'err' }));
    const errBrain = new OllamaBrain({
      url: errFake.url,
      timeoutMs: 2000,
      circuitBreakerThreshold: 2,
      circuitBreakerCooldownMs: 50,
    });
    await errBrain.route('q', candidates());
    await errBrain.route('q', candidates());
    assert.equal(errBrain.isCircuitOpen(), true, 'breaker must open after threshold failures');
    await errFake.stop();

    // Now test the probing sentinel on `brain` which is the recovering one
    // Trip it first
    const errFake2 = await startFakeOllama(async () => ({ status: 500, body: 'err' }));
    const brain2 = new OllamaBrain({
      url: errFake2.url,
      timeoutMs: 2000,
      circuitBreakerThreshold: 2,
      circuitBreakerCooldownMs: 50,
    });
    await brain2.route('q', candidates());
    await brain2.route('q', candidates());
    assert.equal(brain2.isCircuitOpen(), true);
    await errFake2.stop();

    // Swap to the success-returning fake after cooldown
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(brain2.isCircuitOpen(), false, 'circuit should be half-open after cooldown');

    // Point brain2 at the recovering fake server
    (brain2 as unknown as { config: { url: string } }).config.url = fake.url;

    // Fire 5 concurrent probes — only ≤1 should hit the server
    serverHits = 0;
    const results = await Promise.all([
      brain2.route('collect docs', candidates()),
      brain2.route('collect docs', candidates()),
      brain2.route('collect docs', candidates()),
      brain2.route('collect docs', candidates()),
      brain2.route('collect docs', candidates()),
    ]);

    assert.equal(serverHits, 1, `expected exactly 1 server hit during half-open, got ${serverHits}`);
    const nonNull = results.filter((r) => r !== null);
    assert.equal(nonNull.length, 1, `expected exactly 1 non-null result during half-open, got ${nonNull.length}`);
  } finally {
    await fake.stop();
  }
});

// ── Real Ollama smoke test (runs only if daemon is reachable) ──

test('real Ollama: routes a concrete query against a live daemon', async (t) => {
  const defaultUrl = process.env.CH1TTY_OLLAMA_URL ?? 'http://127.0.0.1:11434';
  try {
    const ping = await fetch(`${defaultUrl}/api/tags`, { signal: AbortSignal.timeout(1000) });
    if (!ping.ok) return t.skip('Ollama not reachable at /api/tags');
  } catch {
    return t.skip('Ollama unreachable');
  }

  const brain = new OllamaBrain({ timeoutMs: 15000 }); // generous for cold model
  const result = await brain.route(
    'I need to collect court documents for a case',
    candidates(),
  );

  // The brain may return null if the local model is cold, confused, or
  // scores everything below 0.75 — that's valid null-safe behavior.
  // When it does return results, verify the shape is sound.
  if (result) {
    assert.ok(Array.isArray(result));
    assert.ok(result.length > 0);
    for (const r of result) {
      assert.ok(r.confidence >= 0.75);
      assert.ok(['evidence/collect', 'chitty/deploy', 'neon/list_projects', 'docket/status'].includes(r.tool.namespacedName));
      assert.equal(typeof r.reason, 'string');
    }
    // A reasonable model should surface evidence/collect or docket/status for this query
    const surfaced = result.map((r) => r.tool.namespacedName);
    assert.ok(
      surfaced.includes('evidence/collect') || surfaced.includes('docket/status'),
      `expected court/evidence tool surfaced, got: ${surfaced.join(',')}`,
    );
  }

  const stats = brain.getStats();
  assert.equal(stats.calls, 1);
});
