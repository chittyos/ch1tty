/**
 * GAW drift guard: freeze exact keyset of the `suggestions` sub-object in cast responses.
 *
 * Prior coverage of `suggestions`:
 *   GAT-5: suggestions absent from cast:plan when no focus active.
 *   GAU-5: suggestions absent from cast:discovered when not applicable.
 *   No test on main freezes the exact key set of the suggestions sub-object itself
 *   (i.e. when focus IS active and the catalog has a matching profile).
 *
 * The `suggestions` field is `getSuggestionsForFocus(focusName, catalog, {intent})`
 * which returns `{ combos: SuggestedCombo[]; prompts: SuggestedPrompt[] } | null`.
 *
 * SuggestedCombo: { name, chain, accomplishes, verified, notes? }
 * SuggestedPrompt: { text, resolves_to }
 *
 * Source: src-stdio/aggregator.ts line ~1670
 *         src-stdio/suggestions.ts (getSuggestionsForFocus, SuggestedCombo, SuggestedPrompt)
 *
 * Invariants frozen by GAW:
 *
 *   GAW-1  suggestions top-level keyset is exactly {combos, prompts} in cast:executed
 *          (a regression adding e.g. suggestions.description or suggestions.focus
 *           would pass all prior tests silently)
 *
 *   GAW-2  each combos item without notes has exactly {name, chain, accomplishes, verified}
 *
 *   GAW-3  each combos item WITH notes has exactly {name, chain, accomplishes, verified, notes}
 *          (symmetric to GAW-2 — a regression dropping notes from the output type when
 *           it's present in the source would pass GAW-2 silently)
 *
 *   GAW-4  each prompts item has exactly {text, resolves_to}
 *
 *   GAW-5  suggestions is absent from cast:executed when no focus is active
 *          (symmetric absence guard — no focus → no suggestions)
 *
 * Frozen 2026-09-24.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (suggestions sub-object, not explain)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { FocusSuggestions } from '../src-stdio/suggestions.js';
import type { ServerConfig } from '../src/types.js';
import type { FocusProfiles } from '../src-stdio/focus.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Frozen exact key sets ──────────────────────────────────────────────────────

const SUGGESTIONS_KEYS: readonly string[] = ['combos', 'prompts'];
const COMBO_KEYS_BASE: readonly string[] = ['name', 'chain', 'accomplishes', 'verified'];
const COMBO_KEYS_WITH_NOTES: readonly string[] = [...COMBO_KEYS_BASE, 'notes'];
const PROMPT_KEYS: readonly string[] = ['text', 'resolves_to'];

// ── Test fixtures ─────────────────────────────────────────────────────────────

const FOCUS_NAME = 'gaw-finance';

const FOCUS_PROFILES: FocusProfiles = {
  profiles: {
    [FOCUS_NAME]: {
      categories: ['ecosystem'],
      servers: ['stripe'],
      boost: 0.5,
    },
  },
};

// A combo WITHOUT notes
const COMBO_WITHOUT_NOTES: FocusSuggestions['combos'][0] = {
  name: 'List payments then get balance',
  chain: ['stripe/list_payments', 'stripe/get_balance'],
  accomplishes: 'Check recent payment activity and current account balance',
  verified: true,
};

// A combo WITH notes
const COMBO_WITH_NOTES: FocusSuggestions['combos'][0] = {
  name: 'Create payment intent',
  chain: ['stripe/create_payment_intent'],
  accomplishes: 'Create a new payment charge',
  verified: false,
  notes: 'Requires amount and currency in args',
};

const TEST_SUGGESTIONS_CATALOG: Record<string, FocusSuggestions> = {
  [FOCUS_NAME]: {
    description: 'Financial and billing tools for Stripe',
    combos: [COMBO_WITHOUT_NOTES, COMBO_WITH_NOTES],
    prompts: [
      { text: 'List recent payments', resolves_to: 'stripe/list_payments' },
      { text: 'Get account balance', resolves_to: 'stripe/get_balance' },
    ],
  },
};

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

const INTENT = 'list stripe payments';

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gaw-${Date.now()}-${++_seq}.jsonl`);
}

function makeAggWithFocus(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    focus: FOCUS_NAME,
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: TEST_SUGGESTIONS_CATALOG,
  });
}

function makeAggNoFocus(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
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
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(body['cast'], 'executed', `expected cast:executed, got cast="${String(body['cast'])}"`);
  return body;
}

function sortedKeys(obj: unknown): string[] {
  assert.ok(obj !== null && typeof obj === 'object' && !Array.isArray(obj), 'must be a plain object');
  return Object.keys(obj as Record<string, unknown>).sort();
}

function assertExactKeys(
  obj: unknown,
  expected: readonly string[],
  label: string,
): void {
  const actual = sortedKeys(obj);
  const exp = [...expected].sort();
  assert.deepEqual(
    actual,
    exp,
    `${label}: keyset must be exactly ${JSON.stringify(exp)}; got ${JSON.stringify(actual)}`,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GAW-1: suggestions top-level keyset is exactly {combos, prompts} in cast:executed', async () => {
  const agg = makeAggWithFocus();
  const body = await castExecuted(agg);
  assert.ok(
    Object.prototype.hasOwnProperty.call(body, 'suggestions'),
    'suggestions must be present when focus is active and catalog has matching profile',
  );
  const suggestions = body['suggestions'];
  assertExactKeys(suggestions, SUGGESTIONS_KEYS, 'GAW-1 suggestions');
});

test('GAW-2: every combos item WITHOUT notes has exactly {name, chain, accomplishes, verified}', async () => {
  const agg = makeAggWithFocus();
  const body = await castExecuted(agg);
  assert.ok(
    Object.prototype.hasOwnProperty.call(body, 'suggestions'),
    'suggestions must be present when focus is active',
  );
  const { combos } = body['suggestions'] as { combos: unknown[] };
  assert.ok(Array.isArray(combos) && combos.length > 0, 'combos must be a non-empty array');
  const withoutNotes = combos.filter(
    (c) => !Object.prototype.hasOwnProperty.call(c, 'notes'),
  );
  assert.ok(withoutNotes.length > 0, 'at least one combo without notes must be present');
  for (const combo of withoutNotes) {
    assertExactKeys(combo, COMBO_KEYS_BASE, 'GAW-2 combo without notes');
  }
});

test('GAW-3: every combos item WITH notes has exactly {name, chain, accomplishes, verified, notes}', async () => {
  const agg = makeAggWithFocus();
  const body = await castExecuted(agg);
  assert.ok(
    Object.prototype.hasOwnProperty.call(body, 'suggestions'),
    'suggestions must be present when focus is active',
  );
  const { combos } = body['suggestions'] as { combos: unknown[] };
  assert.ok(Array.isArray(combos) && combos.length > 0, 'combos must be a non-empty array');
  const withNotes = combos.filter(
    (c) => Object.prototype.hasOwnProperty.call(c, 'notes'),
  );
  assert.ok(withNotes.length > 0, 'at least one combo with notes must be present');
  for (const combo of withNotes) {
    assertExactKeys(combo, COMBO_KEYS_WITH_NOTES, 'GAW-3 combo with notes');
  }
});

test('GAW-4: each prompts item has exactly {text, resolves_to}', async () => {
  const agg = makeAggWithFocus();
  const body = await castExecuted(agg);
  assert.ok(
    Object.prototype.hasOwnProperty.call(body, 'suggestions'),
    'suggestions must be present when focus is active',
  );
  const { prompts } = body['suggestions'] as { prompts: unknown[] };
  assert.ok(Array.isArray(prompts) && prompts.length > 0, 'prompts must be a non-empty array');
  for (const p of prompts) {
    assertExactKeys(p, PROMPT_KEYS, 'GAW-4 prompt item');
  }
});

test('GAW-5: suggestions is absent from cast:executed when no focus is active', async () => {
  const agg = makeAggNoFocus();
  const body = await castExecuted(agg);
  assert.ok(
    !Object.prototype.hasOwnProperty.call(body, 'suggestions'),
    'suggestions must be absent from cast:executed when no focus is active',
  );
});
