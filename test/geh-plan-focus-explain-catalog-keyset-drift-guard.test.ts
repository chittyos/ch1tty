/**
 * GEH drift guard: freeze cast:plan exact top-level key set when focus is active,
 * explain:true is set, AND a catalog combo matches.
 *
 * Prior tests cover pairs of these three conditionals:
 *
 *   GEG  cast:plan + focus + explain, NO catalog (suppressed via suggestionsCatalog:{})
 *        → EXACTLY {alternatives, args, cast, explanation, focus, hint, intent,
 *                   latencyMs, resolved, resolvedBy} — 10 keys.
 *
 *   GCA-2  cast:plan + focus + catalog, NO explain
 *          → EXACTLY {alternatives, args, cast, chainContinuation, focus, hint,
 *                     intent, latencyMs, resolved, resolvedBy, resolvedFromCatalog,
 *                     resources, suggestions} — 13 keys.
 *
 *   GCA-3  absence guard: explanation absent when explain NOT set (focus+catalog) —
 *          this does NOT cover the presence path (focus ∧ catalog ∧ explain).
 *
 * No test freezes the three-way combination: focus ∧ explain ∧ catalog on cast:plan.
 * A regression that:
 *   (a) silently drops `explanation` when catalogCombo is also present (treating
 *       explain:true as incompatible with the catalog path), or
 *   (b) injects an extra key (e.g. a leaked `catalogScore`, `focusExplain`) only
 *       when all three conditionals are active, or
 *   (c) drops `chainContinuation` or `resolvedFromCatalog` when explain is set,
 * would pass GEG (which suppresses catalog) and GCA (which never sets explain).
 *
 * Actual cast:plan body construction (aggregator.ts ~line 1599):
 *   {
 *     cast: 'plan', resolvedBy, intent, latencyMs,
 *     ...(focusName        ? { focus }             : {}),
 *     ...(scopeAnnotation  ? { scope }              : {}),
 *     ...(explanation      ? { explanation }        : {}),
 *     resolved: { tool, server, category, description, score, inputSchema },
 *     ...(catalogCombo     ? { resolvedFromCatalog } : {}),
 *     ...(chainContinuation ? { chainContinuation }  : {}),
 *     alternatives,
 *     ...related,                // → resources (from catalog)
 *     ...(planSessionContext ? { sessionContext } : {}),
 *     ...(focusSuggestions   ? { suggestions }   : {}),
 *     args, hint,
 *   }
 *
 * GEH freezes:
 *
 *   GEH-1  focus + explain + catalog (no session, no scope) → EXACTLY
 *          {alternatives, args, cast, chainContinuation, explanation, focus, hint,
 *           intent, latencyMs, resolved, resolvedBy, resolvedFromCatalog, resources,
 *           suggestions} — 14 keys.
 *          (GCA-2 base 13 + explanation; both explanation and all catalog keys must
 *           coexist without any additional key leaking)
 *
 *   GEH-2  focus + explain + catalog + session → GEH-1 + sessionContext — 15 keys.
 *          (Confirms the four-way composition: catalog ∧ explain ∧ focus ∧ session)
 *
 *   GEH-3  focus + catalog WITHOUT explain → GCA-2 base (13 keys), NO explanation.
 *          Symmetric absence guard: ensures explanation is not injected when
 *          explain param is absent (even when the catalog path is active).
 *
 *   GEH-4  focus + explain + catalog + scope → GEH-1 + scope — 15 keys.
 *          (Closes the scope variant of the three-way combination)
 *
 *   GEH-5  explanation is a non-null object when explain:true is set alongside
 *          focus and catalog (type guard — explanation must survive the catalog path).
 *
 * Fixture: same SUGGESTIONS_CATALOG + FOCUS_PROFILES setup as GCA-2 — stripe server,
 * 2-step chain ['stripe/list_payments', 'stripe/get_balance'], focus:'payments'
 * (categories: ['ecosystem'], stripe category: ecosystem).
 * Intent "list stripe payments" reliably resolves to stripe/list_payments via keyword.
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level cast:plan
 *     key set, not explanation sub-object fields)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Frozen exact key sets ─────────────────────────────────────────────────────

// GEH-1: focus + explain + catalog (no session, no scope) — 14 keys.
// GCA-2 base (13) + explanation.
const PLAN_FOCUS_EXPLAIN_CATALOG_BASE: readonly string[] = [
  'alternatives', 'args', 'cast', 'chainContinuation', 'explanation', 'focus',
  'hint', 'intent', 'latencyMs', 'resolved', 'resolvedBy', 'resolvedFromCatalog',
  'resources', 'suggestions',
];

// GEH-2: GEH-1 + sessionContext — 15 keys.
const PLAN_FOCUS_EXPLAIN_CATALOG_SESSION: readonly string[] = [
  ...PLAN_FOCUS_EXPLAIN_CATALOG_BASE, 'sessionContext',
];

// GCA-2 base (no explain) — for the absence guard GEH-3.
const PLAN_FOCUS_CATALOG_NO_EXPLAIN: readonly string[] = [
  'alternatives', 'args', 'cast', 'chainContinuation', 'focus', 'hint',
  'intent', 'latencyMs', 'resolved', 'resolvedBy', 'resolvedFromCatalog',
  'resources', 'suggestions',
];

// GEH-4: GEH-1 + scope — 15 keys.
const PLAN_FOCUS_EXPLAIN_CATALOG_SCOPE: readonly string[] = [
  ...PLAN_FOCUS_EXPLAIN_CATALOG_BASE, 'scope',
];

// ── Fixtures ──────────────────────────────────────────────────────────────────

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
    payments: { categories: ['ecosystem' as const], servers: [], boost: 0.5 },
  },
};

// Catalog with a 2-step chain starting at stripe/list_payments — triggers
// resolvedFromCatalog + chainContinuation + resources + suggestions.
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
  return join(tmpdir(), `ch1tty-geh-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator([STRIPE_CONFIG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    focus: 'payments',
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: SUGGESTIONS_CATALOG,
  });
}

async function plan(
  agg: Aggregator,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, confirm: true, ...extra });
  assert.equal(result.isError, undefined, 'cast must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥ 1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(body['cast'], 'plan', `expected cast:plan, got cast="${String(body['cast'])}"`);
  return body;
}

/** Warm the session then call plan with the given extras (sessionId included). */
async function planWithSession(
  agg: Aggregator,
  sessionId: string,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId });
  return plan(agg, { sessionId, ...extra });
}

