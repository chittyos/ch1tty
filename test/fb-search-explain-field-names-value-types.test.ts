/**
 * FB: Drift guard — ch1tty/search explain field names and value types.
 *
 * buildSearchExplanation (src-stdio/aggregator.ts line 2380) is the search
 * counterpart to buildCastExplanation. The cast explain has been exhaustively
 * frozen (EB–EW, DW, ER/ES, ET, EU/EV/EW). The search explain has NO field-name
 * or value-type drift guard — only basic presence checks in search-explain.test.ts.
 * A rename, addition, or type change in buildSearchExplanation would pass silently.
 *
 * buildSearchExplanation always returns:
 *   method        — always 'keyword' (string literal)
 *   matchMode     — 'and' | 'partial'
 *   topCandidates — Array (≤5 items)
 *   rationale     — non-empty string
 *
 * Conditional fields (absent when not triggered):
 *   focus         — string name of active focus profile
 *   focusBoost    — number > 0 (when focus active)
 *   filterContext — { server?: string, category?: string } (when server or category filter)
 *   minScore      — number (when minScore param > 0)
 *
 * topCandidates item fields:
 *   tool           — always, namespaced 'serverId/toolName'
 *   relevanceScore — always, finite number ≥ 0
 *   inFocus        — ONLY on in-focus items when focus active (always true when present);
 *                    ABSENT on out-of-focus items — contrast with cast explain topCandidates
 *                    where inFocus appears on EVERY item when focus is active.
 *   recentlyUsed   — optional, present when the tool was recently used in the session
 *
 * ── Frozen always-present field set (4 fields) ───────────────────────────────
 *   matchMode, method, rationale, topCandidates
 *
 * ── topCandidates item keys: no focus (2 fields) ─────────────────────────────
 *   relevanceScore, tool
 *
 * ── topCandidates item keys: in-focus item (3 fields) ────────────────────────
 *   inFocus, relevanceScore, tool
 *
 * ── topCandidates item keys: out-of-focus item (2 fields) ────────────────────
 *   relevanceScore, tool
 *
 * Frozen 2026-09-19.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// ── Frozen field sets ─────────────────────────────────────────────────────────

/** Always-present keys in the search explanation object (no focus, no filter, no minScore). */
const BASE_EXPLAIN_KEYS: readonly string[] = ['matchMode', 'method', 'rationale', 'topCandidates'];

/** topCandidates item keys when no focus is active. */
const NO_FOCUS_ITEM_KEYS: readonly string[] = ['relevanceScore', 'tool'];

/** topCandidates item keys for IN-FOCUS items (focus active). */
const IN_FOCUS_ITEM_KEYS: readonly string[] = ['inFocus', 'relevanceScore', 'tool'];

// ── Fixture setup ─────────────────────────────────────────────────────────────

