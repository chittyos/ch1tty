/**
 * GBZ drift guard: freeze cast:executed exact top-level key set when a focus
 * profile is active.
 *
 * GV froze the top-level key set of cast:executed for the common path — no
 * focus, no scope, no catalog route, no chain continuation. GV-5 asserts that
 * `focus` and `suggestions` are ABSENT when not applicable, but no test
 * freezes the exact key set when a focus profile IS active. A regression
 * introducing an extra key alongside `focus` (e.g. a leaked `focusProfile`
 * object or a spurious `inFocus` annotation) would pass every existing test
 * silently.
 *
 * Source: src-stdio/aggregator.ts lines ~1658, ~1668 (cast:executed body):
 *   ...(focusName ? { focus: focusName } : {})
 *   ...(focusSuggestions ? { suggestions: focusSuggestions } : {})
 *
 * GBZ-1  cast:executed WITH focus active (no catalog suggestions) adds exactly
 *        `focus` to the GV-1 base set — no other new key.
 *        (GV-5 asserts focus is absent with no focus; GV never asserts what
 *         IS the exact set when focus IS present.)
 *
 * GBZ-2  cast:executed WITH focus active AND catalog suggestions adds exactly
 *        `focus` and `suggestions` — no other new keys beyond GV-1 base.
 *        (`focusSuggestions` is populated from suggestionsCatalog keyed by
 *         the active focus name when the catalog has entries for that profile.)
 *
 * GBZ-3  cast:executed WITH focus active does NOT add `scope`,
 *        `resolvedFromCatalog`, `chainContinuation`, or `explanation` when
 *        those are not applicable (scope not passed, non-catalog match, no
 *        chain, explain not set).
 *
 * GBZ-4  the `focus` value is a non-empty string equal to the active profile
 *        name — not an object, not a boolean, not null.
 *
 * GBZ-5  `suggestions` when present is an object with exactly the key set
 *        `{combos, prompts}` (same shape frozen by ED for
 *        catalog.activeFocusSuggestions) — the focus-active path does not
 *        inject extra keys into the suggestions object.
 *
 * Frozen 2026-09-26.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level cast key
 *     set, not explanation sub-object)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Frozen key sets ───────────────────────────────────────────────────────────

// Focus-active base set: present in cast:executed with focus active and empty
// suggestionsCatalog. No `resources` key (listSuggestionResources() returns
// nothing when suggestionsCatalog is {}). Compare with GV-1's base set which
// DOES include `resources` because GV passes the default catalog that has
// finance/billing entries scoring > 0.1 against 'list stripe payments'.
const EXECUTED_FOCUS_KEYS: readonly string[] = [
  'alternatives', 'cast', 'focus', 'intent', 'latencyBreakdown',
  'latencyMs', 'resolved', 'resolvedBy', 'score',
];

// Catalog-active set: when suggestionsCatalog has a 'payments' entry with a
// combo whose chain includes stripe/list_payments, the resolved tool is detected
// as a catalog combo step → adds resolvedFromCatalog + chainContinuation.
// The catalog entries also appear as MCP resources (listSuggestionResources) →
// adds resources. Focus suggestions are non-null → adds suggestions.
const EXECUTED_FOCUS_SUGGESTIONS_KEYS: readonly string[] = [
  'alternatives', 'cast', 'chainContinuation', 'focus', 'intent',
  'latencyBreakdown', 'latencyMs', 'resolved', 'resolvedBy',
  'resolvedFromCatalog', 'resources', 'score', 'suggestions',
];

const SUGGESTIONS_ENTRY_KEYS: readonly string[] = ['combos', 'prompts'];

// ── Helpers ───────────────────────────────────────────────────────────────────

const STRIPE_CONFIG: ServerConfig = {
  id: 'stripe',
  name: 'Stripe',
  type: 'remote',
  access: 'readwrite',
  category: 'ecosystem',
  endpoint: 'https://stripe.com/mcp',
  lazy: true,
};

// Focus profile keyed on 'ecosystem' category — stripe belongs to that category
// so the intent will resolve to an in-focus tool.
const FOCUS_PROFILES = {
  profiles: {
    payments: { categories: ['ecosystem'], servers: [], boost: 0.5 },
  },
};

// Catalog entries keyed by focus profile name. 'payments' profile has one combo.
const SUGGESTIONS_CATALOG = {
  payments: {
    description: 'Payments-focused combos',
    combos: [
      {
        name: 'List and get balance',
        chain: ['stripe/list_payments', 'stripe/get_balance'],
        accomplishes: 'list payments then check balance',
        verified: true,
      },
    ],
    prompts: [{ text: 'check stripe balance', resolves_to: 'stripe/get_balance' }],
  },
};

const INTENT = 'list stripe payments';

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gbz-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(opts: { withSuggestions: boolean }): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator([STRIPE_CONFIG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    focus: 'payments',
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: opts.withSuggestions ? SUGGESTIONS_CATALOG : {},
  });
}

async function castExecuted(
  agg: Aggregator,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, ...extra });
  assert.equal(result.isError, undefined, 'cast must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥ 1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(body['cast'], 'executed', `expected cast:executed, got cast="${String(body['cast'])}"`);
  return body;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GBZ-1: cast:executed with focus active (no catalog suggestions) adds exactly `focus` to base set', async () => {
  const agg = makeAgg({ withSuggestions: false });
  try {
    const body = await castExecuted(agg);
    const actual = Object.keys(body).sort();
    const expected = [...EXECUTED_FOCUS_KEYS].sort();
    assert.deepEqual(
      actual,
      expected,
      `cast:executed+focus keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GBZ-2: cast:executed with focus active and catalog suggestions adds exactly `focus` and `suggestions`', async () => {
  const agg = makeAgg({ withSuggestions: true });
  try {
    const body = await castExecuted(agg);
    const actual = Object.keys(body).sort();
    const expected = [...EXECUTED_FOCUS_SUGGESTIONS_KEYS].sort();
    assert.deepEqual(
      actual,
      expected,
      `cast:executed+focus+suggestions keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GBZ-3: cast:executed with focus active does NOT contain scope, resolvedFromCatalog, chainContinuation, or explanation', async () => {
  const agg = makeAgg({ withSuggestions: false });
  try {
    const body = await castExecuted(agg);
    for (const absent of ['scope', 'resolvedFromCatalog', 'chainContinuation', 'explanation']) {
      assert.ok(
        !Object.prototype.hasOwnProperty.call(body, absent),
        `"${absent}" must be absent in cast:executed+focus when not applicable`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('GBZ-4: cast:executed `focus` value is a non-empty string equal to the active profile name', async () => {
  const agg = makeAgg({ withSuggestions: false });
  try {
    const body = await castExecuted(agg);
    assert.ok(
      typeof body['focus'] === 'string' && (body['focus'] as string).length > 0,
      `focus must be a non-empty string, got ${JSON.stringify(body['focus'])}`,
    );
    assert.equal(body['focus'], 'payments', 'focus value must equal the active profile name');
  } finally {
    await agg.shutdown();
  }
});

test('GBZ-5: cast:executed `suggestions` object has exactly {combos, prompts} when present', async () => {
  const agg = makeAgg({ withSuggestions: true });
  try {
    const body = await castExecuted(agg);
    const suggestions = body['suggestions'] as Record<string, unknown>;
    assert.ok(
      suggestions !== null && typeof suggestions === 'object' && !Array.isArray(suggestions),
      `suggestions must be an object, got ${JSON.stringify(suggestions)}`,
    );
    const actual = Object.keys(suggestions).sort();
    assert.deepEqual(
      actual,
      [...SUGGESTIONS_ENTRY_KEYS].sort(),
      `suggestions keys must be exactly ${JSON.stringify(SUGGESTIONS_ENTRY_KEYS)}; got ${JSON.stringify(actual)}`,
    );
    assert.ok(Array.isArray(suggestions['combos']), 'suggestions.combos must be an array');
    assert.ok(Array.isArray(suggestions['prompts']), 'suggestions.prompts must be an array');
  } finally {
    await agg.shutdown();
  }
});
