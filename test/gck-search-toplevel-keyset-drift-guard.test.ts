/**
 * GCK drift guard: freeze ch1tty/search response top-level key set.
 *
 * Prior tests cover ch1tty/search RESULTS content (focus-scenarios, access-category-filter,
 * aggregator.test) but NO test freezes the exact set of ALLOWED keys at the top level of
 * the search response body. A regression adding a new top-level field (e.g. accidentally
 * injecting sessionContext, adding a `profile` annotation, or promoting a sub-field to
 * root) would pass every existing test silently.
 *
 * The conditional fields `focus` and `sessionId` are also unfrozen: no test currently
 * asserts that `focus` IS present when a focus param is given, or that it is ABSENT when
 * no focus is provided; same for `sessionId`.
 *
 * Actual shapes (stripe-only fixture, probed 2026-09-27):
 *
 *   search 'payments' (no focus, no sessionId)
 *     → {latencyMs, matches, total, tools}
 *
 *   search 'payments' + focus:'finance'
 *     → {focus, latencyMs, matches, suggestions, total, tools}
 *     (suggestions appears when a focus profile matches the query)
 *
 *   search 'payments' + sessionId
 *     → {latencyMs, matches, sessionContext, sessionId, total, tools}
 *     (sessionContext summarises coordinator affinity for this session)
 *
 *   search 'payments' + focus + sessionId
 *     → {focus, latencyMs, matches, sessionContext, sessionId, suggestions, total, tools}
 *
 *   individual tools[] entry (with query score, no focus active on tool)
 *     → {tool, server, serverName, category, description, inputSchema, score}
 *     optional extras: {recentlyUsed, inFocus}
 *
 * Source: src/core.ts line ~585 (search response body construction).
 *
 * GCK freezes:
 *
 *   GCK-1  search with query, no focus, no sessionId → EXACTLY {latencyMs, matches, total, tools}
 *   GCK-2  search with query + focus → EXACTLY {focus, latencyMs, matches, suggestions, total, tools}
 *   GCK-3  search with query + sessionId → EXACTLY {latencyMs, matches, sessionContext, sessionId, total, tools}
 *   GCK-4  search with query + focus + sessionId →
 *          EXACTLY {focus, latencyMs, matches, sessionContext, sessionId, suggestions, total, tools}
 *   GCK-5  each tools[] entry has NO key outside the max allowed set
 *          {tool, server, serverName, category, description, inputSchema, score, recentlyUsed, inFocus}
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

// ── Frozen key sets ───────────────────────────────────────────────────────────

const SEARCH_KEYS_BASE: readonly string[] = ['latencyMs', 'matches', 'total', 'tools'];
const SEARCH_KEYS_WITH_FOCUS: readonly string[] = ['focus', 'latencyMs', 'matches', 'suggestions', 'total', 'tools'];
const SEARCH_KEYS_WITH_SESSION: readonly string[] = ['latencyMs', 'matches', 'sessionContext', 'sessionId', 'total', 'tools'];
const SEARCH_KEYS_WITH_BOTH: readonly string[] = ['focus', 'latencyMs', 'matches', 'sessionContext', 'sessionId', 'suggestions', 'total', 'tools'];
const TOOL_ENTRY_MAX_KEYS = new Set(['tool', 'server', 'serverName', 'category', 'description', 'inputSchema', 'score', 'recentlyUsed', 'inFocus']);

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_CONFIGS: ServerConfig[] = [
  {
    id: 'stripe',
    name: 'Stripe',
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: 'https://stripe.com/mcp',
    lazy: true,
  },
];

// 'stripe payments' matches all 3 stripe fixture tools above threshold.
const QUERY = 'stripe payments';

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gck-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
}

async function search(
  agg: Aggregator,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/search', { query: QUERY, ...extra });
  assert.equal(result.isError, undefined, 'search must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥ 1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.ok(Array.isArray(body['tools']), 'response must have tools array');
  assert.ok((body['matches'] as number) > 0, 'expected > 0 matches for query: ' + QUERY);
  return body;
}

function sortedKeys(obj: object): string[] {
  return Object.keys(obj).sort();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GCK-1: search with query (no focus, no sessionId) top-level key set is exactly {latencyMs, matches, total, tools}', async () => {
  const agg = makeAgg();
  const body = await search(agg);
  const actual = sortedKeys(body);
  const expected = [...SEARCH_KEYS_BASE].sort();
  assert.deepEqual(
    actual,
    expected,
    `search top-level keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
});

test('GCK-2: search with focus adds exactly "focus" and "suggestions" and no other new keys', async () => {
  const agg = makeAgg();
  const body = await search(agg, { focus: 'finance' });
  const actual = sortedKeys(body);
  const expected = [...SEARCH_KEYS_WITH_FOCUS].sort();
  assert.deepEqual(
    actual,
    expected,
    `search+focus top-level keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
  assert.equal(body['focus'], 'finance', 'focus value must equal the passed focus param');
});

test('GCK-3: search with sessionId adds exactly "sessionContext" and "sessionId" and no other new keys', async () => {
  const agg = makeAgg();
  const SESSION = 'gck-test-session-1';
  const body = await search(agg, { sessionId: SESSION });
  const actual = sortedKeys(body);
  const expected = [...SEARCH_KEYS_WITH_SESSION].sort();
  assert.deepEqual(
    actual,
    expected,
    `search+sessionId top-level keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
  assert.equal(body['sessionId'], SESSION, 'sessionId value must echo the passed sessionId');
});

test('GCK-4: search with focus + sessionId top-level key set is exactly {focus, latencyMs, matches, sessionContext, sessionId, suggestions, total, tools}', async () => {
  const agg = makeAgg();
  const SESSION = 'gck-test-session-2';
  const body = await search(agg, { focus: 'finance', sessionId: SESSION });
  const actual = sortedKeys(body);
  const expected = [...SEARCH_KEYS_WITH_BOTH].sort();
  assert.deepEqual(
    actual,
    expected,
    `search+focus+sessionId top-level keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
});

test('GCK-5: each tools[] entry has no key outside the max allowed set {tool, server, serverName, category, description, inputSchema, score, recentlyUsed, inFocus}', async () => {
  const agg = makeAgg();
  // Run two searches: one without focus (no inFocus), one with focus (inFocus may appear)
  const bodyNoFocus = await search(agg);
  const bodyWithFocus = await search(agg, { focus: 'finance' });
  for (const [label, body] of [['no-focus', bodyNoFocus], ['with-focus', bodyWithFocus]] as const) {
    const tools = body['tools'] as Record<string, unknown>[];
    assert.ok(tools.length > 0, `expected ≥ 1 tool entry in ${label} results`);
    for (const entry of tools) {
      const keys = Object.keys(entry);
      for (const key of keys) {
        assert.ok(
          TOOL_ENTRY_MAX_KEYS.has(key),
          `unexpected key '${key}' in tools[] entry (${label}) — not in max set ${JSON.stringify([...TOOL_ENTRY_MAX_KEYS].sort())}`,
        );
      }
    }
  }
});
