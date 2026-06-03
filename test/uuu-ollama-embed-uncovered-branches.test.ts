/**
 * UUU batch — 4 genuinely untested branches across OllamaBrain + EmbeddingBrain.
 *
 * 1. ollama-brain.ts extractRoutedTools (line 379):
 *    `reason` field absent or empty-string → falls through to 'semantic match' default.
 *    All prior tests always supply a non-empty string reason; this verifies the
 *    `typeof m.reason === 'string' && m.reason.length > 0 ? m.reason : 'semantic match'`
 *    false branch.
 *
 * 2. ollama-brain.ts buildPrompt (line 321):
 *    `c.category` is undefined → `const meta = c.category ? \` [${c.category}]\` : ''`
 *    produces empty meta string. All prior tests use candidates with a category set.
 *    Verified by inspecting the raw prompt string received by the fake server —
 *    no `[category]` bracket appears for the undescribed candidate.
 *
 * 3. embedding-brain.ts normalizeInPlace (line 388):
 *    All-zero embedding vector → `if (norm === 0) return` early-return guard fires.
 *    Without the guard, dividing by 0 would produce NaN in the vector, which would
 *    then propagate to dot() and produce NaN similarity (neither < nor >= threshold).
 *    With the guard the vector stays zero, dot() returns 0 (< minSimilarity), route()
 *    returns null with emptyResults++ (not errors++), confirming clean graceful handling.
 *
 * 4. ollama-brain.ts warmup (line 275):
 *    HTTP 200 OK but response body is not valid JSON → `response.json().catch(() => null)`
 *    fires. Prior tests serve valid JSON or HTTP non-OK bodies. Here the server returns
 *    HTTP 200 with "not-valid-json", response.json() throws, the catch swallows it, and
 *    warmup() still returns true (success based on response.ok, not body parse).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { OllamaBrain, type ToolCandidate } from '../src/ollama-brain.js';
import { EmbeddingBrain } from '../src/embedding-brain.js';

// ── Fake server helpers ───────────────────────────────────────────────────────

type GenerateHandler = (body: string) => Promise<{ status: number; body: string }>;
type EmbedHandler = (body: string) => Promise<{ status: number; body: string }>;

interface FakeServer {
  url: string;
  stop: () => Promise<void>;
  /** Raw request bodies received, in order. */
  requests: string[];
}

