/**
 * ET: Drift guard — topCandidates array item shape in cast explain responses.
 *
 * Every verbosity level includes topCandidates in the explain object but no
 * prior guard freezes the shape of each item inside that array. A future
 * refactor that adds, removes, or renames a field on the item objects would
 * pass all existing field-name guards silently.
 *
 * topCandidates is built once (verbosity-independent) from the top-5 scored
 * tools before verbosity branching (aggregator line ~2029):
 *
 *   without focus: { tool: string, score: number }
 *   with    focus: { tool: string, score: number, inFocus: boolean }
 *
 * When focus is active, inFocus is present on EVERY item — true for in-focus
 * tools, false for out-of-focus tools. Out-of-focus items do NOT have the key
 * conditionally absent; it is always emitted when a focus profile is active.
 *
 * On no_match (0 scored candidates): topCandidates is [] for all verbosities.
 *
 * CLAUDE.md § buildCastExplanation metric freeze applies here:
 * if a test fails with an UNEXPECTED key, a field was added or renamed —
 * REJECT per the metric freeze; if it fails with a MISSING key, a field was
 * intentionally removed — update the frozen set below only after confirming.
 *
 * ── no focus: item keys (2 fields) ──────────────────────────────────────────
 *   score, tool
 *
 * ── focus:code active: item keys (3 fields) ──────────────────────────────────
 *   inFocus, score, tool
 *
 * ── no_match: topCandidates is [] ────────────────────────────────────────────
 *
 * Frozen 2026-09-19.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// ── Frozen item key sets ──────────────────────────────────────────────────────

/** 2 keys: present in every item when no focus profile is active. */
const NO_FOCUS_ITEM_KEYS: readonly string[] = ['score', 'tool'];

/** 3 keys: present in every item when a focus profile is active. */
const FOCUS_ITEM_KEYS: readonly string[] = ['inFocus', 'score', 'tool'];

// ── Fixture setup ─────────────────────────────────────────────────────────────

const DLQ = join(tmpdir(), `ch1tty-et-${Date.now()}.jsonl`);

/**
 * Inline focus profiles make focus tests hermetic: CH1TTY_FOCUS_PROFILES env
 * var cannot change the 'code' profile definition at runtime.
 */
const FOCUS_PROFILES = {
  profiles: {
    code: { categories: ['code'] as string[], servers: ['neon'] as string[], boost: 0.5 },
  },
};

function makeAggregator(withFocus = false): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  backend.defineServer('tasks', FIXTURE_SERVERS.tasks);
  const configs: ServerConfig[] = [
    { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true },
    { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
    { id: 'tasks', name: 'Tasks', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://tasks.chitty.cc/mcp', lazy: true },
  ];
  return new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: DLQ,
    ...(withFocus ? { focusProfiles: FOCUS_PROFILES } : {}),
  });
}

// ── Suite 1: no focus ─────────────────────────────────────────────────────────

