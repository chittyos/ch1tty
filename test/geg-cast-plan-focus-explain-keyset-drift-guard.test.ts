/**
 * GEG drift guard: freeze cast:plan exact top-level key set when BOTH a
 * focus profile is active AND explain:true is set.
 *
 * Prior tests cover the two conditionals independently:
 *
 *   GCJ-3 froze cast:plan + explain:true WITHOUT focus active:
 *         EXACTLY {alternatives, args, cast, explanation, hint, intent,
 *                  latencyMs, resolved, resolvedBy} (base 8 + explanation).
 *
 *   GCA-1 froze cast:plan + focus active WITHOUT explain:
 *         EXACTLY {alternatives, args, cast, focus, hint, intent, latencyMs,
 *                  resolved, resolvedBy} (base 8 + focus).
 *
 *   GCA-3 asserts that `explanation` is absent when explain is NOT set —
 *         it does NOT cover the case where explain IS set alongside focus.
 *
 * Neither test covers the combination: focus ∧ explain on cast:plan.
 * A regression that:
 *   (a) drops `explanation` from the plan response when focus is also active
 *       (treating them as mutually exclusive), or
 *   (b) injects an unexpected key (e.g. a leaked `focusHint`, `focusScore`,
 *       or `focusBoost`) only when both focus and explain are present,
 * would pass GCJ-3 (no focus) and GCA (no explain) silently.
 *
 * Actual cast:plan body construction (aggregator.ts ~line 1599):
 *   {
 *     cast: 'plan',
 *     resolvedBy, intent, latencyMs,
 *     ...(focusName   ? { focus: focusName } : {}),
 *     ...(scopeAnnot  ? { scope }            : {}),
 *     ...(explanation ? { explanation }       : {}),
 *     resolved: { tool, server, category, description, score, inputSchema },
 *     ...(catalogCombo ? { resolvedFromCatalog } : {}),
 *     ...(chainContinuation ? { chainContinuation } : {}),
 *     alternatives,
 *     ...related,
 *     ...(planSessionContext ? { sessionContext } : {}),
 *     ...(focusSuggestions   ? { suggestions }   : {}),
 *     args, hint,
 *   }
 *
 * GEG freezes:
 *
 *   GEG-1  cast:plan + focus active + explain:true → EXACTLY
 *          {alternatives, args, cast, explanation, focus, hint, intent,
 *           latencyMs, resolved, resolvedBy} — 10 keys.
 *          (GCA base 9 + explanation; GCJ+explain base 9 + focus; confirms
 *           both conditional fields appear together and no third key leaks.)
 *
 *   GEG-2  cast:plan + focus active + explain:true + sessionId → EXACTLY
 *          GEG-1 set PLUS sessionContext — 11 keys.
 *          (Confirms sessionContext adds alongside focus+explanation without
 *           displacing or blocking either.)
 *
 *   GEG-3  cast:plan + focus active + explain:false → exactly GCA base set,
 *          NO `explanation` key — confirms that explanation is absent when
 *          explain is not set (absence guard alongside the presence guard
 *          in GEG-1).
 *
 *   GEG-4  `explanation` is present and is an object (not null, not a
 *          primitive) when explain:true is set with focus active.
 *          (Type guard — explanation must survive the focus code path.)
 *
 * Fixture: stripe only (list_payments, get_balance, create_payment_intent).
 * Focus profile: 'payments' → boosting stripe server tools.
 * Intent: "list stripe payments" reliably resolves to stripe/list_payments.
 * Catalog isolation: suggestionsCatalog:{} prevents catalog-resource injection.
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

// Base (no focus, no explain, no session): from GCJ-1.
const PLAN_KEYS_BASE: readonly string[] = [
  'alternatives', 'args', 'cast', 'hint', 'intent', 'latencyMs', 'resolved', 'resolvedBy',
];

// focus active, no explain: from GCA-1.
const PLAN_KEYS_FOCUS: readonly string[] = [
  ...PLAN_KEYS_BASE, 'focus',
];

// focus active + explain:true: GCA base + explanation (the gap GEG freezes).
const PLAN_KEYS_FOCUS_EXPLAIN: readonly string[] = [
  ...PLAN_KEYS_BASE, 'explanation', 'focus',
];

// focus active + explain:true + sessionId.
const PLAN_KEYS_FOCUS_EXPLAIN_SESSION: readonly string[] = [
  ...PLAN_KEYS_BASE, 'explanation', 'focus', 'sessionContext',
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
  return join(tmpdir(), `ch1tty-geg-${Date.now()}-${++_seq}.jsonl`);
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

async function plan(
  agg: Aggregator,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', {
    intent: INTENT,
    confirm: true,
    ...extra,
  });
  assert.equal(result.isError, undefined, 'cast must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥ 1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(body['cast'], 'plan', `expected cast:plan, got cast="${String(body['cast'])}"`);
  return body;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GEG-1: cast:plan + focus active + explain:true has EXACTLY base + focus + explanation (10 keys)', async () => {
  const agg = makeAgg();
  try {
    const body = await plan(agg, { focus: 'payments', explain: true });
    const actual = Object.keys(body).sort();
    const expected = [...PLAN_KEYS_FOCUS_EXPLAIN].sort();
    assert.deepEqual(
      actual,
      expected,
      `cast:plan+focus+explain top-level keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GEG-2: cast:plan + focus + explain + sessionId has EXACTLY base + focus + explanation + sessionContext (11 keys)', async () => {
  const agg = makeAgg();
  try {
    const SID = 'geg-session-2';
    // Warm session so sessionContext is populated.
    await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SID });
    const body = await plan(agg, { focus: 'payments', explain: true, sessionId: SID });
    const actual = Object.keys(body).sort();
    const expected = [...PLAN_KEYS_FOCUS_EXPLAIN_SESSION].sort();
    assert.deepEqual(
      actual,
      expected,
      `cast:plan+focus+explain+session top-level keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GEG-3: cast:plan + focus active WITHOUT explain has EXACTLY base + focus, NO explanation key', async () => {
  const agg = makeAgg();
  try {
    const body = await plan(agg, { focus: 'payments' });
    const actual = Object.keys(body).sort();
    const expected = [...PLAN_KEYS_FOCUS].sort();
    assert.deepEqual(
      actual,
      expected,
      `cast:plan+focus (no explain) top-level keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
    );
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'explanation'),
      'explanation must be absent when explain is not set',
    );
  } finally {
    await agg.shutdown();
  }
});

test('GEG-4: explanation is an object (not null, not primitive) when explain:true is set with focus active', async () => {
  const agg = makeAgg();
  try {
    const body = await plan(agg, { focus: 'payments', explain: true });
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