async function startFake(handler: GenerateHandler | EmbedHandler): Promise<FakeServer> {
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8'); });
    req.on('end', () => {
      requests.push(raw);
      (handler as (body: string) => Promise<{ status: number; body: string }>)(raw).then((result) => {
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

// ── Fixture candidates ────────────────────────────────────────────────────────

const CANDIDATES_WITH_CATEGORY: ToolCandidate[] = [
  { namespacedName: 'neon/run_sql', description: 'Run a SQL query', category: 'code' },
  { namespacedName: 'notion/search', description: 'Search Notion pages', category: 'documents' },
];

const CANDIDATES_NO_CATEGORY: ToolCandidate[] = [
  { namespacedName: 'neon/run_sql', description: 'Run a SQL query' },
  { namespacedName: 'notion/search', description: 'Search Notion pages' },
];

// ── 1. extractRoutedTools: absent/empty reason → 'semantic match' default ────

test('extractRoutedTools: absent reason falls back to "semantic match"', async () => {
  const fake = await startFake(async () => ({
    status: 200,
    body: JSON.stringify({
      response: JSON.stringify({
        matches: [
          // No `reason` field at all → typeof m.reason !== 'string' → 'semantic match'
          { tool: 'neon/run_sql', confidence: 0.9 },
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
    const result = await brain.route('run a database query', CANDIDATES_WITH_CATEGORY);

    assert.ok(result !== null, 'result must not be null when a valid tool is returned');
    assert.equal(result.length, 1, 'exactly one match must be returned');
    assert.equal(result[0]!.reason, 'semantic match', 'absent reason must default to "semantic match"');
    assert.equal(result[0]!.tool.namespacedName, 'neon/run_sql');
  } finally {
    await fake.stop();
  }
});

test('extractRoutedTools: empty-string reason falls back to "semantic match"', async () => {
  const fake = await startFake(async () => ({
    status: 200,
    body: JSON.stringify({
      response: JSON.stringify({
        matches: [
          // reason is present but empty string → m.reason.length === 0 → 'semantic match'
          { tool: 'notion/search', confidence: 0.85, reason: '' },
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
    const result = await brain.route('search documents', CANDIDATES_WITH_CATEGORY);

    assert.ok(result !== null, 'result must not be null');
    assert.equal(result.length, 1, 'one match returned');
    assert.equal(result[0]!.reason, 'semantic match', 'empty-string reason must default to "semantic match"');
  } finally {
    await fake.stop();
  }
});

// ── 2. buildPrompt: undefined category → no [category] bracket in prompt ─────

test('buildPrompt: candidate with no category omits [category] bracket in sent prompt', async () => {
  const fake = await startFake(async () => ({
    status: 200,
    body: JSON.stringify({
      response: JSON.stringify({ matches: [] }),
    }),
  }));

  try {
    const brain = new OllamaBrain({
      url: fake.url,
      enabled: true,
      timeoutMs: 3000,
      minConfidence: 0.5,
    });
    // route() with no-category candidates — empty matches is fine, we just need the prompt
    await brain.route('run a query', CANDIDATES_NO_CATEGORY);

    assert.equal(fake.requests.length, 1, 'exactly one request made');
    const body = JSON.parse(fake.requests[0]!) as { prompt?: string };
    assert.ok(typeof body.prompt === 'string', 'request must include a prompt field');

    // With no category, buildPrompt must produce "- neon/run_sql: Run a SQL query"
    // (no "[code]" bracket). Verify by checking the absence of "[code]" or "[documents]".
    assert.ok(!body.prompt.includes('[code]'), 'prompt must not contain [code] for category-less candidate');
    assert.ok(!body.prompt.includes('[documents]'), 'prompt must not contain [documents] for category-less candidate');

    // The candidate names themselves must still be present
    assert.ok(body.prompt.includes('neon/run_sql'), 'prompt must contain the tool name');
    assert.ok(body.prompt.includes('notion/search'), 'prompt must contain the second tool name');
  } finally {
    await fake.stop();
  }
});

// ── 3. normalizeInPlace: all-zero vector → if (norm === 0) return guard ───────

test('normalizeInPlace: all-zero embedding vector → route() returns null gracefully (emptyResults++, not errors++)', async () => {
  const fake = await startFake(async (raw) => {
    const body = JSON.parse(raw) as { input: string[] };
    // Return all-zero vectors for every input (pathological case)
    const embeddings = body.input.map(() => [0, 0, 0, 0]);
    return {
      status: 200,
      body: JSON.stringify({ embeddings }),
    };
  });

  try {
    const brain = new EmbeddingBrain({
      url: fake.url,
      enabled: true,
      timeoutMs: 3000,
      minSimilarity: 0.1,
    });
    const candidates = CANDIDATES_WITH_CATEGORY.map((c) => ({
      namespacedName: c.namespacedName,
      description: c.description ?? '',
      category: c.category,
    }));
    const result = await brain.route('find something', candidates);

    // All-zero vectors survive normalizeInPlace (norm=0 → early return, no NaN).
    // dot(zeroVec, zeroVec) = 0 < minSimilarity → no matches → emptyResults++.
    assert.equal(result, null, 'all-zero vectors produce zero cosine similarity → no matches → null');
    const stats = brain.getStats();
    assert.equal(stats.emptyResults, 1, 'empty results incremented (connectivity ok, zero similarity)');
    assert.equal(stats.errors, 0, 'no errors — zero vector is gracefully handled, not an error');
  } finally {
    await fake.stop();
  }
});

// ── 4. warmup: HTTP 200 + non-JSON body → response.json().catch() fires ───────

test('warmup: HTTP 200 with non-JSON body → response.json().catch swallows error, warmup returns true', async () => {
  const fake = await startFake(async () => ({
    status: 200,
    // Valid HTTP 200 but body is not parseable JSON. response.json() will throw;
    // the .catch(() => null) at ollama-brain.ts:275 must swallow it so warmup() still returns true.
    body: 'warmup ok (plain text — not JSON)',
  }));

  try {
    const brain = new OllamaBrain({
      url: fake.url,
      enabled: true,
      model: 'llama3.2:3b',
    });
    const result = await brain.warmup(3000);

    assert.equal(result, true, 'warmup must return true: success is determined by response.ok, not body parse');
    assert.equal(fake.requests.length, 1, 'exactly one warmup request made');
    // Verify route stats stay zero (warmup is observability-neutral)
    assert.equal(brain.getStats().calls, 0, 'warmup must not increment route calls');
    assert.equal(brain.getStats().errors, 0, 'body parse failure must not increment route errors');
  } finally {
    await fake.stop();
  }
});
