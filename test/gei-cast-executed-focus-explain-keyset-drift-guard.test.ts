/**
 * GEI drift guard: freeze cast:executed exact top-level key set when BOTH a
 * focus profile is active AND explain:true is set.
 *
 * Prior tests cover the two conditionals independently:
 *
 *   GV-4 froze cast:executed + explain:true WITHOUT focus active:
 *        EXACTLY {alternatives, cast, explanation, intent, latencyBreakdown,
 *                 latencyMs, resolved, resolvedBy, score} (GV base + explanation).
 *
 *   GBZ-1 froze cast:executed + focus active WITHOUT explain:
 *          EXACTLY {alternatives, cast, focus, intent, latencyBreakdown,
 *                   latencyMs, resolved, resolvedBy, score} (GV base + focus).
 *
 *   GV-3 asserts that `explanation` is absent when explain is NOT set —
 *        it does NOT cover the case where explain IS set alongside focus.
 *
 * Neither test covers the combination: focus ∧ explain on cast:executed.
 * A regression that:
 *   (a) drops `explanation` from the executed response when focus is also active
 *       (treating them as mutually exclusive), or
 *   (b) injects an unexpected key (e.g. a leaked `focusProfile`, `focusScore`,
 *       or `focusBias`) only when both focus and explain are present,
 * would pass GV-4 (no focus) and GBZ (no explain) silently.
 *
 * Analogous to GEG (which froze the same combination for cast:plan).
 *
 * Actual cast:executed body construction (aggregator.ts ~lines 1648–1674):
 *   {
 *     cast: 'executed',
 *     resolvedBy, intent, latencyMs, latencyBreakdown,
 *     ...(focusName    ? { focus: focusName }       : {}),
 *     ...(scopeAnnot   ? { scope }                  : {}),
 *     ...(explanation  ? { explanation }             : {}),
 *     resolved: best.namespacedName,
 *     score: best.score,
 *     ...(catalogCombo      ? { resolvedFromCatalog } : {}),
 *     ...(chainContinuation ? { chainContinuation }   : {}),
 *     ...(alternatives.length > 0 ? { alternatives }  : {}),
 *     ...related,
 *     ...(castSessionContext ? { sessionContext }      : {}),
 *     ...(focusSuggestions  ? { suggestions }          : {}),
 *   }
 *
 * GEI freezes:
 *
 *   GEI-1  cast:executed + focus active + explain:true → EXACTLY
 *          {alternatives, cast, explanation, focus, intent, latencyBreakdown,
 *           latencyMs, resolved, resolvedBy, score} — 10 keys.
 *          (GBZ-1 base 9 + explanation; GV-4 base 9 + focus; confirms both
 *           conditional fields appear together and no third key leaks.)
 *
 *   GEI-2  cast:executed + focus + explain:true + sessionId → EXACTLY
 *          GEI-1 set PLUS sessionContext — 11 keys.
 *          (Confirms sessionContext adds alongside focus+explanation without
 *           displacing or blocking either.)
 *
 *   GEI-3  cast:executed + focus active WITHOUT explain → GBZ-1 exact set,
 *          NO `explanation` key — absence guard alongside the presence guard
 *          in GEI-1.
 *
 *   GEI-4  `explanation` is present and is an object (not null, not a
 *           primitive) when explain:true is set with focus active.
 *           (Type guard — explanation must survive the focus code path.)
 *
 * Fixture: stripe only (list_payments, get_balance, create_payment_intent).
 * Focus profile: 'payments' → boosting stripe/ecosystem server.
 * Intent: "list stripe payments" reliably resolves to stripe/list_payments.
 * Catalog isolation: suggestionsCatalog:{} prevents catalog-resource injection.
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level cast:executed
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

// focus active, no explain: from GBZ-1.
const EXECUTED_KEYS_FOCUS: readonly string[] = [
  'alternatives', 'cast', 'focus', 'intent', 'latencyBreakdown',
  'latencyMs', 'resolved', 'resolvedBy', 'score',
];

// focus active + explain:true: GBZ-1 base + explanation (the gap GEI freezes).
const EXECUTED_KEYS_FOCUS_EXPLAIN: readonly string[] = [
  ...EXECUTED_KEYS_FOCUS, 'explanation',
];

// focus active + explain:true + sessionId: GEI-1 + sessionContext.
const EXECUTED_KEYS_FOCUS_EXPLAIN_SESSION: readonly string[] = [
  ...EXECUTED_KEYS_FOCUS_EXPLAIN, 'sessionContext',
];

// ── Fixtures ──────────────────────────────────────────────────────────────────

const STRIPE_CFG: ServerConfig = {
  id: 'stripe',
  name: 'Stripe',
  type: 'remote',
  access: 'readwrite',
  category: 'ecosystem',
  endpoint: 'https://stripe.com/mcp',
  lazy: true,
};

const FOCUS_PROFILES = {
  profiles: {
    payments: {
      description: 'Payment tools',
      categories: ['ecosystem' as const],
      servers: ['stripe'],
      boost: 0.5,
    },
  },
};

const INTENT = 'list stripe payments';

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gei-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator([STRIPE_CFG], {
    focusProfiles: FOCUS_PROFILES,
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    suggestionsCatalog: {},
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

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GEI-1: cast:executed + focus active + explain:true has EXACTLY base + focus + explanation (10 keys)', async () => {
  const agg = makeAgg();
  try {
    const body = await castExecuted(agg, { focus: 'payments', explain: true });
    const actual = Object.keys(body).sort();
    const expected = [...EXECUTED_KEYS_FOCUS_EXPLAIN].sort();
    assert.deepEqual(
      actual,
      expected,
      `cast:executed+focus+explain top-level keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GEI-2: cast:executed + focus + explain + sessionId has EXACTLY base + focus + explanation + sessionContext (11 keys)', async () => {
  const agg = makeAgg();
  try {
    const SID = 'gei-session-2';
    // Warm session so sessionContext is populated.
    await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SID });
    const body = await castExecuted(agg, { focus: 'payments', explain: true, sessionId: SID });
    const actual = Object.keys(body).sort();
    const expected = [...EXECUTED_KEYS_FOCUS_EXPLAIN_SESSION].sort();
    assert.deepEqual(
      actual,
      expected,
      `cast:executed+focus+explain+session top-level keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GEI-3: cast:executed + focus active WITHOUT explain has EXACTLY focus set, NO explanation key', async () => {
  const agg = makeAgg();
  try {
    const body = await castExecuted(agg, { focus: 'payments' });
    const actual = Object.keys(body).sort();
    const expected = [...EXECUTED_KEYS_FOCUS].sort();
    assert.deepEqual(
      actual,
      expected,
      `cast:executed+focus (no explain) top-level keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
    );
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'explanation'),
      'explanation must be absent when explain is not set',
    );
  } finally {
    await agg.shutdown();
  }
});

test('GEI-4: explanation is an object (not null, not primitive) when explain:true is set with focus active', async () => {
  const agg = makeAgg();
  try {
    const body = await castExecuted(agg, { focus: 'payments', explain: true });
    assert.ok(
      Object.prototype.hasOwnProperty.call(body, 'explanation'),
      'explanation must be present when explain:true is set',
    );
    const exp = body['explanation'];
    assert.ok(
      exp !== null && typeof exp === 'object',
      `explanation must be an object; got ${typeof exp} (${JSON.stringify(exp)})`,
    );
  } finally {
    await agg.shutdown();
  }
});