function dlq(): string {
  return join(tmpdir(), `ch1tty-fb-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
}

/**
 * Two servers: 'alpha' (category: code) and 'beta' (category: ecosystem).
 * Focus profile 'dev' targets code category → alpha tools are in-focus, beta are not.
 */
const ALPHA_TOOLS = [
  { name: 'list_databases',  description: 'List all databases in the code project', inputSchema: { type: 'object', properties: {} }, response: { content: [{ type: 'text' as const, text: '[]' }] } },
  { name: 'create_database', description: 'Create a new database for code development', inputSchema: { type: 'object', properties: {} }, response: { content: [{ type: 'text' as const, text: '{}' }] } },
];

const BETA_TOOLS = [
  { name: 'list_invoices',  description: 'List invoices for billing and accounting', inputSchema: { type: 'object', properties: {} }, response: { content: [{ type: 'text' as const, text: '[]' }] } },
  { name: 'process_payment', description: 'Process a payment for invoice billing', inputSchema: { type: 'object', properties: {} }, response: { content: [{ type: 'text' as const, text: '{}' }] } },
];

const ALPHA_CFG: ServerConfig = { id: 'alpha', name: 'Alpha', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://alpha.test/mcp', lazy: true };
const BETA_CFG: ServerConfig  = { id: 'beta',  name: 'Beta',  type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://beta.test/mcp', lazy: true };

const FOCUS_PROFILES = {
  profiles: {
    dev: { categories: ['code'] as string[], servers: ['alpha'] as string[], boost: 0.5 },
  },
};

function makeAggregator(withFocus = false): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('alpha', { tools: ALPHA_TOOLS });
  backend.defineServer('beta',  { tools: BETA_TOOLS });
  return new Aggregator([ALPHA_CFG, BETA_CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    ...(withFocus ? { focus: 'dev', focusProfiles: FOCUS_PROFILES } : {}),
  });
}

// ── Suite 1: always-present field names ───────────────────────────────────────

describe('FB — search explain always-present field names', () => {
  test('no focus — explanation has exactly {matchMode, method, rationale, topCandidates} (4 fields)', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/search', { query: 'database', explain: true });
      assert.equal(result.isError, undefined, 'search should not error');
      const data = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
      const explanation = data['explanation'] as Record<string, unknown>;
      assert.ok(explanation !== undefined, 'explanation must be present when explain:true');
      const actual = Object.keys(explanation).sort();
      const expected = [...BASE_EXPLAIN_KEYS].sort();
      assert.deepEqual(
        actual,
        expected,
        `base explain field names drifted.\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('no focus — focus and focusBoost absent', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/search', { query: 'database', explain: true });
      assert.equal(result.isError, undefined, 'search should not error');
      const data = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
      const explanation = data['explanation'] as Record<string, unknown>;
      assert.equal(explanation['focus'], undefined, 'focus must be absent when no focus active');
      assert.equal(explanation['focusBoost'], undefined, 'focusBoost must be absent when no focus active');
    } finally {
      await agg.shutdown();
    }
  });

  test('no filter — filterContext absent', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/search', { query: 'database', explain: true });
      assert.equal(result.isError, undefined, 'search should not error');
      const data = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
      const explanation = data['explanation'] as Record<string, unknown>;
      assert.equal(explanation['filterContext'], undefined, 'filterContext must be absent when no server/category filter');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 2: conditional fields (focus) ───────────────────────────────────────

describe('FB — search explain conditional fields: focus', () => {
  test('focus active — explanation has focus (string) and focusBoost (number)', async () => {
    const agg = makeAggregator(true);
    try {
      const result = await agg.callTool('ch1tty/search', { query: 'database', explain: true });
      assert.equal(result.isError, undefined, 'search should not error');
      const data = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
      const explanation = data['explanation'] as Record<string, unknown>;
      assert.ok(explanation !== undefined, 'explanation must be present');
      assert.equal(typeof explanation['focus'], 'string', 'focus must be a string when focus active');
      assert.ok((explanation['focus'] as string).length > 0, 'focus must be non-empty');
      assert.equal(typeof explanation['focusBoost'], 'number', 'focusBoost must be a number when focus active');
      assert.ok(Number.isFinite(explanation['focusBoost'] as number), 'focusBoost must be finite');
      assert.ok((explanation['focusBoost'] as number) > 0, 'focusBoost must be positive');
    } finally {
      await agg.shutdown();
    }
  });

  test('focus active — explanation field set is base keys + focus + focusBoost (6 fields)', async () => {
    const agg = makeAggregator(true);
    try {
      const result = await agg.callTool('ch1tty/search', { query: 'database', explain: true });
      assert.equal(result.isError, undefined, 'search should not error');
      const data = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
      const explanation = data['explanation'] as Record<string, unknown>;
      assert.ok(explanation !== undefined, 'explanation must be present');
      const actual = Object.keys(explanation).sort();
      const expected = [...BASE_EXPLAIN_KEYS, 'focus', 'focusBoost'].sort();
      assert.deepEqual(
        actual,
        expected,
        `focus explain field names drifted.\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 3: conditional fields (filterContext) ───────────────────────────────

describe('FB — search explain conditional fields: filterContext', () => {
  test('server filter — filterContext present with {server} key', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/search', { query: 'database', server: 'alpha', explain: true });
      assert.equal(result.isError, undefined, 'search should not error');
      const data = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
      const explanation = data['explanation'] as Record<string, unknown>;
      assert.ok(explanation !== undefined, 'explanation must be present');
      assert.ok(explanation['filterContext'] !== undefined, 'filterContext must be present when server filter active');
      const fc = explanation['filterContext'] as Record<string, unknown>;
      assert.equal(typeof fc['server'], 'string', 'filterContext.server must be a string');
      assert.equal(fc['server'], 'alpha', 'filterContext.server must equal the filter value');
      assert.equal(fc['category'], undefined, 'filterContext.category must be absent when only server filter');
    } finally {
      await agg.shutdown();
    }
  });

  test('category filter — filterContext present with {category} key', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/search', { query: 'database', category: 'code', explain: true });
      assert.equal(result.isError, undefined, 'search should not error');
      const data = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
      const explanation = data['explanation'] as Record<string, unknown>;
      assert.ok(explanation !== undefined, 'explanation must be present');
      assert.ok(explanation['filterContext'] !== undefined, 'filterContext must be present when category filter active');
      const fc = explanation['filterContext'] as Record<string, unknown>;
      assert.equal(typeof fc['category'], 'string', 'filterContext.category must be a string');
      assert.equal(fc['category'], 'code', 'filterContext.category must equal the filter value');
      assert.equal(fc['server'], undefined, 'filterContext.server must be absent when only category filter');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 4: topCandidates item shape ─────────────────────────────────────────

describe('FB — search explain topCandidates item shape', () => {
  test('no focus — each item has exactly {relevanceScore, tool} (2 fields)', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/search', { query: 'list', explain: true });
      assert.equal(result.isError, undefined, 'search should not error');
      const data = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
      const explanation = data['explanation'] as Record<string, unknown>;
      const items = explanation['topCandidates'] as unknown[];
      assert.ok(Array.isArray(items), 'topCandidates must be an array');
      assert.ok(items.length > 0, 'topCandidates must be non-empty for a matching query');
      const expected = [...NO_FOCUS_ITEM_KEYS].sort();
      for (const [i, item] of items.entries()) {
        const actual = Object.keys(item as object).sort();
        assert.deepEqual(
          actual,
          expected,
          `topCandidates[${i}] keys drifted (no focus).\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('focus active — in-focus items have {inFocus:true, relevanceScore, tool}; out-of-focus have {relevanceScore, tool}', async () => {
    const agg = makeAggregator(true);
    try {
      // 'list' matches both alpha/list_databases (in-focus) and beta/list_invoices (out-of-focus)
      const result = await agg.callTool('ch1tty/search', { query: 'list', explain: true });
      assert.equal(result.isError, undefined, 'search should not error');
      const data = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
      const explanation = data['explanation'] as Record<string, unknown>;
      const items = explanation['topCandidates'] as Array<Record<string, unknown>>;
      assert.ok(Array.isArray(items), 'topCandidates must be an array');
      assert.ok(items.length > 0, 'topCandidates must be non-empty');

      const inFocusItems = items.filter((item) => item['inFocus'] !== undefined);
      const outOfFocusItems = items.filter((item) => item['inFocus'] === undefined);

      assert.ok(inFocusItems.length > 0, 'at least one in-focus item must be present');
      assert.ok(outOfFocusItems.length > 0, 'at least one out-of-focus item must be present');

      // In-focus items: exactly 3 keys
      const inFocusExpected = [...IN_FOCUS_ITEM_KEYS].sort();
      for (const [i, item] of inFocusItems.entries()) {
        const actual = Object.keys(item).sort();
        assert.deepEqual(
          actual,
          inFocusExpected,
          `in-focus topCandidates[${i}] keys drifted.\nExpected: ${JSON.stringify(inFocusExpected)}\nActual:   ${JSON.stringify(actual)}`,
        );
        assert.equal(item['inFocus'], true, `in-focus item[${i}].inFocus must be true`);
      }

      // Out-of-focus items: exactly 2 keys — no inFocus key
      const outFocusExpected = [...NO_FOCUS_ITEM_KEYS].sort();
      for (const [i, item] of outOfFocusItems.entries()) {
        const actual = Object.keys(item).sort();
        assert.deepEqual(
          actual,
          outFocusExpected,
          `out-of-focus topCandidates[${i}] keys drifted.\nExpected: ${JSON.stringify(outFocusExpected)}\nActual:   ${JSON.stringify(actual)}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 5: value types ──────────────────────────────────────────────────────

describe('FB — search explain value types', () => {
  test('base value types — method, matchMode, rationale, topCandidates, relevanceScore, tool', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/search', { query: 'database', explain: true });
      assert.equal(result.isError, undefined, 'search should not error');
      const data = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
      const explanation = data['explanation'] as Record<string, unknown>;

      assert.equal(explanation['method'], 'keyword', 'method must be the string literal "keyword"');
      assert.ok(
        explanation['matchMode'] === 'and' || explanation['matchMode'] === 'partial',
        `matchMode must be 'and' or 'partial', got: ${String(explanation['matchMode'])}`,
      );
      assert.equal(typeof explanation['rationale'], 'string', 'rationale must be a string');
      assert.ok((explanation['rationale'] as string).length > 0, 'rationale must be non-empty');
      assert.ok(Array.isArray(explanation['topCandidates']), 'topCandidates must be an Array');

      const items = explanation['topCandidates'] as Array<Record<string, unknown>>;
      assert.ok(items.length > 0, 'topCandidates must be non-empty for a matching query');
      for (const [i, item] of items.entries()) {
        assert.equal(typeof item['tool'], 'string', `topCandidates[${i}].tool must be a string`);
        assert.ok((item['tool'] as string).length > 0, `topCandidates[${i}].tool must be non-empty`);
        assert.ok(
          (item['tool'] as string).includes('/'),
          `topCandidates[${i}].tool must be namespaced (contain '/'), got: ${String(item['tool'])}`,
        );
        assert.equal(typeof item['relevanceScore'], 'number', `topCandidates[${i}].relevanceScore must be a number`);
        assert.ok(Number.isFinite(item['relevanceScore'] as number), `topCandidates[${i}].relevanceScore must be finite`);
        assert.ok((item['relevanceScore'] as number) >= 0, `topCandidates[${i}].relevanceScore must be ≥ 0`);
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('matchMode is "partial" when AND fallback fires (two-word query, second word unmatched)', async () => {
    const agg = makeAggregator();
    try {
      // 'database' matches alpha tools; 'xyz_fb_no_match_9999' matches nothing.
      // Two-word AND fails → partial fallback → matchMode === 'partial'.
      const result = await agg.callTool('ch1tty/search', {
        query: 'database xyz_fb_no_match_9999',
        explain: true,
      });
      assert.equal(result.isError, undefined, 'search should not error');
      const data = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
      const explanation = data['explanation'] as Record<string, unknown>;
      assert.equal(explanation['matchMode'], 'partial', 'matchMode must be "partial" when OR fallback fires');
    } finally {
      await agg.shutdown();
    }
  });

  test('matchMode is "and" for a single-term query that matches', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/search', { query: 'database', explain: true });
      assert.equal(result.isError, undefined, 'search should not error');
      const data = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
      const explanation = data['explanation'] as Record<string, unknown>;
      assert.equal(explanation['matchMode'], 'and', 'matchMode must be "and" for a matched single-term query');
    } finally {
      await agg.shutdown();
    }
  });
});
