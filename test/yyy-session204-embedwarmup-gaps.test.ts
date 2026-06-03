/**
 * YYY batch — 4 tests covering previously untested branches:
 *
 * 1. SessionClient.request(): server returns 204 No Content → the
 *    `if (res.status === 204) return undefined as unknown as T` guard fires
 *    (session-client.ts:79); caller receives undefined (not a JSON parse error).
 *
 * 2. EmbeddingBrain.warmup(): config.enabled === false → returns false
 *    immediately without any outbound HTTP call (embedding-brain.ts:209).
 *
 * 3. EmbeddingBrain.warmup(): enabled but embed server unreachable →
 *    embed() catches ECONNREFUSED → returns null → Boolean(null) === false →
 *    warmup() returns false (embedding-brain.ts:210-212).
 *
 * 4. EmbeddingBrain.warmup(): enabled and embed server returns a valid
 *    embedding → embed() returns Float32Array[] → Boolean(truthy) === true →
 *    warmup() returns true (embedding-brain.ts:211: log.info fires).
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import test from 'node:test';
import { EmbeddingBrain } from '../src/embedding-brain.js';
import { SessionClient } from '../apps/session-coordinator-mcp/src/session-client.ts';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function startFixture(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ url: string; stop: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const stop = () =>
    new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  return { url, stop };
}

// ── 1. SessionClient 204 → returns undefined ─────────────────────────────────

test('SessionClient.request: server returns 204 No Content → returns undefined', async () => {
  const { url, stop } = await startFixture((_req, res) => {
    // Always respond with 204 regardless of path/method
    res.writeHead(204);
    res.end();
  });

  try {
    const client = new SessionClient(url, 'test-token');
    // listSessions does GET /api/sessions → server returns 204
    // The 204 guard fires: `if (res.status === 204) return undefined as unknown as T`
    const result = await client.listSessions();
    assert.equal(result, undefined, '204 response must return undefined, not throw');
  } finally {
    await stop();
  }
});

// ── 2. EmbeddingBrain.warmup: disabled → false without network call ───────────

test('EmbeddingBrain.warmup: enabled=false → returns false immediately, no embed call', async () => {
  // Port 1 is unreachable; if warmup makes a network call the test fails with ECONNREFUSED.
  // The guard `if (!this.config.enabled) return false` must fire first.
  const brain = new EmbeddingBrain({ enabled: false, url: 'http://127.0.0.1:1' });
  const result = await brain.warmup(500);
  assert.equal(result, false, 'warmup must return false when brain is disabled');
  // No embed calls attempted → error/timeout stats stay zero
  const stats = brain.getStats();
  assert.equal(stats.errors, 0, 'no errors recorded for disabled brain');
  assert.equal(stats.timeouts, 0, 'no timeouts recorded for disabled brain');
});

// ── 3. EmbeddingBrain.warmup: enabled + unreachable → false ──────────────────

test('EmbeddingBrain.warmup: enabled but server unreachable → embed returns null → warmup returns false', async () => {
  // Port 1: ECONNREFUSED fires immediately (no listener), so this is fast.
  const brain = new EmbeddingBrain({ enabled: true, url: 'http://127.0.0.1:1' });
  const result = await brain.warmup(2000);
  // embed(['ok']) catches ECONNREFUSED → returns null; Boolean(null) === false
  assert.equal(result, false, 'warmup must return false when embed server is unreachable');
  // embed() increments errors on non-abort failure
  const stats = brain.getStats();
  assert.equal(stats.errors, 1, 'one error recorded from failed embed attempt');
});

// ── 4. EmbeddingBrain.warmup: enabled + valid server response → true ──────────

test('EmbeddingBrain.warmup: enabled + server returns valid embedding → returns true', async () => {
  // Fixture returns a minimal valid /api/embed response: one 3-dim embedding for ['ok']
  const { url, stop } = await startFixture((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // embed(['ok']) sends input=["ok"]; respond with embeddings: one vector
    res.end(JSON.stringify({ embeddings: [[0.577, 0.577, 0.577]] }));
  });

  try {
    const brain = new EmbeddingBrain({ enabled: true, url });
    const result = await brain.warmup(3000);
    // embed(['ok']) returns [Float32Array] → truthy → warmup returns true
    assert.equal(result, true, 'warmup must return true when embed server responds successfully');
  } finally {
    await stop();
  }
});
