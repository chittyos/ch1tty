/**
 * GW drift guard: freeze cast:plan exact top-level key set.
 *
 * GK froze cast:plan VALUE TYPES (resolvedBy enum, latencyMs finitude, intent echo).
 * GS froze cast:plan sessionContext VALUE TYPES.
 * GU froze exact top-level key sets for cast:no_match and cast:resolved.
 * GV froze exact top-level key sets for cast:executed.
 *
 * No prior test freezes the exact top-level key set for cast:plan (confirm:true).
 * A regression adding, renaming, or conditionally-promoting a field to the plan
 * root (e.g. accidentally injecting a cast:executed-only field like latencyBreakdown
 * or score at the plan level) would pass all prior tests silently.
 *
 * Actual shapes (keyword route, stripe-only fixture, probed 2026-09-21):
 *
 *   cast:plan (no session, no focus, no explain, 3-tool registry)
 *     → {cast, resolvedBy, intent, latencyMs, resolved, alternatives,
 *        resources, args, hint}
 *     NOTE: `resources` appears because listSuggestionResources() always
 *     includes the suggestions catalog; finance/billing entries score > 0.1
 *     against intent 'list stripe payments'.
 *     NOTE: `alternatives` is always present in cast:plan (not conditionally
 *     spread as in cast:executed); with 3 stripe tools, slice(1,4) gives 2 items.
 *
 *   cast:plan (with sessionId) → above set PLUS sessionContext
 *
 *   cast:plan (with explain:true) → base set PLUS explanation
 *
 * GW freezes:
 *
 *   GW-1  cast:plan without session, without focus, without explain has
 *          EXACTLY {cast, resolvedBy, intent, latencyMs, resolved, alternatives,
 *          resources, args, hint}.
 *          (GK/GS froze value types; no test froze the exact key set;
 *           a regression adding e.g. latencyBreakdown or score at the plan
 *           root would pass all prior tests silently.)
 *
 *   GW-2  cast:plan WITH sessionId adds exactly sessionContext and no other new key.
 *          (GS froze sessionContext VALUE TYPES in cast:plan; no test froze that
 *           sessionContext is the only extra key added by the session path.)
 *
 *   GW-3  cast:plan does NOT contain `explanation` when explain is not set.
 *          (No prior test asserts explanation's ABSENCE in cast:plan.)
 *
 *   GW-4  cast:plan WITH explain:true adds exactly `explanation` and no other new key.
 *          Symmetric to GW-3.
 *
 *   GW-5  cast:plan does NOT contain `focus`, `scope`, `suggestions`,
 *          `resolvedFromCatalog`, `chainContinuation`, or `prompts` when not
 *          applicable (no focus active, no scope param, no catalog match, no chain,
 *          stripe fixture has no backend prompts).
 *
 * Source: src-stdio/aggregator.ts line ~1595 (cast:plan body construction).
 *
 * Frozen 2026-09-21.
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

// Base set: always present in cast:plan with this fixture.
// stripe fixture has 3 tools; alternatives = scoredTools.slice(1,4) = 2 items.
// `resources` present because listSuggestionResources() always includes the
// suggestions catalog; finance/billing suggestions score > 0.1 on this intent.
// `args` always present in cast:plan (toolArgs extracted from intent).
// `hint` always present ('Call cast again without confirm to execute…').
const PLAN_KEYS_BASE: readonly string[] = [
  'alternatives', 'args', 'cast', 'hint', 'intent', 'latencyMs', 'resolved', 'resolvedBy', 'resources',
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

// Stable intent: 'list stripe payments' resolves list_payments via keyword route.
const INTENT = 'list stripe payments';

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gw-${Date.now()}-${++_seq}.jsonl`);
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

/** Call cast with confirm:true and return the parsed cast:plan JSON body. */
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

/** Exact key-set assertion: sorted actual keys must deep-equal sorted expected keys. */
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

test('GW-1: cast:plan base top-level key set is exactly the frozen set (no session, no focus, no explain)', async () => {
  const agg = makeAgg();
  const body = await plan(agg);
  assertExactKeys(body, PLAN_KEYS_BASE, 'GW-1');
});

test('GW-2: cast:plan WITH sessionId adds exactly sessionContext and no other new key', async () => {
  const agg = makeAgg();
  // Warm the session with one prior call so sessionContext has callCount > 0.
  const SESSION = 'gw-test-session-1';
  await agg.callTool('ch1tty/cast', { intent: INTENT, confirm: true, sessionId: SESSION });
  const body = await plan(agg, { sessionId: SESSION });
  assertExactKeys(body, PLAN_KEYS_WITH_SESSION, 'GW-2');
});

test('GW-3: cast:plan does NOT contain explanation when explain is not set', async () => {
  const agg = makeAgg();
  const body = await plan(agg);
  assert.ok(
    !Object.prototype.hasOwnProperty.call(body, 'explanation'),
    'explanation must be absent in cast:plan when explain param is not set',
  );
});

test('GW-4: cast:plan WITH explain:true adds exactly explanation and no other new key', async () => {
  const agg = makeAgg();
  const body = await plan(agg, { explain: true });
  assertExactKeys(body, PLAN_KEYS_WITH_EXPLAIN, 'GW-4');
});

test('GW-5: cast:plan does NOT contain focus, scope, suggestions, resolvedFromCatalog, chainContinuation, or prompts when not applicable', async () => {
  const agg = makeAgg();
  const body = await plan(agg);
  // focus absent: no CH1TTY_FOCUS env, no focus param
  // scope absent: no scope param
  // suggestions absent: no focus profile active (no focusSuggestions)
  // resolvedFromCatalog absent: match is not catalog-routed
  // chainContinuation absent: no active chain
  // prompts absent: stripe fixture has no backend prompts
  for (const absent of ['focus', 'scope', 'suggestions', 'resolvedFromCatalog', 'chainContinuation', 'prompts']) {
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, absent),
      `"${absent}" must be absent in cast:plan when not applicable`,
    );
  }
});
