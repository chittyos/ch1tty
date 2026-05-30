/**
 * Tests the OllamaBrain fallback path in SessionCoordinator.routeIntent():
 *   EmbeddingBrain returns null → OllamaBrain is tried → result (or null) returned.
 *
 * This path is gated by the module-level const:
 *   const USE_OLLAMA_BRAIN = process.env.CH1TTY_USE_OLLAMA_BRAIN === '1';
 *
 * Strategy: set CH1TTY_USE_OLLAMA_BRAIN='1' in this worker's env BEFORE
 * coordinator.ts is loaded, then use a dynamic import so the const is
 * captured as `true`. Each `node --test` worker thread has its own module
 * cache, so this env mutation is invisible to other test files.
 *
 * Assertion strategy for warmup observability-neutrality:
 *   OllamaBrain.warmup() hits the generate endpoint but does NOT increment
 *   getStats().calls (documented as "observability-neutral"). We assert on
 *   .calls diffs rather than server hit counts to avoid warmup races.
 *
 * Fake servers:
 *   /api/generate → OllamaBrain route() endpoint (controlled by brainConfig.url)
 *   /api/embed    → EmbeddingBrain route() endpoint (controlled by embedConfig.url)
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

// ── Set flag before coordinator module is loaded ──────────────
process.env.CH1TTY_USE_OLLAMA_BRAIN = '1';
process.env.CH1TTY_LEDGER_DLQ = path.join(
  os.tmpdir(),
  `ch1tty-test-ollama-fallback-${process.pid}.dlq`,
);

// Dynamic import ensures coordinator.ts captures USE_OLLAMA_BRAIN = true.
const { SessionCoordinator } = await import('../src/coordinator.js');
type ToolCandidate = import('../src/ollama-brain.js').ToolCandidate;

// ── Fake /api/generate server (OllamaBrain endpoint) ─────────

type GenerateHandler = (body: unknown) => { status: number; body: string } | 'hang';

async function startFakeGenerate(handler: GenerateHandler): Promise<{
  url: string;
  stop: () => Promise<void>;
}> {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8'); });
    req.on('end', () => {
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { parsed = raw; }
      const result = handler(parsed);
      if (result === 'hang') return; // deliberately never respond
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(result.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;
  const stop = () => new Promise<void>((resolve, reject) => {
    server.closeAllConnections?.();
    server.close((err) => (err ? reject(err) : resolve()));
  });
  return { url, stop };
}

function okGenerateResponse(toolName: string, confidence = 0.9): string {
  return JSON.stringify({
    response: JSON.stringify({
      matches: [{ tool: toolName, confidence, reason: 'ollama-routed' }],
    }),
  });
}

// ── Fake /api/embed server (EmbeddingBrain endpoint) ─────────

async function startFakeEmbed(
  handler: (inputLen: number) => { status: number; body: string },
): Promise<{ url: string; stop: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8'); });
    req.on('end', () => {
      let parsed: { input?: string[] } = {};
      try { parsed = JSON.parse(raw) as { input?: string[] }; } catch { /* ignore */ }
      const result = handler(parsed.input?.length ?? 1);
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(result.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;
  const stop = () => new Promise<void>((resolve, reject) => {
    server.closeAllConnections?.();
    server.close((err) => (err ? reject(err) : resolve()));
  });
  return { url, stop };
}

function oneHot(pos: number, dim = 16): number[] {
  const v = new Array<number>(dim).fill(0);
  v[pos % dim] = 1;
  return v;
}

function embedBody(vecs: number[][]): string {
  return JSON.stringify({ embeddings: vecs });
}

const CANDIDATES: ToolCandidate[] = [
  { namespacedName: 'evidence/collect', description: 'Collect legal documents', category: 'documents' },
  { namespacedName: 'neon/query', description: 'Run SQL on Neon Postgres', category: 'code' },
  { namespacedName: 'notion/search', description: 'Search Notion workspace', category: 'documents' },
];

// ── Tests ─────────────────────────────────────────────────────

test('OllamaBrain fallback: succeeds when EmbeddingBrain disabled', async () => {
  const gen = await startFakeGenerate(() => ({
    status: 200,
    body: okGenerateResponse('evidence/collect', 0.91),
  }));
  try {
    const coord = new SessionCoordinator(
      { url: gen.url, enabled: true, minConfidence: 0.5, timeoutMs: 2000 },
      { enabled: false }, // EmbeddingBrain off → null → OllamaBrain tried
    );

    const callsBefore = coord.brain.getStats().calls; // warmup doesn't count in calls
    const result = await coord.routeIntent('collect court documents', CANDIDATES);

    assert.ok(result !== null, 'OllamaBrain fallback should produce a result');
    assert.equal(result.length, 1);
    assert.equal(result[0]!.tool.namespacedName, 'evidence/collect');
    assert.ok(result[0]!.confidence >= 0.5);
    // Verify route() was invoked exactly once (warmup is observability-neutral — doesn't count)
    assert.equal(coord.brain.getStats().calls - callsBefore, 1, 'OllamaBrain.route() called once');
    assert.equal(coord.brain.getStats().successes, 1);
  } finally {
    await gen.stop();
  }
});

