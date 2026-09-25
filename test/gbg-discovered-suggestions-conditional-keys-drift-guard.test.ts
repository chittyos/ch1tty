/**
 * GBG drift guard: freeze cast:discovered suggestions conditional key set.
 *
 * GBC froze the cast:discovered exact base key set (GBC-1/2) and the
 * sessionContext (GBC-3) and explanation (GBC-4) conditional additions.
 *
 * One conditional remains unfrozen:
 *   ...(focusSuggestions ? { suggestions: focusSuggestions } : {})
 *   (src-stdio/aggregator.ts — discovered response body construction)
 *
 * focusSuggestions is non-null when focusName is set AND the suggestionsCatalog
 * has an entry for that focus. Importantly, cast:discovered does NOT echo back
 * `focus` (unlike cast:plan/executed/resolved which all include `focus` when a
 * focus profile is active — this asymmetry has never been tested directly).
 *
 * GBG freezes five invariants:
 *
 *   GBG-1  focus active + empty catalog → exactly base (no `focus`, no `suggestions`)
 *          (contrast: cast:plan adds `focus`; cast:discovered does not)
 *
 *   GBG-2  focus active + catalog entry → exactly base + `suggestions` (no `focus` key)
 *
 *   GBG-3  focus + catalog + session → exactly base + `suggestions` + `sessionContext`
 *          (two independent conditionals together add exactly 2 keys, no bleed-through)
 *
 *   GBG-4  focus + catalog + explain:true → exactly base + `suggestions` + `explanation`
 *
 *   GBG-5  `suggestions` sub-object has EXACTLY {combos, prompts} —
 *          getSuggestionsForFocus strips the catalog's `description` field;
 *          no test previously froze the suggestions envelope key set
 *
 * Source: src-stdio/aggregator.ts — cast:discovered response construction.
 * Frozen 2026-09-25.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (discovered path, not explain sub-object)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { FocusSuggestions } from '../src/suggestions.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Frozen exact key sets ──────────────────────────────────────────────────────

// Base: prompts-only cast:discovered (billing server, prompt matches, tool does not).
// GBC-1 already froze this exact shape; GBG re-uses it as the anchor.
const DISCOVERED_BASE_KEYS: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'prompts', 'resolvedBy',
];

// Base + suggestions conditional (focus active + catalog entry).
const DISCOVERED_KEYS_WITH_SUGGESTIONS: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'prompts', 'resolvedBy', 'suggestions',
];

// Base + suggestions + sessionContext (two independent conditionals).
const DISCOVERED_KEYS_WITH_SUGGESTIONS_AND_SESSION: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'prompts', 'resolvedBy', 'sessionContext', 'suggestions',
];

// Base + suggestions + explanation.
const DISCOVERED_KEYS_WITH_SUGGESTIONS_AND_EXPLAIN: readonly string[] = [
  'cast', 'explanation', 'hint', 'intent', 'latencyMs', 'prompts', 'resolvedBy', 'suggestions',
];

// ── Catalog fixtures ───────────────────────────────────────────────────────────

/**
 * A minimal finance catalog. Combo/prompt text overlaps with INTENT so
 * getSuggestionsForFocus returns non-empty arrays and the suggestions
 * field appears in the discovered response.
 */
const FINANCE_CATALOG: Record<string, FocusSuggestions> = {
  finance: {
    description: 'Finance domain suggestions',
    combos: [{
      name: 'retrieve invoice',
      accomplishes: 'retrieve and format an accounting invoice',
      chain: ['billing/process_transaction'],
      verified: true,
    }],
    prompts: [{
      text: 'retrieve an accounting invoice for a customer',
      resolves_to: 'billing/invoice_guide',
    }],
  },
};

// ── Server fixtures ────────────────────────────────────────────────────────────

const BILLING_CONFIG: ServerConfig[] = [{
  id: 'billing',
  name: 'Billing',
  type: 'remote',
  access: 'readwrite',
  category: 'ecosystem',
  endpoint: 'https://billing.test/mcp',
  lazy: true,
}];

/**
 * Intent: terms match the prompt (invoice_guide) but not the tool (process_transaction).
 * This guarantees cast:discovered fires (no tool match, one prompt match).
 */
