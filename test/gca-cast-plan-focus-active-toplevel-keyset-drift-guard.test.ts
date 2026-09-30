/**
 * GCA drift guard: freeze cast:plan exact top-level key set when a focus
 * profile is active.
 *
 * EA froze the required top-level fields for cast:plan (no focus, no scope,
 * no session), and GBZ froze cast:executed's exact top-level key set when
 * focus is active. No test yet freezes the EXACT top-level key set of
 * cast:plan (confirm:true) when a focus profile IS active. A regression
 * adding an extra top-level key alongside `focus` (e.g. a leaked
 * `focusProfile` annotation or a spurious `inFocusTools` count) would pass
 * every existing test silently.
 *
 * Source: src-stdio/aggregator.ts lines ~1599–1624 (cast:plan body):
 *   ...(focusName ? { focus: focusName } : {})
 *   ...(focusSuggestions ? { suggestions: focusSuggestions } : {})
 *
 * GCA freezes:
 *
 *   GCA-1  cast:plan WITH focus active (no catalog suggestions) adds exactly
 *          `focus` to the EA base set — no other new key.
 *          Base set (from EA): {alternatives, args, cast, hint, intent,
 *          latencyMs, resolved, resolvedBy}.
 *          (EA asserts the required set is present but does not freeze the
 *           EXACT set nor assert what IS present when focus is active.)
 *
 *   GCA-2  cast:plan WITH focus active AND catalog suggestions adds exactly
 *          `focus` and `suggestions` — no other new keys beyond the EA base.
 *          (The focusSuggestions path adds suggestions but no other field.)
 *
 *   GCA-3  cast:plan WITH focus active does NOT add `scope`,
 *          `resolvedFromCatalog`, `chainContinuation`, `explanation`, or
 *          `sessionContext` when those are not applicable.
 *
 *   GCA-4  the `focus` value is a non-empty string equal to the active profile
 *          name — not an object, not a boolean, not null.
 *
 *   GCA-5  `suggestions` when present is an object with exactly the key set
 *          {combos, prompts} — same shape frozen by GBZ-5 for cast:executed.
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

// Focus-active base set: cast:plan with focus active and empty suggestionsCatalog.
// EA base = {alternatives, args, cast, hint, intent, latencyMs, resolved, resolvedBy}
// + `focus` from focusName path. No `resources` because listSuggestionResources()
// returns nothing when suggestionsCatalog is {}.
const PLAN_FOCUS_KEYS: readonly string[] = [
  'alternatives', 'args', 'cast', 'focus', 'hint', 'intent',
  'latencyMs', 'resolved', 'resolvedBy',
];

// Focus-active + suggestions set: when suggestionsCatalog has a 'payments'
// entry matching the active focus, focusSuggestions is non-null → adds suggestions.
// The catalog entry also appears as an MCP resource → adds resources.
// The resolved stripe/list_payments tool appears in the catalog chain → adds
// resolvedFromCatalog + chainContinuation.
const PLAN_FOCUS_SUGGESTIONS_KEYS: readonly string[] = [
  'alternatives', 'args', 'cast', 'chainContinuation', 'focus', 'hint',
  'intent', 'latencyMs', 'resolved', 'resolvedBy', 'resolvedFromCatalog',
  'resources', 'suggestions',
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

// Focus profile keyed on 'ecosystem' category — stripe belongs to that category.
const FOCUS_PROFILES = {
  profiles: {
    payments: { categories: ['ecosystem'], servers: [], boost: 0.5 },
  },
};

// Catalog with a combo that matches stripe/list_payments so resolvedFromCatalog
// and chainContinuation appear when the catalog is active.
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
  return join(tmpdir(), `ch1tty-gca-${Date.now()}-${++_seq}.jsonl`);
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

async function castPlan(
  agg: Aggregator,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, confirm: true, ...extra });
  assert.equal(result.isError, undefined, 'cast must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥ 1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(body['cast'], 'plan', `expected cast:plan, got cast="${String(body['cast'])}"`);
  return body;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GCA-1: cast:plan with focus active (no catalog suggestions) adds exactly `focus` to base set', async () => {
  const agg = makeAgg({ withSuggestions: false });
  try {
    const body = await castPlan(agg);
    const actual = Object.keys(body).sort();
    const expected = [...PLAN_FOCUS_KEYS].sort();
    assert.deepEqual(
      actual,
      expected,
      `cast:plan+focus keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GCA-2: cast:plan with focus active and catalog suggestions adds exactly `focus` and `suggestions`', async () => {
  const agg = makeAgg({ withSuggestions: true });
  try {
    const body = await castPlan(agg);
    const actual = Object.keys(body).sort();
    const expected = [...PLAN_FOCUS_SUGGESTIONS_KEYS].sort();
    assert.deepEqual(
      actual,
      expected,
      `cast:plan+focus+suggestions keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GCA-3: cast:plan with focus active does NOT contain scope, resolvedFromCatalog, chainContinuation, explanation, or sessionContext', async () => {
  const agg = makeAgg({ withSuggestions: false });
  try {
    const body = await castPlan(agg);
    for (const absent of ['scope', 'resolvedFromCatalog', 'chainContinuation', 'explanation', 'sessionContext']) {
      assert.ok(
        !Object.prototype.hasOwnProperty.call(body, absent),
        `"${absent}" must be absent in cast:plan+focus when not applicable`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('GCA-4: cast:plan `focus` value is a non-empty string equal to the active profile name', async () => {
  const agg = makeAgg({ withSuggestions: false });
  try {
    const body = await castPlan(agg);
    assert.ok(
      typeof body['focus'] === 'string' && (body['focus'] as string).length > 0,
      `focus must be a non-empty string, got ${JSON.stringify(body['focus'])}`,
    );
    assert.equal(body['focus'], 'payments', 'focus value must equal the active profile name');
  } finally {
    await agg.shutdown();
  }
});

test('GCA-5: cast:plan `suggestions` object has exactly {combos, prompts} when present', async () => {
  const agg = makeAgg({ withSuggestions: true });
  try {
    const body = await castPlan(agg);
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