test('OllamaBrain fallback: succeeds when EmbeddingBrain unreachable', async () => {
  const gen = await startFakeGenerate(() => ({
    status: 200,
    body: okGenerateResponse('neon/query', 0.88),
  }));
  try {
    const coord = new SessionCoordinator(
      { url: gen.url, enabled: true, minConfidence: 0.5, timeoutMs: 2000 },
      { url: 'http://127.0.0.1:1', enabled: true, timeoutMs: 300 }, // unreachable → null
    );

    const callsBefore = coord.brain.getStats().calls;
    const result = await coord.routeIntent('run a database query', CANDIDATES);

    assert.ok(result !== null, 'OllamaBrain fallback should return result when embed unreachable');
    assert.equal(result[0]!.tool.namespacedName, 'neon/query');
    assert.equal(coord.brain.getStats().calls - callsBefore, 1, 'OllamaBrain.route() called once');
  } finally {
    await gen.stop();
  }
});

test('OllamaBrain NOT invoked when EmbeddingBrain returns results', async () => {
  // Embedding server: all inputs → oneHot(0), so evidence/collect wins.
  const embed = await startFakeEmbed((len) => ({
    status: 200,
    body: embedBody(new Array<number[]>(len).fill(oneHot(0))),
  }));
  // OllamaBrain points at a real server (normal response) — but route() must not be called.
  // We verify via getStats().calls, not by crashing the handler.
  const gen = await startFakeGenerate(() => ({
    status: 200,
    body: okGenerateResponse('evidence/collect'),
  }));

  try {
    const coord = new SessionCoordinator(
      { url: gen.url, enabled: true, timeoutMs: 2000 },
      { url: embed.url, enabled: true, timeoutMs: 2000, minSimilarity: 0 },
    );

    const callsBefore = coord.brain.getStats().calls; // 0 (warmup doesn't count)
    const result = await coord.routeIntent('collect documents', CANDIDATES);

    assert.ok(result !== null, 'EmbeddingBrain path should return results');
    assert.ok(result.length > 0);
    // OllamaBrain.route() must NOT have been called
    assert.equal(coord.brain.getStats().calls, callsBefore,
      'OllamaBrain.route() must not be invoked when EmbeddingBrain succeeds');
  } finally {
    await embed.stop();
    await gen.stop();
  }
});

test('routeIntent returns null when both EmbeddingBrain and OllamaBrain are disabled', async () => {
  const coord = new SessionCoordinator(
    { enabled: false },
    { enabled: false },
  );
  const result = await coord.routeIntent('find anything', CANDIDATES);
  assert.equal(result, null, 'both disabled → null');
  assert.equal(coord.brain.getStats().calls, 0, 'route() never called when disabled');
});

test('OllamaBrain fallback: empty Ollama matches → routeIntent returns null', async () => {
  const gen = await startFakeGenerate(() => ({
    status: 200,
    body: JSON.stringify({ response: JSON.stringify({ matches: [] }) }),
  }));
  try {
    const coord = new SessionCoordinator(
      { url: gen.url, enabled: true, minConfidence: 0.5, timeoutMs: 2000 },
      { enabled: false },
    );

    const callsBefore = coord.brain.getStats().calls;
    const result = await coord.routeIntent('unrelated query with no matches', CANDIDATES);

    assert.equal(result, null, 'empty Ollama matches → null from routeIntent');
    assert.equal(coord.brain.getStats().calls - callsBefore, 1, 'Ollama route() called once');
    assert.equal(coord.brain.getStats().emptyResults, 1);
  } finally {
    await gen.stop();
  }
});

test('OllamaBrain fallback: open circuit returns null immediately without network call', async () => {
  // Non-async hang handler — 'hang' must be returned synchronously so the
  // server-side check (result === 'hang') works without Promise indirection.
  const gen = await startFakeGenerate(() => 'hang');
  try {
    const coord = new SessionCoordinator(
      {
        url: gen.url,
        enabled: true,
        timeoutMs: 100,
        circuitBreakerThreshold: 2,
        circuitBreakerCooldownMs: 60_000,
      },
      { enabled: false }, // no embed so Ollama fallback is always tried
    );

    // Trip the Ollama circuit: 2 timeouts (warmup is observability-neutral, doesn't count)
    const callsBefore = coord.brain.getStats().calls;
    await coord.routeIntent('first', CANDIDATES);
    await coord.routeIntent('second', CANDIDATES);

    assert.equal(coord.brain.getStats().calls - callsBefore, 2, 'two route() calls to trip circuit');
    assert.ok(coord.brain.isCircuitOpen(), 'OllamaBrain circuit must be open after threshold failures');

    const callsAtOpen = coord.brain.getStats().calls;

    // Open circuit → null immediately, no new route() call
    const t0 = Date.now();
    const result = await coord.routeIntent('third', CANDIDATES);
    const elapsed = Date.now() - t0;

    assert.equal(result, null, 'open OllamaBrain circuit should return null');
    assert.ok(elapsed < 100, `open circuit should return quickly, got ${elapsed}ms`);
    assert.equal(coord.brain.getStats().calls, callsAtOpen,
      'no additional route() calls when circuit open');
  } finally {
    await gen.stop();
  }
});
