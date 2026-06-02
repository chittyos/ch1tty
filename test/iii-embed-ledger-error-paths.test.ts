/**
 * III batch — uncovered branches in embedding-brain.ts + ledger.ts
 *
 * embedding-brain.ts embed() gaps (lines 323-350):
 *   1. response.json() throws (server returns 200 with invalid JSON body)
 *   2. payload.embeddings is not an array (string value → shape guard fires)
 *   3. payload.embeddings.length !== inputs.length (count mismatch guard)
 *   4. vector element is a string, not a nested array (array-type guard)
 *   5. vector element has non-number at index > 0 (inner loop type guard at k=1)
 *
 * ledger.ts writeDeadLetter() gap (lines 29-35):
 *   6. mkdirSync throws ENOTDIR (DLQ path parent is a file) → catch swallows,
 *      shutdown resolves; dropped counter still incremented.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EmbeddingBrain } from '../src/embedding-brain.js';
import { LedgerClient } from '../src/ledger.js';

// ── Fake HTTP server ──────────────────────────────────────────────────────────

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

async function startFake(handler: Handler): Promise<{ url: string; stop: () => Promise<void> }> {
  const server = http.createServer(handler);
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

/** Drain request body, respond with given status + raw body string. */
function respond(req: http.IncomingMessage, res: http.ServerResponse, status: number, body: string): void {
  let raw = '';
  req.on('data', (c: Buffer) => { raw += c.toString('utf8'); });
  req.on('end', () => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body);
  });
}

/** Drain request body, call fn with parsed input, respond with fn's result. */
function respondFn(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  fn: (input: string[]) => string,
): void {
  let raw = '';
  req.on('data', (c: Buffer) => { raw += c.toString('utf8'); });
  req.on('end', () => {
    const body = JSON.parse(raw) as { input: string[] };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(fn(body.input));
  });
}

function brainAt(url: string): EmbeddingBrain {
  return new EmbeddingBrain({
    url,
    enabled: true,
    timeoutMs: 2000,
    minSimilarity: 0,
    circuitBreakerThreshold: 99, // don't let the breaker open during single-test runs
  });
}

function oneTool() {
  return [{ namespacedName: 'neon/list_projects', description: 'List projects', category: 'code' as const }];
}

// ── 1. response.json() throws ─────────────────────────────────────────────────

test('embed: invalid JSON body (HTTP 200) → outer catch fires, errors++, route returns null', async () => {
  const { url, stop } = await startFake((req, res) => {
    respond(req, res, 200, 'this is not valid JSON }{{{');
  });
  try {
    const brain = brainAt(url);
    const result = await brain.route('list projects', oneTool());
    assert.equal(result, null, 'route returns null when response.json() throws');
    assert.ok(brain.getStats().errors >= 1, 'errors counter incremented after JSON parse failure');
  } finally {
    await stop();
  }
});

// ── 2. payload.embeddings is not an array ─────────────────────────────────────

test('embed: payload.embeddings is a string → shape guard fires, errors++, route returns null', async () => {
  const { url, stop } = await startFake((req, res) => {
    respond(req, res, 200, JSON.stringify({ embeddings: 'not-an-array' }));
  });
  try {
    const brain = brainAt(url);
    const result = await brain.route('list projects', oneTool());
    assert.equal(result, null, 'route returns null when embeddings field is not array');
    assert.ok(brain.getStats().errors >= 1, 'errors counter incremented');
  } finally {
    await stop();
  }
});

// ── 3. payload.embeddings.length !== inputs.length ────────────────────────────

test('embed: server returns 3 embeddings for 1-input query → count mismatch, errors++, null', async () => {
  const vec = [1.0, 0.0, 0.0];
  const { url, stop } = await startFake((req, res) => {
    // Always return 3 vectors regardless of input count — query has 1 input so 3 !== 1
    respond(req, res, 200, JSON.stringify({ embeddings: [vec, vec, vec] }));
  });
  try {
    const brain = brainAt(url);
    const result = await brain.route('list projects', oneTool());
    assert.equal(result, null, 'route returns null on embeddings count mismatch');
    assert.ok(brain.getStats().errors >= 1, 'errors counter incremented');
  } finally {
    await stop();
  }
});

// ── 4. vector element is not an array ────────────────────────────────────────

test('embed: vector element is a string, not nested array → array-type guard fires, errors++, null', async () => {
  const { url, stop } = await startFake((req, res) => {
    respondFn(req, res, (input) =>
      // Return correct count, but each "vector" is a string instead of number[]
      JSON.stringify({ embeddings: input.map(() => 'not-an-array-vector') }),
    );
  });
  try {
    const brain = brainAt(url);
    const result = await brain.route('list projects', oneTool());
    assert.equal(result, null, 'route returns null when vector element is not array');
    assert.ok(brain.getStats().errors >= 1, 'errors counter incremented');
  } finally {
    await stop();
  }
});

// ── 5. vector[k>0] contains a non-number value ────────────────────────────────

test('embed: vector index 0 valid, index 1 is a string → inner type guard fires at k=1, errors++, null', async () => {
  const { url, stop } = await startFake((req, res) => {
    respondFn(req, res, (input) => {
      // index 0 = 1.0 (valid), index 1 = "BAD" (string, not number) → triggers guard at k=1
      const badVec = [1.0, 'BAD_NOT_A_NUMBER', 1.0];
      return JSON.stringify({ embeddings: input.map(() => badVec) });
    });
  });
  try {
    const brain = brainAt(url);
    const result = await brain.route('list projects', oneTool());
    assert.equal(result, null, 'route returns null when vector contains non-number at k>0');
    assert.ok(brain.getStats().errors >= 1, 'errors counter incremented after non-finite detection');
  } finally {
    await stop();
  }
});

// ── 6. writeDeadLetter catch block ────────────────────────────────────────────

test('LedgerClient.shutdown: DLQ mkdirSync throws ENOTDIR → catch swallows, dropped counter still set', async () => {
  // Use mkdtempSync to get a guaranteed-unique temp directory (avoids TOCTOU).
  // Inside it, create a regular FILE at the name that mkdirSync would need to be a directory.
  // mkdirSync(dirname(badDlqPath)) tries to traverse that file as a directory → ENOTDIR.
  const tmpDir = mkdtempSync(join(tmpdir(), 'ch1tty-iii-block-'));
  const blockingFile = join(tmpDir, 'blocking');
  writeFileSync(blockingFile, 'i-am-a-file-not-a-dir\n');
  const badDlqPath = join(blockingFile, 'subdir', 'ledger.dlq.jsonl');

  try {
    const ledger = new LedgerClient(badDlqPath);
    ledger.record('s1', 'tool_call', { tool: 'ch1tty/search' });
    assert.equal(ledger.getStats().buffered, 1, 'entry queued before shutdown');

    // Shutdown without binding a backend → writeDeadLetter called → mkdirSync throws ENOTDIR
    // The catch inside writeDeadLetter swallows the error; shutdown still resolves.
    await assert.doesNotReject(
      ledger.shutdown(),
      'shutdown resolves even when DLQ write fails',
    );

    assert.equal(ledger.getStats().buffered, 0, 'buffer cleared after shutdown');
    assert.equal(ledger.getStats().dropped, 1, 'dropped counter incremented despite write failure');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
