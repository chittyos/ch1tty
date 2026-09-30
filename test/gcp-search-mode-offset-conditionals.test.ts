/**
 * GCP drift guard: freeze ch1tty/search top-level `mode` and `offset` conditionals.
 *
 * Two untested conditional fields remain in the search response body after GCK–GCO:
 *
 *   `mode`   — emitted as exactly the string `'partial'` when the OR/partial-fallback
 *              path fires (multi-term query, AND produces 0 matches, OR produces > 0).
 *              Absent on AND matches, absent with a single-term query even if no match.
 *
 *   `offset` — emitted with the caller-supplied numeric value when `offset > 0`.
 *              Absent when offset is 0 or not provided (default path).
 *
 * Source: src-stdio/aggregator.ts ~861–862
 *   ...(offset > 0 ? { offset } : {}),
 *   ...(partialFallback ? { mode: 'partial' } : {}),
 *
 * Partial-fallback trigger (src-stdio/aggregator.ts ~701):
 *   andMatches.length === 0 && queryTerms.length > 1
 *   → falls back to OR, sets partialFallback = true
 *
 * GCP freezes:
 *
 *   GCP-1  AND query matching ≥ 1 tool → `mode` key ABSENT from top-level response
 *   GCP-2  multi-term query with 0 AND matches → `mode === 'partial'` (partial fallback fires)
 *   GCP-3  `mode` value is exactly the string `'partial'`, not `'or'`, `true`, or `1`
 *   GCP-4  search with no explicit offset → `offset` key ABSENT from top-level response
 *   GCP-5  search with offset:N (N > 0) → `offset` key present and equals N exactly
 *
 * Frozen 2026-09-27.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (search response, not cast explain)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gcp-${Date.now()}-${++_seq}.jsonl`);
}

// Two-server aggregator: neon + stripe. A query of "neon stripe" will match 0
// tools with AND (no tool description contains BOTH words) but will match with OR
// (neon tools match "neon", stripe tools match "stripe") → triggers partialFallback.
// A single-server "neon only" aggregator is used to verify mode absence on AND match.

const NEON_CONFIG: ServerConfig = {
  id: 'neon',
  name: 'Neon',
  type: 'remote',
  access: 'readwrite',
  category: 'code',
  endpoint: 'https://neon.tech/mcp',
  lazy: true,
};

const STRIPE_CONFIG: ServerConfig = {
  id: 'stripe',
  name: 'Stripe',
  type: 'remote',
  access: 'readwrite',
  category: 'ecosystem',
  endpoint: 'https://stripe.com/mcp',
  lazy: true,
};

function makeTwoServerAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator([NEON_CONFIG, STRIPE_CONFIG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
}

function makeNeonOnlyAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  return new Aggregator([NEON_CONFIG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
}

async function search(
  agg: Aggregator,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await agg.callTool('ch1tty/search', args);
  const text = (res.content as Array<{ type: string; text: string }>)[0]?.text ?? '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GCP-1: AND query matching ≥ 1 tool → mode key absent from top-level response', async () => {
  const agg = makeNeonOnlyAgg();
  // 'neon project' — both terms appear in neon tool names/descriptions → AND match fires
  const resp = await search(agg, { query: 'neon project' });
  assert.ok(resp.matches as number > 0, 'expected at least one AND match');
  assert.ok(!Object.prototype.hasOwnProperty.call(resp, 'mode'),
    `mode should be absent on AND match, got mode=${JSON.stringify(resp.mode)}`);
});

test('GCP-2: multi-term query with 0 AND matches → mode key present with value "partial"', async () => {
  const agg = makeTwoServerAgg();
  // 'neon stripe' — no tool description contains BOTH words → AND = 0, OR fallback fires
  const resp = await search(agg, { query: 'neon stripe' });
  assert.ok(resp.matches as number > 0, 'expected OR fallback to surface tools');
  assert.ok(Object.prototype.hasOwnProperty.call(resp, 'mode'),
    'mode should be present when partial fallback fires');
  assert.strictEqual(resp.mode, 'partial',
    `mode should equal 'partial', got ${JSON.stringify(resp.mode)}`);
});

test('GCP-3: mode value is exactly the string "partial" (not "or", true, or 1)', async () => {
  const agg = makeTwoServerAgg();
  const resp = await search(agg, { query: 'neon stripe' });
  // Confirm partial fallback fired
  assert.ok(Object.prototype.hasOwnProperty.call(resp, 'mode'), 'expected mode to be present');
  // Strict type + value check
  assert.strictEqual(typeof resp.mode, 'string',
    `mode must be a string, got ${typeof resp.mode}`);
  assert.strictEqual(resp.mode, 'partial',
    `mode must equal exactly 'partial', got ${JSON.stringify(resp.mode)}`);
  assert.notStrictEqual(resp.mode, 'or');
  assert.notStrictEqual(resp.mode, true as unknown as string);
  assert.notStrictEqual(resp.mode, 1 as unknown as string);
});

test('GCP-4: search with no explicit offset → offset key absent from top-level response', async () => {
  const agg = makeNeonOnlyAgg();
  // Probe both: no-query (server summary path) and query path
  const respNoQuery = await search(agg, {});
  const respWithQuery = await search(agg, { query: 'neon' });
  assert.ok(!Object.prototype.hasOwnProperty.call(respNoQuery, 'offset'),
    'offset should be absent when not provided (no-query path)');
  assert.ok(!Object.prototype.hasOwnProperty.call(respWithQuery, 'offset'),
    'offset should be absent when not provided (query path)');
});

test('GCP-5: search with offset:N (N > 0) → offset key present and equals N exactly', async () => {
  const agg = makeNeonOnlyAgg();
  // offset:1 — skip the first neon tool; offset is echoed back in the response
  const resp = await search(agg, { query: 'neon', offset: 1 });
  assert.ok(Object.prototype.hasOwnProperty.call(resp, 'offset'),
    'offset should be present when > 0');
  assert.strictEqual(resp.offset, 1,
    `offset should equal 1, got ${JSON.stringify(resp.offset)}`);
  assert.strictEqual(typeof resp.offset, 'number',
    `offset must be a number, got ${typeof resp.offset}`);
  // Verify offset:2 also round-trips correctly
  const resp2 = await search(agg, { query: 'neon', offset: 2 });
  assert.strictEqual(resp2.offset, 2,
    `offset should equal 2, got ${JSON.stringify(resp2.offset)}`);
});