const INTENT = 'retrieve accounting invoice';

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gbg-${Date.now()}-${++_seq}.jsonl`);
}

function makeBackend(): FixtureBackend {
  const backend = new FixtureBackend();
  backend.defineServer('billing', {
    tools: [{
      name: 'process_transaction',
      description: 'process a payment transaction for a purchase order',
      inputSchema: { type: 'object' },
      response: { content: [{ type: 'text', text: 'ok' }] },
    }],
    prompts: [{
      name: 'invoice_guide',
      description: 'retrieve and format an accounting invoice for a customer',
    }],
  });
  return backend;
}

function makeAgg(catalog: Record<string, FocusSuggestions> = {}): Aggregator {
  return new Aggregator(BILLING_CONFIG, {
    backendFactory: () => makeBackend(),
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    suggestionsCatalog: catalog,
  });
}

async function castDiscovered(
  agg: Aggregator,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, ...extra });
  assert.equal(result.isError, undefined, 'cast must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥ 1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(body['cast'], 'discovered', `expected cast:discovered, got cast="${String(body['cast'])}"`);
  return body;
}

function assertExactKeys(
  body: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(body).sort();
  const exp = [...expected].sort();
  assert.deepEqual(
    actual,
    exp,
    `${label}: top-level keys must be exactly ${JSON.stringify(exp)}; got ${JSON.stringify(actual)}`,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GBG-1: focus active + empty catalog → base only; `focus` and `suggestions` both absent', async () => {
  const agg = makeAgg({});
  try {
    const body = await castDiscovered(agg, { focus: 'finance' });
    assertExactKeys(body, DISCOVERED_BASE_KEYS, 'GBG-1');
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'focus'),
      'GBG-1: `focus` must be absent from cast:discovered (cast:plan adds it; discovered does not)',
    );
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'suggestions'),
      'GBG-1: `suggestions` must be absent when catalog has no entry for the active focus',
    );
  } finally {
    await agg.shutdown();
  }
});

test('GBG-2: focus active + catalog entry → exactly base + `suggestions`; `focus` still absent', async () => {
  const agg = makeAgg(FINANCE_CATALOG);
  try {
    const body = await castDiscovered(agg, { focus: 'finance' });
    assertExactKeys(body, DISCOVERED_KEYS_WITH_SUGGESTIONS, 'GBG-2');
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'focus'),
      'GBG-2: `focus` must remain absent from cast:discovered even when catalog has a matching entry',
    );
  } finally {
    await agg.shutdown();
  }
});

test('GBG-3: focus + catalog + session → exactly base + suggestions + sessionContext', async () => {
  const agg = makeAgg(FINANCE_CATALOG);
  try {
    const SESSION = 'gbg-test-session-1';
    await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SESSION, focus: 'finance' });
    const body = await castDiscovered(agg, { focus: 'finance', sessionId: SESSION });
    assertExactKeys(body, DISCOVERED_KEYS_WITH_SUGGESTIONS_AND_SESSION, 'GBG-3');
  } finally {
    await agg.shutdown();
  }
});

test('GBG-4: focus + catalog + explain:true → exactly base + suggestions + explanation', async () => {
  const agg = makeAgg(FINANCE_CATALOG);
  try {
    const body = await castDiscovered(agg, { focus: 'finance', explain: true });
    assertExactKeys(body, DISCOVERED_KEYS_WITH_SUGGESTIONS_AND_EXPLAIN, 'GBG-4');
  } finally {
    await agg.shutdown();
  }
});

test('GBG-5: suggestions sub-object has EXACTLY {combos, prompts} — description stripped by getSuggestionsForFocus', async () => {
  const agg = makeAgg(FINANCE_CATALOG);
  try {
    const body = await castDiscovered(agg, { focus: 'finance' });
    const suggestions = body['suggestions'] as Record<string, unknown>;
    assert.ok(typeof suggestions === 'object' && suggestions !== null, 'GBG-5: suggestions must be an object');
    const actualKeys = Object.keys(suggestions).sort();
    assert.deepEqual(
      actualKeys,
      ['combos', 'prompts'],
      `GBG-5: suggestions must have exactly {combos, prompts}; got ${JSON.stringify(actualKeys)}`,
    );
    assert.ok(Array.isArray(suggestions['combos']), 'GBG-5: suggestions.combos must be an array');
    assert.ok(Array.isArray(suggestions['prompts']), 'GBG-5: suggestions.prompts must be an array');
    assert.ok(
      !Object.prototype.hasOwnProperty.call(suggestions, 'description'),
      'GBG-5: suggestions must not carry the catalog description field',
    );
  } finally {
    await agg.shutdown();
  }
});
