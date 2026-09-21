/**
 * GV drift guard: freeze cast:executed exact top-level key set.
 *
 * Prior tests cover cast:executed FIELD VALUE TYPES (GJ, GK, GR) and
 * cast:executed's latencyBreakdown SUB-KEY SET (GT), but NO test freezes
 * the exact set of ALLOWED keys at the top level of the cast:executed response
 * body. A regression adding or renaming a top-level field (e.g. accidentally
 * promoting a sub-field to the root, or leaking an internal annotation key)
 * would pass every existing test silently.
 *
 * Complementing GU (which froze exact top-level key sets for cast:no_match and
 * cast:resolved), GV freezes the exact top-level key sets for cast:executed —
 * the highest-traffic cast mode.
 *
 * Actual shapes (keyword route, stripe-only fixture, probed 2026-09-21):
 *
 *   cast:executed (no session, no focus, no explain, 3-tool registry)
 *     → {cast, resolvedBy, intent, latencyMs, latencyBreakdown,
 *        resolved, score, alternatives, resources}
 *     NOTE: `resources` appears because listSuggestionResources() (aggregator
 *     line ~1887) always includes the suggestions catalog as MCP resources;
 *     the finance/payments-themed suggestion entries score > 0.1 against
 *     intent 'list stripe payments'.
 *
 *   cast:executed (with sessionId, no focus, no explain)
 *     → above set PLUS sessionContext
 *
 *   cast:executed (no session, no focus, explain:true)
 *     → base set PLUS explanation
 *
 * GV freezes:
 *
 *   GV-1  cast:executed without session, without focus, without explain has
 *          EXACTLY {cast, resolvedBy, intent, latencyMs, latencyBreakdown,
 *          resolved, score, alternatives}.
 *          (GT froze latencyBreakdown sub-keys; no prior test froze the outer
 *           top-level key set; a regression adding e.g. "context" or "brainPath"
 *           at the top level would pass all prior tests silently.)
 *
 *   GV-2  cast:executed WITH sessionId has EXACTLY the GV-1 set PLUS
 *          sessionContext — no other key is added.
 *          (GR froze sessionContext VALUE TYPES; no test freezes that
 *           sessionContext is the only extra key added by the session path.)
 *
 *   GV-3  cast:executed does NOT contain `explanation` when explain is not set.
 *          (GJ asserts explanation is present on an explain:true call but never
 *           asserts its ABSENCE when explain is omitted — a regression that
 *           always includes explanation would pass GJ and all prior tests.)
 *
 *   GV-4  cast:executed WITH explain:true adds exactly `explanation` and no
 *          other new top-level key. Symmetric to GV-3.
 *
 *   GV-5  cast:executed does NOT contain `focus`, `scope`, `suggestions`, or
 *          `resolvedFromCatalog` when no focus profile is active, no scope
 *          param is passed, and the match is not catalog-routed.
 *          (No prior test asserts these conditional keys are ABSENT in the
 *           common non-focus, non-scope, non-catalog execution path.)
 *
 * Source: src-stdio/aggregator.ts line ~1648 (cast:executed body construction).
 *
 * Frozen 2026-09-21.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level cast:executed
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

// Base set: always present in cast:executed with this fixture setup.
// stripe fixture has 3 tools (list_payments, get_balance, create_payment_intent)
// and no backend prompts/resources. alternatives = scoredTools.slice(1,4) with
// 3 scoredTools → length 2 > 0 → alternatives key present. `resources` is present
// because listSuggestionResources() prepends the suggestions catalog as MCP
// resources (aggregator line ~1887); the finance/billing suggestion entries match
// intent 'list stripe payments' with score > 0.1. No `prompts` because listAllPrompts
// only includes backend prompts and stripe fixture has none.
const EXECUTED_KEYS_BASE: readonly string[] = [
  'cast', 'resolvedBy', 'intent', 'latencyMs', 'latencyBreakdown',
  'resolved', 'score', 'alternatives', 'resources',
];

const EXECUTED_KEYS_WITH_SESSION: readonly string[] = [
  ...EXECUTED_KEYS_BASE, 'sessionContext',
];

const EXECUTED_KEYS_WITH_EXPLAIN: readonly string[] = [
  ...EXECUTED_KEYS_BASE, 'explanation',
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

// Stable intent: 'list stripe payments' matches all 3 stripe tools above
// the 0.1 threshold; list_payments wins; get_balance and create_payment_intent
// appear in alternatives. No prompts → no `prompts` key in related.
const INTENT = 'list stripe payments';

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gv-${Date.now()}-${++_seq}.jsonl`);
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

/** Cast without confirm and return the parsed cast:executed JSON body. */
async function executed(
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

test('GV-1: cast:executed base top-level key set is exactly the frozen set (no session, no focus, no explain)', async () => {
  const agg = makeAgg();
  const body = await executed(agg);
  const actual = Object.keys(body).sort();
  const expected = [...EXECUTED_KEYS_BASE].sort();
  assert.deepEqual(
    actual,
    expected,
    `cast:executed top-level keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
});

test('GV-2: cast:executed WITH sessionId adds exactly sessionContext and no other new key', async () => {
  const agg = makeAgg();
  // Warm the session with one prior call so sessionContext has callCount > 0.
  const SESSION = 'gv-test-session-1';
  await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SESSION });
  const body = await executed(agg, { sessionId: SESSION });
  const actual = Object.keys(body).sort();
  const expected = [...EXECUTED_KEYS_WITH_SESSION].sort();
  assert.deepEqual(
    actual,
    expected,
    `cast:executed+sessionId top-level keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
});

test('GV-3: cast:executed does NOT contain explanation when explain is not set', async () => {
  const agg = makeAgg();
  const body = await executed(agg);
  assert.ok(
    !Object.prototype.hasOwnProperty.call(body, 'explanation'),
    'explanation must be absent when explain param is not set',
  );
});

test('GV-4: cast:executed WITH explain:true adds exactly explanation and no other new key', async () => {
  const agg = makeAgg();
  const body = await executed(agg, { explain: true });
  const actual = Object.keys(body).sort();
  const expected = [...EXECUTED_KEYS_WITH_EXPLAIN].sort();
  assert.deepEqual(
    actual,
    expected,
    `cast:executed+explain top-level keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
});

test('GV-5: cast:executed does NOT contain focus, scope, suggestions, resolvedFromCatalog, or prompts when not applicable', async () => {
  const agg = makeAgg();
  const body = await executed(agg);
  // focus is absent when no focus profile is active (no CH1TTY_FOCUS env, no focus param)
  // scope is absent when no scope param is passed
  // suggestions is absent when no focus profile is active
  // resolvedFromCatalog is absent when match is not catalog-routed
  // prompts is absent because stripe fixture has no backend prompts
  for (const absent of ['focus', 'scope', 'suggestions', 'resolvedFromCatalog', 'prompts']) {
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, absent),
      `"${absent}" must be absent in cast:executed when not applicable`,
    );
  }
});
