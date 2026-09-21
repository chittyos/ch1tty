/**
 * GP drift guard: freeze ch1tty/search TOP-LEVEL field VALUE TYPES.
 *
 * EB froze the key sets for both search response paths (filtered and discovery).
 * GH froze the value types for tools[] entry fields.
 *
 * Neither test froze the value types of the top-level response fields:
 *   - filtered path: latencyMs, matches, total, mode (conditional), score (per-tool, conditional)
 *   - discovery path: latencyMs, hint, totalTools
 *
 * A latencyMs returning null, a matches returning "0" (string), or a total
 * returning -1 would all silently pass EB's key-set guard.
 *
 * GP closes those gaps:
 *
 *   GP-1  filtered path: latencyMs is a finite non-negative number
 *   GP-2  filtered path: matches is a non-negative integer, <= total
 *   GP-3  filtered path: total is a non-negative integer
 *   GP-4  filtered path: mode when present is exactly the string 'partial'
 *          (never null, never 'full', never a boolean)
 *   GP-5  filtered path: tools[] entry score is a finite non-negative number
 *          when a query is provided (score is computed for keyword searches)
 *   GP-6  discovery path: latencyMs is a finite non-negative number
 *   GP-7  discovery path: hint is a non-empty string
 *   GP-8  discovery path: totalTools is a non-negative integer
 *
 * Frozen 2026-09-21.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only)
 *   - buildCastExplanation metric freeze: not applicable (search, not cast)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gp-${Date.now()}-${++dlqSeq}.jsonl`);
}

const BASE_CONFIGS: ServerConfig[] = [
  { id: 'neon', name: 'Neon DB', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true },
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
];

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
}

async function search(agg: Aggregator, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/search', args);
  assert.equal(result.isError, undefined, 'search must not error');
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

// ── GP-1: filtered path latencyMs is a finite non-negative number ─────────────

test('GP-1: filtered path latencyMs is a finite non-negative number', async () => {
  const agg = makeAgg();
  try {
    const body = await search(agg, { query: 'database' });
    const latencyMs = body['latencyMs'];
    assert.equal(typeof latencyMs, 'number',
      `latencyMs must be a number, got ${typeof latencyMs}`);
    assert.ok(Number.isFinite(latencyMs as number),
      `latencyMs must be finite, got ${latencyMs}`);
    assert.ok((latencyMs as number) >= 0,
      `latencyMs must be non-negative, got ${latencyMs}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GP-2: filtered path matches is a non-negative integer, <= total ───────────

test('GP-2: filtered path matches is a non-negative integer and does not exceed total', async () => {
  const agg = makeAgg();
  try {
    const body = await search(agg, { query: 'database' });
    const matches = body['matches'];
    const total = body['total'];
    assert.equal(typeof matches, 'number',
      `matches must be a number, got ${typeof matches}`);
    assert.ok(Number.isInteger(matches as number),
      `matches must be an integer, got ${matches}`);
    assert.ok((matches as number) >= 0,
      `matches must be non-negative, got ${matches}`);
    assert.ok((matches as number) <= (total as number),
      `matches (${matches}) must not exceed total (${total})`);
  } finally {
    await agg.shutdown();
  }
});

// ── GP-3: filtered path total is a non-negative integer ──────────────────────

test('GP-3: filtered path total is a non-negative integer', async () => {
  const agg = makeAgg();
  try {
    const body = await search(agg, { query: 'list' });
    const total = body['total'];
    assert.equal(typeof total, 'number',
      `total must be a number, got ${typeof total}`);
    assert.ok(Number.isInteger(total as number),
      `total must be an integer, got ${total}`);
    assert.ok((total as number) >= 0,
      `total must be non-negative, got ${total}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GP-4: mode when present is exactly the string 'partial' ──────────────────

test('GP-4: filtered path mode when present is exactly the string "partial"', async () => {
  const agg = makeAgg();
  try {
    // Use a very short query that forces partial/OR fallback
    const body = await search(agg, { query: 'z' });
    if ('mode' in body) {
      const mode = body['mode'];
      assert.equal(typeof mode, 'string',
        `mode must be a string when present, got ${typeof mode}`);
      assert.equal(mode, 'partial',
        `mode must be exactly 'partial' when present, got "${mode}"`);
    }
    // Also verify with a normal query that if mode appears it is still 'partial'
    const body2 = await search(agg, { query: 'database' });
    if ('mode' in body2) {
      assert.equal(body2['mode'], 'partial',
        `mode on normal query must be 'partial' when present, got "${body2['mode']}"`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GP-5: tools[] entry score is a finite non-negative number when query given ──

test('GP-5: tools[] entry score is a finite non-negative number when a query is provided', async () => {
  const agg = makeAgg();
  try {
    const body = await search(agg, { query: 'database' });
    const tools = body['tools'] as Record<string, unknown>[];
    assert.ok(Array.isArray(tools) && tools.length > 0,
      'need at least one tool result to check score');
    for (const entry of tools) {
      if ('score' in entry) {
        const score = entry['score'];
        assert.equal(typeof score, 'number',
          `score must be a number for tool "${entry['tool']}", got ${typeof score}`);
        assert.ok(Number.isFinite(score as number),
          `score must be finite for tool "${entry['tool']}", got ${score}`);
        assert.ok((score as number) >= 0,
          `score must be non-negative for tool "${entry['tool']}", got ${score}`);
      }
    }
    // At least one tool should have a score when a query is given
    const withScore = tools.filter((t) => 'score' in t);
    assert.ok(withScore.length > 0,
      'at least one tools[] entry must have a score field when query is provided');
  } finally {
    await agg.shutdown();
  }
});

// ── GP-6: discovery path latencyMs is a finite non-negative number ────────────

test('GP-6: discovery path latencyMs is a finite non-negative number', async () => {
  const agg = makeAgg();
  try {
    const body = await search(agg, {});
    const latencyMs = body['latencyMs'];
    assert.equal(typeof latencyMs, 'number',
      `discovery latencyMs must be a number, got ${typeof latencyMs}`);
    assert.ok(Number.isFinite(latencyMs as number),
      `discovery latencyMs must be finite, got ${latencyMs}`);
    assert.ok((latencyMs as number) >= 0,
      `discovery latencyMs must be non-negative, got ${latencyMs}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GP-7: discovery path hint is a non-empty string ───────────────────────────

test('GP-7: discovery path hint is a non-empty string', async () => {
  const agg = makeAgg();
  try {
    const body = await search(agg, {});
    const hint = body['hint'];
    assert.equal(typeof hint, 'string',
      `discovery hint must be a string, got ${typeof hint}`);
    assert.ok((hint as string).length > 0,
      'discovery hint must be non-empty');
  } finally {
    await agg.shutdown();
  }
});

// ── GP-8: discovery path totalTools is a non-negative integer ─────────────────

test('GP-8: discovery path totalTools is a non-negative integer', async () => {
  const agg = makeAgg();
  try {
    const body = await search(agg, {});
    const totalTools = body['totalTools'];
    assert.equal(typeof totalTools, 'number',
      `discovery totalTools must be a number, got ${typeof totalTools}`);
    assert.ok(Number.isInteger(totalTools as number),
      `discovery totalTools must be an integer, got ${totalTools}`);
    assert.ok((totalTools as number) >= 0,
      `discovery totalTools must be non-negative, got ${totalTools}`);
  } finally {
    await agg.shutdown();
  }
});