describe('ET — topCandidates item shape in explain (no focus)', () => {
  test('no focus multi-candidate — each item has exactly {tool, score} (2 keys)', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'low',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
      const explanation = body['explanation'] as Record<string, unknown>;
      assert.ok(explanation !== undefined, 'explanation must be present');
      const items = explanation['topCandidates'] as unknown[];
      assert.ok(Array.isArray(items), 'topCandidates must be an array');
      assert.ok(items.length > 0, 'topCandidates must be non-empty for a multi-candidate intent');
      const expected = [...NO_FOCUS_ITEM_KEYS].sort();
      for (const [i, item] of items.entries()) {
        const actual = Object.keys(item as object).sort();
        assert.deepEqual(
          actual,
          expected,
          `topCandidates[${i}] keys drifted.\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('no focus multi-candidate — item field types (tool: string, score: finite number)', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'low',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
      const explanation = body['explanation'] as Record<string, unknown>;
      const items = explanation['topCandidates'] as Array<Record<string, unknown>>;
      assert.ok(Array.isArray(items) && items.length > 0, 'topCandidates must be non-empty');
      for (const [i, item] of items.entries()) {
        assert.equal(typeof item['tool'], 'string', `topCandidates[${i}].tool must be a string`);
        assert.ok((item['tool'] as string).length > 0, `topCandidates[${i}].tool must be non-empty`);
        assert.equal(typeof item['score'], 'number', `topCandidates[${i}].score must be a number`);
        assert.ok(Number.isFinite(item['score'] as number), `topCandidates[${i}].score must be finite`);
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('no focus no_match — topCandidates is [] (empty array)', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'zzzzzzzzz_no_match_et_test_xyz_9999',
        explain: true,
        verbosity: 'low',
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
      assert.equal(body['cast'], 'no_match');
      const explanation = body['explanation'] as Record<string, unknown>;
      assert.ok(explanation !== undefined, 'explanation must be present on no_match when explain:true');
      const items = explanation['topCandidates'];
      assert.ok(Array.isArray(items), 'topCandidates must be an array on no_match');
      assert.equal((items as unknown[]).length, 0, 'topCandidates must be [] on no_match');
    } finally {
      await agg.shutdown();
    }
  });

  test('no focus multi-candidate — item shape is identical for medium and full verbosity', async () => {
    const agg = makeAggregator();
    try {
      for (const verbosity of ['medium', 'full'] as const) {
        const result = await agg.callTool('ch1tty/cast', {
          intent: 'list database projects',
          explain: true,
          verbosity,
          dryRun: true,
        });
        assert.equal(result.isError, undefined, `cast should not error (${verbosity})`);
        const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
        const explanation = body['explanation'] as Record<string, unknown>;
        assert.ok(explanation !== undefined, `explanation must be present (${verbosity})`);
        const items = explanation['topCandidates'] as unknown[];
        assert.ok(Array.isArray(items), `topCandidates must be an array (${verbosity})`);
        assert.ok(items.length > 0, `topCandidates must be non-empty (${verbosity})`);
        const expected = [...NO_FOCUS_ITEM_KEYS].sort();
        for (const [i, item] of items.entries()) {
          const actual = Object.keys(item as object).sort();
          assert.deepEqual(
            actual,
            expected,
            `topCandidates[${i}] keys drifted at verbosity ${verbosity}.\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`,
          );
        }
      }
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 2: focus:code ───────────────────────────────────────────────────────

describe('ET — topCandidates item shape in explain (focus:code)', () => {
  test('focus:code multi-candidate — each item has exactly {tool, score, inFocus: boolean} (3 keys)', async () => {
    const agg = makeAggregator(true);
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'low',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
      const explanation = body['explanation'] as Record<string, unknown>;
      assert.ok(explanation !== undefined, 'explanation must be present');
      const items = explanation['topCandidates'] as unknown[];
      assert.ok(Array.isArray(items), 'topCandidates must be an array');
      assert.ok(items.length > 0, 'topCandidates must be non-empty for a multi-candidate intent');
      const expected = [...FOCUS_ITEM_KEYS].sort();
      for (const [i, item] of items.entries()) {
        const actual = Object.keys(item as object).sort();
        assert.deepEqual(
          actual,
          expected,
          `topCandidates[${i}] keys drifted.\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`,
        );
        assert.equal(
          typeof (item as Record<string, unknown>)['inFocus'],
          'boolean',
          `topCandidates[${i}].inFocus must be a boolean`,
        );
        assert.equal(typeof (item as Record<string, unknown>)['tool'], 'string', `topCandidates[${i}].tool must be a string`);
        assert.ok(((item as Record<string, unknown>)['tool'] as string).length > 0, `topCandidates[${i}].tool must be non-empty`);
        assert.equal(typeof (item as Record<string, unknown>)['score'], 'number', `topCandidates[${i}].score must be a number`);
        assert.ok(Number.isFinite((item as Record<string, unknown>)['score'] as number), `topCandidates[${i}].score must be finite`);
      }
      assert.ok(
        items.some(item => (item as Record<string, unknown>)['inFocus'] === false),
        'at least one topCandidates item must have inFocus: false when not all tools are in focus',
      );
      assert.ok(
        items.some(item => (item as Record<string, unknown>)['inFocus'] === true),
        'at least one topCandidates item must have inFocus: true when some tools are in focus',
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('focus:code no_match — topCandidates is [] (empty array)', async () => {
    const agg = makeAggregator(true);
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'zzzzzzzzz_no_match_et_test_xyz_9999',
        explain: true,
        verbosity: 'low',
        focus: 'code',
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
      assert.equal(body['cast'], 'no_match');
      const explanation = body['explanation'] as Record<string, unknown>;
      assert.ok(explanation !== undefined, 'explanation must be present on no_match when explain:true');
      const items = explanation['topCandidates'];
      assert.ok(Array.isArray(items), 'topCandidates must be an array on no_match');
      assert.equal((items as unknown[]).length, 0, 'topCandidates must be [] on no_match');
    } finally {
      await agg.shutdown();
    }
  });

  test('focus:code multi-candidate — item shape is identical for medium and full verbosity', async () => {
    const agg = makeAggregator(true);
    try {
      for (const verbosity of ['medium', 'full'] as const) {
        const result = await agg.callTool('ch1tty/cast', {
          intent: 'list database projects',
          explain: true,
          verbosity,
          focus: 'code',
          dryRun: true,
        });
        assert.equal(result.isError, undefined, `cast should not error (${verbosity})`);
        const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
        const explanation = body['explanation'] as Record<string, unknown>;
        assert.ok(explanation !== undefined, `explanation must be present (${verbosity})`);
        const items = explanation['topCandidates'] as unknown[];
        assert.ok(Array.isArray(items), `topCandidates must be an array (${verbosity})`);
        assert.ok(items.length > 0, `topCandidates must be non-empty (${verbosity})`);
        const expected = [...FOCUS_ITEM_KEYS].sort();
        for (const [i, item] of items.entries()) {
          const actual = Object.keys(item as object).sort();
          assert.deepEqual(
            actual,
            expected,
            `topCandidates[${i}] keys drifted at verbosity ${verbosity}.\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`,
          );
        }
      }
    } finally {
      await agg.shutdown();
    }
  });
});
