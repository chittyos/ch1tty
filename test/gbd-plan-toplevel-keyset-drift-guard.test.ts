/**
 * GBD drift guard: freeze cast:plan exact top-level key set.
 *
 * Prior tests cover cast:plan FIELD VALUE TYPES (GK, GS) and cast:plan's
 * latencyBreakdown ABSENCE (GT-5), but NO test freezes the exact set of
 * ALLOWED keys at the top level of the cast:plan response body. A regression
 * adding or renaming a top-level field would pass every existing test silently.
 *
 * Complementing GV (which froze exact top-level key sets for cast:executed),
 * GBC (which froze cast:discovered), and GU (which froze cast:no_match and
 * cast:resolved), GBD freezes the exact top-level key sets for cast:plan.
 *
 * Actual shape (keyword route, stripe-only fixture, probed 2026-09-25):
 *
 *   cast:plan (no session, no focus, no explain, stripe fixture)
 *     → {alternatives, args, cast, hint, intent, latencyMs, resolved,
 *        resolvedBy, resources}
 *     NOTE: `resources` appears because listSuggestionResources() always
 *     includes the suggestions catalog as MCP resources; the finance/billing-
 *     themed suggestion entries score > 0.1 against intent 'list stripe payments'.
 *     NOTE: `alternatives` is always present in cast:plan (unconditional
 *     spread at aggregator line ~1616); contrast with cast:executed which only
 *     includes `alternatives` when non-empty.
 *     NOTE: No `score` at top level — plan embeds score inside `resolved`.
 *     NOTE: No `latencyBreakdown` — plan has latencyMs only (GT-5 confirmed).
 *
 *   cast:plan (with sessionId, no focus, no explain)
 *     → above set PLUS sessionContext
 *
 *   cast:plan (no session, no focus, explain:true)
 *     → base set PLUS explanation
 *
 * GBD freezes:
 *
 *   GBD-1  cast:plan without session, without focus, without explain has
 *           EXACTLY {alternatives, args, cast, hint, intent, latencyMs,
 *           resolved, resolvedBy, resources}.
 *           (EG used PLAN_PERMITTED superset allowing 16 possible keys; a
 *            regression adding e.g. "context" or "brainPath" at the top level
 *            would pass all prior tests silently.)
 *
 *   GBD-2  cast:plan WITH sessionId has EXACTLY the GBD-1 set PLUS
 *           sessionContext — no other key is added.
 *           (GS froze sessionContext VALUE TYPES; no test freezes that
 *            sessionContext is the only extra key added by the session path.)
 *
 *   GBD-3  cast:plan does NOT contain `explanation` when explain is not set.
 *           (GK asserts plan primitive types but never asserts explanation is
 *            absent when explain is omitted — a regression always including
 *            explanation would pass GK and all prior tests.)
 *
 *   GBD-4  cast:plan WITH explain:true adds exactly `explanation` and no
 *           other new top-level key. Symmetric to GBD-3.
 *
 *   GBD-5  cast:plan does NOT contain `latencyBreakdown`, `score`, `focus`,
 *           `scope`, `suggestions`, `resolvedFromCatalog`, `chainContinuation`,
 *           or `prompts` when not applicable.
 *           (GT-5 confirms latencyBreakdown absent; no prior test asserts all
 *            these conditional keys are absent in the common path.)
 *
 * Source: src-stdio/aggregator.ts line ~1595 (cast:plan body construction).
 *
 * Frozen 2026-09-25.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level cast:plan
 *     key set, not explanation sub-object)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Frozen exact key sets ──────────────────────────────────────────────────────

// Base set: always present in cast:plan with this fixture setup.
// stripe fixture has 3 tools (list_payments, get_balance, create_payment_intent)
// and no backend prompts/resources. alternatives is always included (even if
// empty) in cast:plan — unconditional spread at aggregator line ~1616.
// `resources` is present because listSuggestionResources() prepends the
// suggestions catalog as MCP resources; the finance suggestion entry matches
// 'list stripe payments' with score > 0.1. No `prompts` because the stripe
// fixture has no backend prompts and the suggestions catalog has none.
// No `score` at top level — plan embeds score inside `resolved`.
// No `latencyBreakdown` — cast:plan has latencyMs only (GT-5).
const PLAN_KEYS_BASE: readonly string[] = [
  'alternatives', 'args', 'cast', 'hint', 'intent',
  'latencyMs', 'resolved', 'resolvedBy', 'resources',
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

// Stable intent: 'list stripe payments' → list_payments wins (score 1.3 with
// name bonus); alternatives include get_balance and create_payment_intent.
const INTENT = 'list stripe payments';

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gbd-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
}

/** Cast with confirm:true and return the parsed cast:plan JSON body. */
async function plan(
  agg: Aggregator,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, confirm: true, ...extra });
  assert.equal(result.isError, undefined, 'cast:plan must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥ 1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(body['cast'], 'plan', `expected cast:plan, got cast="${String(body['cast'])}"`);
  return body;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GBD-1: cast:plan base top-level key set is exactly the frozen set (no session, no focus, no explain)', async () => {
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

test('GBD-2: cast:plan WITH sessionId adds exactly sessionContext and no other new key', async () => {
  const agg = makeAgg();
  try {
    // Warm the session with one prior call so sessionContext has callCount > 0.
    const SESSION = 'gbd-test-session-1';
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

test('GBD-3: cast:plan does NOT contain explanation when explain is not set', async () => {
  const agg = makeAgg();
  try {
    const body = await plan(agg);
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'explanation'),
      'explanation must be absent when explain param is not set',
    );
  } finally {
    await agg.shutdown();
  }
});

test('GBD-4: cast:plan WITH explain:true adds exactly explanation and no other new key', async () => {
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

test('GBD-5: cast:plan does NOT contain latencyBreakdown, score, focus, scope, suggestions, resolvedFromCatalog, chainContinuation, or prompts when not applicable', async () => {
  const agg = makeAgg();
  try {
    const body = await plan(agg);
    // latencyBreakdown absent — plan has latencyMs only (GT-5 confirmed)
    // score absent at top level — plan embeds score inside resolved
    // focus absent when no focus profile is active
    // scope absent when no scope param is passed
    // suggestions absent when no focus profile is active
    // resolvedFromCatalog absent when match is not catalog-routed
    // chainContinuation absent when no chain step
    // prompts absent because stripe fixture has no backend prompts
    for (const absent of [
      'latencyBreakdown', 'score', 'focus', 'scope',
      'suggestions', 'resolvedFromCatalog', 'chainContinuation', 'prompts',
    ]) {
      assert.ok(
        !Object.prototype.hasOwnProperty.call(body, absent),
        `"${absent}" must be absent in cast:plan when not applicable`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});
