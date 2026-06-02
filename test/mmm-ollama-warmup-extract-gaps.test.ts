/**
 * MMM batch — six uncovered branches in OllamaBrain
 *
 * OllamaBrain.warmup() paths (lines 254–288):
 *   1. enabled: false → returns false immediately without any network call.
 *   2. HTTP OK response → drains body, returns true (success path).
 *   3. HTTP non-OK (e.g., 503) → logs warn, returns false without throwing.
 *   4. AbortError (timeout) → logs "timed out", returns false without throwing.
 *   5. Connection refused (general Error) → logs "error", returns false.
 *
 * OllamaBrain.extractRoutedTools() edge guards (lines 364–380):
 *   6. Matches array contains a non-object item (null, number, string) →
 *      the `if (!item || typeof item !== 'object') continue;` guard fires →
 *      item is skipped; valid items still pass through.
 *   7. Match item has NaN or Infinity confidence →
 *      `!Number.isFinite(m.confidence)` guard fires → item is skipped.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { OllamaBrain, type ToolCandidate } from '../src/ollama-brain.js';

// ── Fake Ollama server (real HTTP) ────────────────────────────────────────────

type WarmupHandler = (body: string) => Promise<{ status: number; body: string } | 'hang'>;

interface FakeServer {
  url: string;
  stop: () => Promise<void>;
  hits: () => number;
  lastRequest: () => { path: string; body: unknown } | null;
}

async function startFakeWarmup(handler: WarmupHandler): Promise<FakeServer> {
  let hitCount = 0;
  let lastReq: { path: string; body: unknown } | null = null;

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8'); });
    req.on('end', () => {
      hitCount++;
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { parsed = raw; }
      lastReq = { path: req.url ?? '/', body: parsed };
      handler(raw).then((result) => {
        if (result === 'hang') return;
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

  return { url, stop, hits: () => hitCount, lastRequest: () => lastReq };
}

function candidates(): ToolCandidate[] {
  return [
    { namespacedName: 'neon/run_sql', description: 'Run SQL on Neon', category: 'code' },
    { namespacedName: 'notion/search', description: 'Search Notion pages', category: 'documents' },
  ];
}

// ── 1. warmup: disabled → returns false immediately ───────────────────────────

test('OllamaBrain.warmup(): enabled=false → returns false immediately, no network call', async () => {
  const fake = await startFakeWarmup(async () => ({
    status: 200,
    body: JSON.stringify({ done: true }),
  }));

  try {
    const brain = new OllamaBrain({ url: fake.url, enabled: false });
    const result = await brain.warmup();

    assert.equal(result, false, 'warmup must return false when brain is disabled');
    assert.equal(fake.hits(), 0, 'no network call must be made when enabled=false');
  } finally {
    await fake.stop();
  }
});

// ── 2. warmup: HTTP OK → returns true (happy path) ───────────────────────────

test('OllamaBrain.warmup(): HTTP 200 OK → drains body, returns true', async () => {
  const fake = await startFakeWarmup(async () => ({
    status: 200,
    body: JSON.stringify({ model: 'llama3.2:3b', done: true, response: 'ok' }),
  }));

  try {
    const brain = new OllamaBrain({
      url: fake.url,
      enabled: true,
      model: 'llama3.2:3b',
    });
    const result = await brain.warmup(3000);

    assert.equal(result, true, 'warmup must return true on HTTP 200');
    assert.equal(fake.hits(), 1, 'exactly one request made during warmup');

    // Verify the warmup request targeted the correct endpoint with the expected shape
    const req = fake.lastRequest();
    assert.ok(req !== null, 'a request must have been recorded');
    assert.equal(req.path, '/api/generate', 'warmup must call /api/generate, not /api/embed or other');
    const body = req.body as { model?: string; prompt?: string; stream?: boolean; options?: { num_predict?: number; temperature?: number } };
    assert.equal(body.model, 'llama3.2:3b', 'warmup request must use the configured model');
    assert.equal(body.prompt, 'ok', 'warmup prompt must be the sentinel "ok" string');
    assert.equal(body.stream, false, 'warmup must disable streaming');
    assert.equal(body.options?.num_predict, 1, 'warmup must request num_predict: 1 to minimise model output');

    // warmup is observability-neutral — route stats must stay zero
    assert.equal(brain.getStats().calls, 0, 'warmup must not increment route calls');
    assert.equal(brain.getStats().successes, 0, 'warmup must not increment successes');
  } finally {
    await fake.stop();
  }
});

// ── 3. warmup: HTTP non-OK → returns false without throwing ──────────────────

test('OllamaBrain.warmup(): HTTP 503 → logs warn, returns false, does not throw', async () => {
  const fake = await startFakeWarmup(async () => ({
    status: 503,
    body: 'Service Unavailable',
  }));

  try {
    const brain = new OllamaBrain({ url: fake.url, enabled: true });
    const result = await brain.warmup(3000);

    assert.equal(result, false, 'warmup must return false on non-OK HTTP status');
    assert.equal(fake.hits(), 1, 'one request was made before HTTP error was detected');
    assert.equal(brain.getStats().calls, 0, 'route call counter must remain 0 (observability-neutral)');
  } finally {
    await fake.stop();
  }
});

// ── 4. warmup: timeout (AbortError) → returns false without throwing ──────────

test('OllamaBrain.warmup(): timeout → logs "timed out", returns false, does not throw', async () => {
  const fake = await startFakeWarmup(async () => 'hang');

  try {
    const brain = new OllamaBrain({ url: fake.url, enabled: true });
    const t0 = Date.now();
    const result = await brain.warmup(150);   // 150ms — well under test timeout
    const elapsed = Date.now() - t0;

    assert.equal(result, false, 'warmup must return false on abort timeout');
    assert.ok(elapsed < 1000, `warmup must abort promptly, got ${elapsed}ms`);
    assert.equal(brain.getStats().calls, 0, 'route call counter must stay 0 after warmup timeout');
  } finally {
    await fake.stop();
  }
});

// ── 5. warmup: connection error → returns false without throwing ──────────────

test('OllamaBrain.warmup(): connection refused → logs error, returns false, does not throw', async () => {
  const brain = new OllamaBrain({
    url: 'http://127.0.0.1:1',   // port 1 is reserved → immediate ECONNREFUSED
    enabled: true,
  });
  const result = await brain.warmup(1000);

  assert.equal(result, false, 'warmup must return false on connection refused');
  assert.equal(brain.getStats().calls, 0, 'route call counter must stay 0 after warmup failure');
  // Warmup failure must NOT trip the route circuit breaker
  assert.equal(brain.isCircuitOpen(), false, 'warmup failure must not open the route circuit');
});

// ── 6. extractRoutedTools: non-object items in matches array are skipped ───────

test('OllamaBrain.route(): matches array with null/number/string items → non-objects skipped, valid items pass', async () => {
  const fake = await startFakeWarmup(async () => ({
    status: 200,
    body: JSON.stringify({
      response: JSON.stringify({
        matches: [
          null,                   // !item guard fires
          42,                     // typeof item !== 'object' fires (number)
          'a string',             // typeof item !== 'object' fires (string)
          { tool: 'neon/run_sql', confidence: 0.88, reason: 'semantic match' },  // valid
          { tool: 'notion/search', confidence: 0.77, reason: 'secondary match' },  // valid
        ],
      }),
    }),
  }));

  try {
    const brain = new OllamaBrain({
      url: fake.url,
      enabled: true,
      timeoutMs: 3000,
      minConfidence: 0.5,
    });
    const result = await brain.route('run a query', candidates());

    assert.ok(result !== null, 'valid items must still produce a result');
    assert.equal(result.length, 2, 'both valid items must pass; non-object items must be skipped');
    const names = result.map((r) => r.tool.namespacedName);
    assert.ok(names.includes('neon/run_sql'), 'neon/run_sql must be in result');
    assert.ok(names.includes('notion/search'), 'notion/search must be in result');
    assert.equal(brain.getStats().successes, 1, 'route call counted as success');
  } finally {
    await fake.stop();
  }
});

// ── 7. extractRoutedTools: non-finite confidence (Infinity) → item skipped ───────
//
// JSON.stringify(NaN) = "null" and JSON.stringify(Infinity) = "null" — both
// become null after serialisation, which fails the earlier `typeof !== 'number'`
// guard rather than the `!Number.isFinite()` guard we want to exercise.
//
// Solution: build the inner JSON string by hand using numeric literals that
// JSON.parse will evaluate to Infinity. JSON allows arbitrarily large number
// literals; values that exceed Number.MAX_VALUE (~1.8e308) are mapped to
// Infinity by the JavaScript parser. So `JSON.parse('{"n":1e309}').n === Infinity`
// is true, and `!Number.isFinite(Infinity)` fires the guard we're testing.

test('OllamaBrain.route(): Infinity confidence (via 1e309 JSON literal) → filtered by !Number.isFinite guard', async () => {
  // Hand-craft the inner response string so the confidence values survive JSON
  // round-tripping as actual Infinity in JavaScript (not null).
  const innerJson =
    '{"matches":[' +
    '{"tool":"neon/run_sql","confidence":1e309,"reason":"overflow-to-Infinity"},' +
    '{"tool":"neon/run_sql","confidence":-1e309,"reason":"overflow-to-neg-Infinity"},' +
    '{"tool":"notion/search","confidence":0.82,"reason":"valid match"}' +
    ']}';

  const fake = await startFakeWarmup(async () => ({
    status: 200,
    // Outer envelope: standard JSON. Inner `response` field is the hand-crafted string.
    body: JSON.stringify({ response: innerJson }),
  }));

  try {
    const brain = new OllamaBrain({
      url: fake.url,
      enabled: true,
      timeoutMs: 3000,
      minConfidence: 0.5,
    });
    const result = await brain.route('search something', candidates());

    assert.ok(result !== null, 'valid item must produce a non-null result');
    assert.equal(result.length, 1, '±Infinity confidence items must be filtered; only finite-confidence item passes');
    assert.equal(result[0]!.tool.namespacedName, 'notion/search', 'only the finite-confidence item must survive');
    assert.equal(result[0]!.confidence, 0.82);
  } finally {
    await fake.stop();
  }
});
