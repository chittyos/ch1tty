/**
 * GCJ drift guard: freeze cast:plan exact top-level key set (no focus, no
 * session baseline).
 *
 * Prior tests cover cast:plan FIELD VALUE TYPES (GK), cast:plan sessionContext
 * VALUE TYPES (GS), and EA froze the REQUIRED top-level fields for each cast
 * mode. But no test freezes the EXACT set of ALLOWED keys at the top level of
 * a cast:plan response. A regression adding an unexpected key (e.g. a leaked
 * `context`, `metadata`, or `focusHint` annotation) would pass every
 * existing test silently.
 *
 * Complementing GU (exact key sets for cast:no_match and cast:resolved) and
 * GV (exact key set for cast:executed), GCJ freezes the EXACT top-level key
 * sets for cast:plan — the confirm:true dry-run mode.
 *
 * GCA (open PR) freezes cast:plan when focus is active; GCG (open PR) freezes
 * cast:plan when both focus and session are active. GCJ fills the symmetric
 * gap: the baseline with neither focus nor session.
 *
 * Actual shapes (keyword route, stripe-only fixture, suggestionsCatalog:{},
 * probed 2026-09-27):
 *
 *   cast:plan (no session, no focus, no explain, suggestionsCatalog:{})
 *     → {alternatives, args, cast, hint, intent, latencyMs, resolved, resolvedBy}
 *     NOTE: `resources` is absent because listSuggestionResources() returns
 *     nothing when suggestionsCatalog is {}. `alternatives` is present
 *     because 3 stripe tools all score above 0.1 and the top-2 become
 *     alternatives[].
 *
 *   cast:plan (with sessionId, no focus, suggestionsCatalog:{})
 *     → above set PLUS sessionContext
 *
 *   cast:plan (no session, no focus, explain:true, suggestionsCatalog:{})
 *     → base set PLUS explanation
 *
 * GCJ freezes:
 *
 *   GCJ-1  cast:plan baseline (no session, no focus, no explain) has EXACTLY
 *          {alternatives, args, cast, hint, intent, latencyMs, resolved, resolvedBy}.
 *          (EA froze REQUIRED keys are present but does NOT assert no extra
 *           keys are added; a regression injecting e.g. "context" or "focusHint"
 *           at the top level would pass EA silently.)
 *
 *   GCJ-2  cast:plan WITH sessionId adds exactly sessionContext and no other
 *          new key — EXACTLY GCJ-1 set PLUS sessionContext.
 *          (GS froze sessionContext VALUE TYPES; no test freezes that
 *           sessionContext is the ONLY extra key added by the session path.)
 *
 *   GCJ-3  cast:plan WITH explain:true adds exactly explanation and no other
 *          new top-level key — EXACTLY GCJ-1 PLUS explanation.
 *
 *   GCJ-4  cast:plan does NOT contain `focus`, `scope`, `suggestions`,
 *          `resolvedFromCatalog`, or `chainContinuation` in the base path
 *          (no focus, no scope param, no catalog match).
 *
 *   GCJ-5  cast:plan does NOT contain `sessionContext` when no sessionId is
 *          passed — even after a prior call has established session state on
 *          this aggregator instance.
 *
 * cast:plan is triggered via confirm:true (dry-run: resolves without executing).
 * Fixture: stripe only (list_payments, get_balance, create_payment_intent).
 * Intent "list stripe payments" reliably resolves to stripe/list_payments.
 *
 * Catalog isolation: suggestionsCatalog:{} prevents listSuggestionResources()
 * from returning catalog-based MCP resources that would add a `resources` key
 * to the response (matching the technique used in GCA/GCH/GCI tests).
 *
 * Frozen 2026-09-27.
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

// Base set: cast:plan with stripe fixture, no focus, no session, no explain,
// suggestionsCatalog:{} (empty catalog → no resources in related).
const PLAN_KEYS_BASE: readonly string[] = [
  'alternatives', 'args', 'cast', 'hint', 'intent', 'latencyMs', 'resolved', 'resolvedBy',
];

const PLAN_KEYS_WITH_SESSION: readonly string[] = [
  ...PLAN_KEYS_BASE, 'sessionContext',
];

const PLAN_KEYS_WITH_EXPLAIN: readonly string[] = [
  ...PLAN_KEYS_BASE, 'explanation',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// "list stripe payments" reliably matches all 3 stripe tools (above 0.1
// threshold); list_payments wins; get_balance and create_payment_intent
// appear in alternatives.
const INTENT = 'list stripe payments';

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gcj-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(BASE_CONFIGS, {
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
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, confirm: true, ...extra });
  assert.equal(result.isError, undefined, 'cast must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥ 1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(body['cast'], 'plan', `expected cast:plan, got cast="${String(body['cast'])}"`);
  return body;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GCJ-1: cast:plan base top-level key set is exactly the frozen set (no session, no focus, no explain)', async () => {
  const agg = makeAgg();
  try {
    const body = await plan(agg);
    const actual = Object.keys(body).sort();
    const expected = [...PLAN_KEYS_BASE].sort();
    assert.deepEqual(
      actual,
      expected,
      `cast:plan top-level keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GCJ-2: cast:plan WITH sessionId adds exactly sessionContext and no other new key', async () => {
  const agg = makeAgg();
  try {
    const SESSION = 'gcj-session-keyset-2';
    // Warm session so sessionContext has callCount > 0.
    await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SESSION });
    const body = await plan(agg, { sessionId: SESSION });
    const actual = Object.keys(body).sort();
    const expected = [...PLAN_KEYS_WITH_SESSION].sort();
    assert.deepEqual(
      actual,
      expected,
      `cast:plan+sessionId top-level keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GCJ-3: cast:plan WITH explain:true adds exactly explanation and no other new top-level key', async () => {
  const agg = makeAgg();
  try {
    const body = await plan(agg, { explain: true });
    const actual = Object.keys(body).sort();
    const expected = [...PLAN_KEYS_WITH_EXPLAIN].sort();
    assert.deepEqual(
      actual,
      expected,
      `cast:plan+explain top-level keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GCJ-4: cast:plan does NOT contain focus, scope, suggestions, resolvedFromCatalog, or chainContinuation in the base path', async () => {
  const agg = makeAgg();
  try {
    const body = await plan(agg);
    for (const absent of ['focus', 'scope', 'suggestions', 'resolvedFromCatalog', 'chainContinuation']) {
      assert.ok(
        !Object.prototype.hasOwnProperty.call(body, absent),
        `"${absent}" must be absent in cast:plan base path (no focus, no scope, no catalog match)`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('GCJ-5: cast:plan does NOT contain sessionContext when no sessionId is passed', async () => {
  const agg = makeAgg();
  try {
    // Establish session state on this aggregator instance.
    const SESSION = 'gcj-absence-session-5';
    await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SESSION });
    // cast:plan WITHOUT sessionId — sessionContext must not bleed in.
    const body = await plan(agg);
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'sessionContext'),
      'sessionContext must be absent in cast:plan when no sessionId is passed',
    );
  } finally {
    await agg.shutdown();
  }
});
