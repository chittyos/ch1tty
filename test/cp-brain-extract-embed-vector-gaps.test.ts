/**
 * CP: Branch gaps in OllamaBrain.extractRoutedTools + EmbeddingBrain embed vector validation
 *
 * Covers 4 branches not reached by the existing test suite:
 *
 * 1. ollama-brain.ts extractRoutedTools (line 360):
 *    `if (!parsed || typeof parsed !== 'object') return []` — the
 *    `typeof parsed !== 'object'` arm when safeParseJson succeeds but returns
 *    a non-null primitive (e.g. JSON.parse("42") = 42).  All prior tests serve
 *    an object; this triggers the second half of the conjunction.
 *
 * 2. ollama-brain.ts extractRoutedTools (line 362):
 *    `if (!Array.isArray(matches)) return []` — when `parsed.matches` exists
 *    but is a non-array value (e.g. a string).  Prior tests always use `[]` or
 *    a real array; the non-array type guard is untouched.
 *
 * 3. embedding-brain.ts embed (line 337):
 *    `if (!Array.isArray(raw) || raw.length === 0)` — the `raw.length === 0`
 *    arm when the server returns an embedding that is an empty array [].  Prior
 *    tests always serve non-empty arrays; this triggers the zero-length guard.
 *
 * 4. embedding-brain.ts embed (line 343):
 *    `if (typeof v !== 'number' || !Number.isFinite(v))` — the `!Number.isFinite(v)`
 *    arm when `v` IS a number but fails finiteness (Infinity, via the 1e309
 *    JSON literal trick — JSON.parse('{"n":1e309}').n === Infinity, typeof Infinity
 *    === 'number', !Number.isFinite(Infinity) === true).  Prior tests cover the
 *    `typeof v !== 'number'` arm (string) but not the finite-check arm.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { OllamaBrain, type ToolCandidate } from '../src/ollama-brain.js';
import { EmbeddingBrain } from '../src/embedding-brain.js';

// ── Shared fake HTTP server helper ────────────────────────────────────────────

interface FakeServer {
  url: string;
  stop: () => Promise<void>;
}

async function startFake(handler: (body: string) => string): Promise<FakeServer> {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8'); });
    req.on('end', () => {
      const responseBody = handler(raw);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(responseBody);
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

function ollamaCandidates(): ToolCandidate[] {
  return [
    { namespacedName: 'neon/run_sql', description: 'Run SQL on Neon', category: 'code' },
    { namespacedName: 'notion/search', description: 'Search Notion pages', category: 'documents' },
  ];
}

// ── 1. extractRoutedTools: parsed is a non-null JSON primitive (number 42) ───
//
// When payload.response is the string "42", safeParseJson("42") returns the
// number 42.  !parsed = false (42 is truthy), typeof 42 !== 'object' = true
// → extractRoutedTools returns [] → emptyResults++ → route() returns null.

test('OllamaBrain: extractRoutedTools returns [] when parsed JSON is a number (typeof !== "object")', async () => {
  const fake = await startFake(() =>
    // Outer envelope OK; inner response is the bare JSON number "42" as a string.
    JSON.stringify({ response: '42' }),
  );

  try {
    const brain = new OllamaBrain({ url: fake.url, enabled: true, timeoutMs: 3000 });
    const result = await brain.route('find something', ollamaCandidates());

    assert.equal(result, null, 'route must return null when parsed inner response is a primitive');
    const stats = brain.getStats();
    assert.equal(stats.emptyResults, 1, 'emptyResults must increment (parsed ran ok, no matches)');
    assert.equal(stats.errors, 0, 'no error — a valid JSON primitive is not a parse error');
    assert.equal(stats.circuitOpen, false, 'circuit must remain closed — reachable server, just odd shape');
  } finally {
    await fake.stop();
  }
});

// ── 2. extractRoutedTools: parsed.matches is a string, not an array ───────────
//
// When the inner JSON is {"matches":"not-an-array"}, Array.isArray(matches)
// = false → extractRoutedTools returns [] → emptyResults++ → route() returns null.

test('OllamaBrain: extractRoutedTools returns [] when matches field is a string (not Array)', async () => {
  const fake = await startFake(() =>
    JSON.stringify({ response: JSON.stringify({ matches: 'not-an-array' }) }),
  );

  try {
    const brain = new OllamaBrain({ url: fake.url, enabled: true, timeoutMs: 3000 });
    const result = await brain.route('find something', ollamaCandidates());

    assert.equal(result, null, 'route must return null when matches is not an array');
    const stats = brain.getStats();
    assert.equal(stats.emptyResults, 1, 'emptyResults must increment — server reachable, just no usable matches');
    assert.equal(stats.errors, 0, 'no error counter increment — not a network or parse failure');
    assert.equal(stats.circuitOpen, false, 'circuit must remain closed');
  } finally {
    await fake.stop();
  }
});

// ── 3. embedding-brain: vector is an empty array (raw.length === 0 guard) ─────
//
// The embed loop validates each raw item with:
//   if (!Array.isArray(raw) || raw.length === 0) { this.errors++; return null; }
// Prior tests cover the !Array.isArray arm (string item).  Here `raw` IS an
// array but has zero elements — the `raw.length === 0` arm fires.

test('EmbeddingBrain: embed vector is an empty array → raw.length===0 guard fires, errors++, null', async () => {
  const fake = await startFake((body) => {
    const req = JSON.parse(body) as { input: string[] };
    // Return the correct count of embeddings, but each vector is an empty array.
    const embeddings = req.input.map(() => []);
    return JSON.stringify({ embeddings });
  });

  try {
    const brain = new EmbeddingBrain({
      url: fake.url,
      enabled: true,
      timeoutMs: 3000,
      circuitBreakerThreshold: 99,
    });
    const candidates: ToolCandidate[] = [
      { namespacedName: 'neon/run_sql', description: 'Run SQL', category: 'code' },
    ];
    const result = await brain.route('run a query', candidates);

    assert.equal(result, null, 'route must return null when a vector is empty');
    const stats = brain.getStats();
    assert.ok(stats.errors >= 1, 'errors must increment when vector is empty');
  } finally {
    await fake.stop();
  }
});

// ── 4. embedding-brain: vector element is Infinity (the !Number.isFinite arm) ──
//
// The inner loop validates each element with:
//   if (typeof v !== 'number' || !Number.isFinite(v)) { this.errors++; return null; }
// Prior tests cover `typeof v !== 'number'` (string element).  Here v IS a
// number but fails finiteness: the `1e309` JSON literal parses to Infinity in
// JavaScript (exceeds Number.MAX_VALUE ≈ 1.8e308).  typeof Infinity === 'number',
// !Number.isFinite(Infinity) === true → the second half of the guard fires.

test('EmbeddingBrain: vector element is Infinity via 1e309 JSON literal → !isFinite guard fires, errors++, null', async () => {
  // Hand-craft the response to avoid JSON.stringify coercing Infinity to null.
  // JSON.parse('{"embeddings":[[1e309,0.5]]}').embeddings[0][0] === Infinity
  const fakeResponseBody = '{"embeddings":[[1e309,0.5,0.3]]}';

  const fake = await startFake(() => fakeResponseBody);

  try {
    const brain = new EmbeddingBrain({
      url: fake.url,
      enabled: true,
      timeoutMs: 3000,
      circuitBreakerThreshold: 99,
    });
    const candidates: ToolCandidate[] = [
      { namespacedName: 'neon/run_sql', description: 'Run SQL', category: 'code' },
    ];
    const result = await brain.route('run a query', candidates);

    assert.equal(result, null, 'route must return null when a vector element is Infinity');
    const stats = brain.getStats();
    assert.ok(stats.errors >= 1, 'errors must increment on !Number.isFinite element');
  } finally {
    await fake.stop();
  }
});
