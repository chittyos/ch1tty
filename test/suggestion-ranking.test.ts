/**
 * test(HH): getSuggestionsForFocus intent-ranked suggestions
 *
 * When cast resolves with a focus active, suggestions are surfaced from the
 * catalog.  Previously getSuggestionsForFocus returned the first N combos/prompts
 * in catalog order.  With the intent parameter, combos and prompts are ranked by
 * keyword relevance (3+ char terms matched against name/accomplishes/chain/text)
 * so the most contextually relevant suggestions appear first.
 *
 * Tests (12 total):
 *   Unit (getSuggestionsForFocus directly):
 *     1. no intent → catalog order preserved
 *     2. intent with matching terms → best-matching combo first
 *     3. intent with partial matches → partial-match combo before zero-match
 *     4. all-zero scores → catalog order preserved (no sort applied)
 *     5. short-only terms (all ≤2 chars) → catalog order preserved (excluded from scoring)
 *     6. prompts ranked by intent relevance
 *     7. maxCombos/maxPrompts limits applied after ranking
 *     8. unknown focus name → null (unchanged from before)
 *     9. empty catalog → null
 *
 *   Integration (via cast confirm:true through Aggregator):
 *     10. cast:plan with focus + relevant intent → top combo matches intent
 *     11. cast:plan with focus + unrelated intent → suggestions present (no crash), catalog order
 *     12. cast:plan without focus → no suggestions field
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { getSuggestionsForFocus } from '../src/suggestions.js';
import type { FocusSuggestions, SuggestedCombo, SuggestedPrompt } from '../src/suggestions.js';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// ── Catalog fixtures ─────────────────────────────────────────────────────────

const COMBO_PAYMENT: SuggestedCombo = {
  name: 'payment-flow',
  chain: ['stripe/list_payment_intents', 'notion/API-post-page'],
  accomplishes: 'List Stripe payment intents and log them to Notion',
  verified: false,
};

const COMBO_INVOICE: SuggestedCombo = {
  name: 'invoice-tracker',
  chain: ['stripe/list_invoices', 'notion/API-post-page'],
  accomplishes: 'Pull Stripe invoices and write each into a Notion finance tracker',
  verified: false,
};

const COMBO_DATABASE: SuggestedCombo = {
  name: 'database-snapshot',
  chain: ['neon/run_sql', 'github/create_issue'],
  accomplishes: 'Run a database SQL query and open a GitHub issue with results',
  verified: true,
};

const PROMPT_PAYMENT: SuggestedPrompt = {
  text: 'List recent Stripe payment intents for reconciliation',
  resolves_to: 'payment-flow',
};

const PROMPT_INVOICE: SuggestedPrompt = {
  text: 'Pull this month invoices and log them to the finance tracker',
  resolves_to: 'invoice-tracker',
};

const PROMPT_DATABASE: SuggestedPrompt = {
  text: 'Run a SQL query and open a tracking issue on GitHub',
  resolves_to: 'database-snapshot',
};

const FINANCE_PROFILE: FocusSuggestions = {
  description: 'Finance focus',
  combos: [COMBO_PAYMENT, COMBO_INVOICE, COMBO_DATABASE],
  prompts: [PROMPT_PAYMENT, PROMPT_INVOICE, PROMPT_DATABASE],
};

const CATALOG: Record<string, FocusSuggestions> = { finance: FINANCE_PROFILE };

// ── 1. No intent → catalog order preserved ───────────────────────────────────

test('getSuggestionsForFocus: no intent → combos in catalog order', () => {
  const result = getSuggestionsForFocus('finance', CATALOG);
  assert.ok(result, 'result should not be null');
  assert.equal(result.combos[0].name, 'payment-flow', 'first combo is first in catalog');
  assert.equal(result.combos[1].name, 'invoice-tracker', 'second combo is second in catalog');
  assert.equal(result.combos[2].name, 'database-snapshot', 'third combo is third in catalog');
});

// ── 2. Intent with matching terms → best-matching combo first ────────────────

test('getSuggestionsForFocus: intent "database sql query" → database combo first', () => {
  const result = getSuggestionsForFocus('finance', CATALOG, { intent: 'database sql query' });
  assert.ok(result, 'result should not be null');
  assert.equal(result.combos[0].name, 'database-snapshot',
    'database-snapshot has 3/3 term matches ("database" in name/chain desc, "sql" in chain, "query" in accomplishes)');
});

// ── 3. Partial matches → partial-match combo before zero-match ───────────────

test('getSuggestionsForFocus: intent "invoice" → invoice-tracker before database-snapshot', () => {
  // "invoice" is 7 chars → 1 term
  // invoice-tracker: "invoice" in name + chain + accomplishes → score 1.0
  // payment-flow: "invoice" not present → score 0
  // database-snapshot: "invoice" not present → score 0
  const result = getSuggestionsForFocus('finance', CATALOG, { intent: 'invoice' });
  assert.ok(result, 'result should not be null');
  assert.equal(result.combos[0].name, 'invoice-tracker', 'invoice-tracker scores highest');
});

// ── 4. All-zero scores → catalog order preserved ─────────────────────────────

test('getSuggestionsForFocus: intent with no matches → catalog order preserved', () => {
  const result = getSuggestionsForFocus('finance', CATALOG, { intent: 'kubernetes orchestration' });
  assert.ok(result, 'result should not be null');
  // All combos score 0 (no matching terms in their haystacks) → sort not applied → catalog order
  assert.equal(result.combos[0].name, 'payment-flow', 'catalog order preserved when all scores are 0');
  assert.equal(result.combos[1].name, 'invoice-tracker', 'catalog order preserved for second');
});

// ── 5. Short-only terms (all ≤2 chars) → catalog order preserved ─────────────

test('getSuggestionsForFocus: intent with only ≤2-char terms → catalog order preserved', () => {
  // "of" and "in" are 2 chars → excluded → terms=[] → no scoring
  const result = getSuggestionsForFocus('finance', CATALOG, { intent: 'of in to' });
  assert.ok(result, 'result should not be null');
  assert.equal(result.combos[0].name, 'payment-flow', 'catalog order preserved for short-only terms');
});

// ── 6. Prompts ranked by intent relevance ────────────────────────────────────

test('getSuggestionsForFocus: intent "sql query github" → database prompt first', () => {
  // PROMPT_DATABASE: "sql" in text, "query" in text, "github" in text → score 3/3 = 1.0
  // PROMPT_PAYMENT: none match → score 0
  // PROMPT_INVOICE: "invoice" not in intent → score 0
  const result = getSuggestionsForFocus('finance', CATALOG, { intent: 'sql query github' });
  assert.ok(result, 'result should not be null');
  assert.equal(result.prompts[0].resolves_to, 'database-snapshot',
    'database prompt scores 3/3 terms matched');
});

// ── 7. maxCombos/maxPrompts limits applied after ranking ─────────────────────

test('getSuggestionsForFocus: maxCombos:1 with intent → returns only top ranked combo', () => {
  const result = getSuggestionsForFocus('finance', CATALOG, { maxCombos: 1, intent: 'invoice' });
  assert.ok(result, 'result should not be null');
  assert.equal(result.combos.length, 1, 'only 1 combo returned');
  assert.equal(result.combos[0].name, 'invoice-tracker', 'returned combo is the highest-ranked');
});

// ── 8. Unknown focus name → null ─────────────────────────────────────────────

test('getSuggestionsForFocus: unknown focus → null', () => {
  const result = getSuggestionsForFocus('unknown-focus', CATALOG, { intent: 'anything' });
  assert.equal(result, null, 'null for unknown focus name');
});

// ── 9. Empty catalog → null ──────────────────────────────────────────────────

test('getSuggestionsForFocus: empty catalog → null', () => {
  const result = getSuggestionsForFocus('finance', {}, { intent: 'payment' });
  assert.equal(result, null, 'null when catalog has no entries');
});

// ── Integration: via cast(confirm:true) through Aggregator ───────────────────

const LEDGER_DLQ = join(tmpdir(), `ch1tty-hh-ranking-${Date.now()}.jsonl`);

function makeCastAggregator(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', {
    tools: [
      { name: 'list_payment_intents', description: 'List Stripe payment intents', inputSchema: { type: 'object' } },
      { name: 'list_invoices', description: 'List Stripe invoices', inputSchema: { type: 'object' } },
    ],
    resources: [],
    prompts: [],
  });
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('notion', FIXTURE_SERVERS.notion);

  const configs: ServerConfig[] = [
    { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
    { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true },
    { id: 'notion', name: 'Notion', type: 'remote', access: 'readwrite', category: 'documents', endpoint: 'https://notion.so/mcp', lazy: true },
  ];

  const suggestionsCatalog = {
    finance: {
      description: 'Finance',
      combos: [COMBO_DATABASE, COMBO_PAYMENT, COMBO_INVOICE],
      prompts: [PROMPT_DATABASE, PROMPT_PAYMENT, PROMPT_INVOICE],
    } as FocusSuggestions,
  };

  return new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: LEDGER_DLQ,
    suggestionsCatalog,
    focus: 'finance',
    focusProfiles: {
      profiles: {
        finance: { categories: ['ecosystem'], servers: ['stripe', 'neon'], boost: 0.5 },
      },
    },
  });
}

// ── 10. cast:plan with relevant intent → top suggestion matches intent ────────

test('cast:plan + finance focus + payment intent → payment-flow combo first in suggestions', async () => {
  // Catalog order: [database-snapshot, payment-flow, invoice-tracker]
  // With intent "list payment intents stripe", payment-flow scores higher than database-snapshot.
  const agg = makeCastAggregator();
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list payment intents stripe',
    confirm: true,
  });
  assert.equal(result.isError, undefined, 'cast should not error');
  const body = JSON.parse(result.content[0].text as string);
  assert.equal(body.cast, 'plan', 'confirm=true → plan mode');
  assert.ok(body.suggestions, 'suggestions should be present with active finance focus');
  const { combos } = body.suggestions as { combos: Array<{ name: string }> };
  assert.ok(Array.isArray(combos) && combos.length > 0, 'combos must be present');
  assert.equal(combos[0].name, 'payment-flow',
    'payment-flow ranks first for "list payment intents stripe" intent');
  await agg.shutdown();
});

// ── 11. cast:plan with unrelated intent → suggestions present, no crash ──────

test('cast:plan + finance focus + unrelated intent → suggestions present in catalog order', async () => {
  // Catalog order: [database-snapshot, payment-flow, invoice-tracker]
  // Intent "kubernetes orchestration pod" matches no finance combos → all zero → catalog order.
  const agg = makeCastAggregator();
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'run neon database query',
    confirm: true,
  });
  assert.equal(result.isError, undefined, 'cast should not error with unrelated intent');
  const body = JSON.parse(result.content[0].text as string);
  assert.equal(body.cast, 'plan', 'confirm=true → plan mode');
  assert.ok(body.suggestions, 'suggestions must still be present even for unrelated intent');
  const { combos } = body.suggestions as { combos: Array<{ name: string }> };
  assert.ok(Array.isArray(combos) && combos.length > 0, 'combos array must be non-empty');
  // database-snapshot is first in catalog AND matches "database" + "neon" → wins either way
  assert.equal(combos[0].name, 'database-snapshot', 'database-snapshot matches intent terms');
  await agg.shutdown();
});

// ── 12. cast:plan without focus → no suggestions field ───────────────────────

test('cast:plan without focus → no suggestions field in plan', async () => {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  const configs: ServerConfig[] = [
    { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true },
  ];
  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: join(tmpdir(), `ch1tty-hh-nofocus-${Date.now()}.jsonl`),
    suggestionsCatalog: { finance: FINANCE_PROFILE },
  });

  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    confirm: true,
  });
  assert.equal(result.isError, undefined, 'cast should not error');
  const body = JSON.parse(result.content[0].text as string);
  assert.equal(body.cast, 'plan', 'confirm=true → plan mode');
  assert.equal(body.suggestions, undefined, 'no suggestions when focus is not active');
  await agg.shutdown();
});