// ── GEH-1: focus + explain + catalog (no session, no scope) ──────────────────

test('GEH-1: cast:plan + focus + explain + catalog (no session) has EXACTLY 14 frozen keys', async () => {
  const agg = makeAgg();
  try {
    const body = await plan(agg, { explain: true });
    const actual = Object.keys(body).sort();
    const expected = [...PLAN_FOCUS_EXPLAIN_CATALOG_BASE].sort();
    assert.deepEqual(
      actual,
      expected,
      `cast:plan+focus+explain+catalog top-level keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEH-2: focus + explain + catalog + session ────────────────────────────────

test('GEH-2: cast:plan + focus + explain + catalog + session has EXACTLY GEH-1 set + sessionContext (15 keys)', async () => {
  const agg = makeAgg();
  try {
    const body = await planWithSession(agg, 'geh-session-2', { explain: true });
    const actual = Object.keys(body).sort();
    const expected = [...PLAN_FOCUS_EXPLAIN_CATALOG_SESSION].sort();
    assert.deepEqual(
      actual,
      expected,
      `cast:plan+focus+explain+catalog+session top-level keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
    );
    assert.ok(
      typeof body['sessionContext'] === 'object' && body['sessionContext'] !== null,
      'sessionContext must be a non-null object',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEH-3: absence guard — explanation absent when explain NOT set ─────────────

test('GEH-3: cast:plan + focus + catalog WITHOUT explain has EXACTLY GCA-2 base (13 keys), NO explanation', async () => {
  const agg = makeAgg();
  try {
    const body = await plan(agg);
    const actual = Object.keys(body).sort();
    const expected = [...PLAN_FOCUS_CATALOG_NO_EXPLAIN].sort();
    assert.deepEqual(
      actual,
      expected,
      `cast:plan+focus+catalog (no explain) top-level keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'explanation'),
      false,
      'explanation must be ABSENT when explain param is not set (even with focus + catalog active)',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEH-4: focus + explain + catalog + scope ──────────────────────────────────

test('GEH-4: cast:plan + focus + explain + catalog + scope has EXACTLY GEH-1 set + scope (15 keys)', async () => {
  const agg = makeAgg();
  try {
    const body = await plan(agg, { explain: true, scope: { servers: ['stripe'] } });
    const actual = Object.keys(body).sort();
    const expected = [...PLAN_FOCUS_EXPLAIN_CATALOG_SCOPE].sort();
    assert.deepEqual(
      actual,
      expected,
      `cast:plan+focus+explain+catalog+scope top-level keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
    );
    assert.ok(typeof body['scope'] === 'object', 'scope must be an object');
  } finally {
    await agg.shutdown();
  }
});

// ── GEH-5: explanation type guard ─────────────────────────────────────────────

test('GEH-5: explanation is a non-null object when explain:true is set with focus + catalog active', async () => {
  const agg = makeAgg();
  try {
    const body = await plan(agg, { explain: true });
    assert.ok(
      Object.prototype.hasOwnProperty.call(body, 'explanation'),
      'explanation must be present when explain:true is set',
    );
    const exp = body['explanation'];
    assert.ok(
      exp !== null && typeof exp === 'object',
      `explanation must be a non-null object; got ${typeof exp} (${JSON.stringify(exp)})`,
    );
  } finally {
    await agg.shutdown();
  }
});
