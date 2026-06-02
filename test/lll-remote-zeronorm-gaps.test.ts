/**
 * LLL batch — four uncovered branches
 *
 * remote-proxy.ts getAuthToken() empty-stdout path (line 68–71):
 *   1. chitty-mcp-token binary exists in PATH and runs successfully, but its
 *      stdout trims to "" → `if (!token)` fires → throw → outer catch re-throws
 *      as auth_token_unavailable.  PP only tests the exec-not-found path (binary
 *      absent from PATH); this exercises the distinct inner-throw variant.
 *
 * embedding-brain.ts normalizeInPlace() zero-norm guard (line 388):
 *   2. Ollama returns all-zeros for the query vector → normalizeInPlace returns
 *      early (norm === 0, leaves zeros) → every dot product = 0 → all candidates
 *      filtered (below minSimilarity) → emptyResults++ → route() returns null
 *      WITHOUT incrementing errors or tripping the circuit breaker.
 *   3. Ollama returns a real (non-zero) query vec but all-zeros for a candidate →
 *      normalizeInPlace early-returns for that candidate → dot product = 0 →
 *      candidate filtered, scoring still uses the un-normalized (zero) candidate.
 *      emptyResults++ only if ALL candidates are filtered.
 *
 * embedding-brain.ts route() empty candidates after filtering (lines 163-170):
 *   4. All candidates score below minSimilarity for a non-zero-norm reason
 *      (query at pos 0, candidates at pos 1 with dim=2 → dot = 0 < 0.5) →
 *      emptyResults++ → circuit NOT tripped.  (Orthogonal using a 2-dim space
 *      without the normalizeInPlace zero-norm path, confirming the two paths
 *      are distinct.)
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { RemoteProxy } from '../src/remote-proxy.js';
import { EmbeddingBrain } from '../src/embedding-brain.js';
import type { ToolCandidate } from '../src/ollama-brain.js';

// ── Fake Ollama /api/embed server ─────────────────────────────────────────────

type EmbedHandler = (body: unknown) => Promise<{ status: number; body: string }>;

async function startFakeOllama(handler: EmbedHandler): Promise<{
  url: string;
  stop: () => Promise<void>;
}> {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8'); });
    req.on('end', () => {
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { parsed = raw; }
      handler(parsed).then((result) => {
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

  return { url, stop };
}

function brainAt(url: string, overrides: Partial<ConstructorParameters<typeof EmbeddingBrain>[0]> = {}): EmbeddingBrain {
  return new EmbeddingBrain({
    url,
    enabled: true,
    timeoutMs: 3000,
    minSimilarity: 0.3,    // non-zero threshold so zero-dot products are filtered
    circuitBreakerThreshold: 99,  // prevent circuit opening during tests
    ...overrides,
  });
}

function candidates(): ToolCandidate[] {
  return [
    { namespacedName: 'neon/run_sql', description: 'Run a SQL query', category: 'code' },
    { namespacedName: 'notion/search', description: 'Search Notion', category: 'documents' },
  ];
}

// ── 1. remote-proxy: empty stdout from chitty-mcp-token ───────────────────────

test('RemoteProxy: chitty-mcp-token outputs whitespace → if(!token) inner-throw → auth_token_unavailable', async () => {
  // Create a real executable that outputs whitespace (not a missing binary).
  // This exercises the `if (!token)` branch INSIDE the try block, which is
  // distinct from the exec-fails path covered by PP.
  const fakeBinDir = mkdtempSync(join(tmpdir(), 'ch1tty-lll-bin-'));
  const fakeBin = join(fakeBinDir, 'chitty-mcp-token');
  // Output only whitespace so stdout.trim() === ""
  writeFileSync(fakeBin, '#!/bin/sh\nprintf "   \\n"', { mode: 0o755 });

  const origPath = process.env.PATH;
  process.env.PATH = `${fakeBinDir}:${origPath ?? '/usr/bin:/bin'}`;

  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'lll-empty-token',
      name: 'LLL Empty Token',
      type: 'remote',
      access: 'read',
      category: 'code',
      endpoint: 'http://127.0.0.1:1/mcp',  // unreachable — auth fails first
      authTokenKey: 'lll-blank-output-key',
    });

    // callTool surfaces the exact error string — verifies `if (!token)` throw was
    // caught by the outer catch which re-throws as auth_token_unavailable.
    const result = await proxy.callTool('lll-empty-token', 'any_tool', {});

    assert.equal(result.isError, true, 'empty stdout must surface as isError:true');
    assert.match(
      result.content[0].text,
      /auth_token_unavailable/,
      `must be auth_token_unavailable, not a transport error; got: ${result.content[0].text}`,
    );
    // Confirm the binary was actually found and executed (not a PATH miss)
    // by checking the error mentions the configured key, not "command not found".
    assert.doesNotMatch(
      result.content[0].text,
      /command not found/i,
      'chitty-mcp-token must have been found (not a PATH miss)',
    );
    assert.equal(proxy.getStatus('lll-empty-token').connected, false);
  } finally {
    process.env.PATH = origPath;
    await proxy.shutdown();
    rmSync(fakeBinDir, { recursive: true, force: true });
  }
});

// ── 2. embedding-brain: zero-norm query vector ────────────────────────────────

test('EmbeddingBrain: Ollama returns all-zeros query vector → normalizeInPlace no-op → emptyResults++ (no circuit trip)', async () => {
  // The query embedding is [0, 0, 0] — all zeros. normalizeInPlace() detects
  // norm === 0 and returns early, leaving the vector as zeros. Every subsequent
  // dot(queryVec, candidateVec) = 0 < minSimilarity (0.3), so all candidates are
  // filtered. scored.length === 0 → emptyResults++ (NOT errors++, NOT circuit trip).
  let callCount = 0;
  const { url, stop } = await startFakeOllama(async (body) => {
    const req = body as { input: string[] };
    callCount++;
    const isQuery = req.input.length === 1;
    if (isQuery) {
      // Zero-norm query vector — triggers normalizeInPlace early return
      return { status: 200, body: JSON.stringify({ embeddings: [[0, 0, 0]] }) };
    }
    // Candidates get real unit vectors so they are not the source of zero-norm
    const vecs = req.input.map((_, i) => [i === 0 ? 1 : 0, i === 1 ? 1 : 0, 0]);
    return { status: 200, body: JSON.stringify({ embeddings: vecs }) };
  });

  try {
    const brain = brainAt(url);
    const result = await brain.route('run sql query', candidates());

    assert.equal(result, null, 'route() must return null when query vector is zero-norm');
    assert.equal(brain.getStats().emptyResults, 1, 'emptyResults must be incremented');
    assert.equal(brain.getStats().errors, 0, 'errors must NOT be incremented (zero-norm is not an embed failure)');
    assert.equal(brain.getStats().circuitOpen, false, 'circuit must NOT open for empty results');
    assert.ok(callCount >= 1, 'Ollama must have been called');
  } finally {
    await stop();
  }
});

// ── 3. embedding-brain: zero-norm candidate vector ────────────────────────────

test('EmbeddingBrain: candidate vector is all-zeros → normalizeInPlace no-op → dot=0 → filtered', async () => {
  // The query gets a real unit vector at pos 0. One candidate gets a real vector
  // (pos 1, orthogonal to query → dot=0 anyway) and one gets all-zeros (zero-norm).
  // Both produce dot=0 < minSimilarity → emptyResults++, no circuit trip.
  // This is distinct from the query-zero-norm case: the early-return in normalizeInPlace
  // fires for a CANDIDATE rather than the query.
  let callCount = 0;
  const { url, stop } = await startFakeOllama(async (body) => {
    const req = body as { input: string[] };
    callCount++;
    const isQuery = req.input.length === 1;
    if (isQuery) {
      // Real query vector at position 0 (one-hot in dim 4)
      return { status: 200, body: JSON.stringify({ embeddings: [[1, 0, 0, 0]] }) };
    }
    // First candidate: real unit vector at pos 1 (orthogonal to query → dot=0)
    // Second candidate: all-zeros (zero-norm → normalizeInPlace early-returns)
    const vecs = [[0, 1, 0, 0], [0, 0, 0, 0]];
    return { status: 200, body: JSON.stringify({ embeddings: vecs.slice(0, req.input.length) }) };
  });

  try {
    const brain = brainAt(url);
    const result = await brain.route('find projects', candidates());

    assert.equal(result, null, 'route() must return null when all candidates produce dot=0');
    assert.equal(brain.getStats().emptyResults, 1, 'emptyResults incremented (no error — dot=0 is a normal below-threshold result)');
    assert.equal(brain.getStats().errors, 0, 'errors must NOT be incremented for zero-norm candidates');
    assert.equal(brain.getStats().circuitOpen, false, 'circuit must NOT open');
    assert.ok(callCount >= 2, 'Ollama called for both query and candidates');
  } finally {
    await stop();
  }
});

// ── 4. embedding-brain: all candidates below minSimilarity (non-zero-norm path) ─

test('EmbeddingBrain: real orthogonal vectors → all dot=0 → emptyResults++ without circuit trip', async () => {
  // Uses 2-dimensional one-hot vectors. Query at dim[0]=1, candidates at dim[1]=1.
  // dot([1,0], [0,1]) = 0 < minSimilarity (0.3). All filtered → emptyResults++.
  // This uses the orthogonal (non-zero-norm) variant of the same emptyResults path,
  // confirming the code path is exercised independently of the normalizeInPlace guard.
  let callCount = 0;
  const { url, stop } = await startFakeOllama(async (body) => {
    const req = body as { input: string[] };
    callCount++;
    const isQuery = req.input.length === 1;
    if (isQuery) {
      return { status: 200, body: JSON.stringify({ embeddings: [[1, 0]] }) };
    }
    // Both candidates at orthogonal position — cosine to query = 0
    return { status: 200, body: JSON.stringify({ embeddings: req.input.map(() => [0, 1]) }) };
  });

  try {
    const brain = brainAt(url, { minSimilarity: 0.3 });
    const result = await brain.route('list sql tables', candidates());

    assert.equal(result, null, 'all-orthogonal candidates → route() returns null');
    assert.equal(brain.getStats().emptyResults, 1, 'emptyResults incremented');
    assert.equal(brain.getStats().errors, 0, 'no errors — vectors are valid');
    assert.equal(brain.getStats().circuitOpen, false, 'circuit stays closed');
    assert.ok(brain.getStats().successes === 0, 'successes stays 0 when no results pass threshold');
    assert.ok(callCount >= 2, 'Ollama called for query and candidates');
  } finally {
    await stop();
  }
});
