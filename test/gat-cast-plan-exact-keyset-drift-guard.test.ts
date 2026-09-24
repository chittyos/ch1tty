/**
 * GAT drift guard: freeze cast:plan exact top-level key set.
 *
 * GK froze cast:plan VALUE TYPES (resolvedBy enum, latencyMs finitude, intent echo).
 * GS froze cast:plan sessionContext VALUE TYPES.
 * GU froze exact top-level key sets for cast:no_match and cast:resolved.
 * GV froze exact top-level key sets for cast:executed.
 * GAS froze alternatives item exact key set in cast:plan and cast:executed.
 *
 * No prior test on main freezes the exact top-level key set for cast:plan
 * (confirm:true). A regression adding, renaming, or conditionally-promoting a
 * field to the plan root (e.g. accidentally injecting a cast:executed-only field
 * like latencyBreakdown or score at the plan level, or leaking an internal
 * annotation key) would pass all prior tests silently.
 *
 * Actual shapes (keyword route, stripe-only fixture):
 *
 *   cast:plan (no session, no focus, no explain, 3-tool registry)
 *     → {alternatives, args, cast, hint, intent, latencyMs, resolved,
 *        resolvedBy, resources}
 *     NOTE: `resources` appears because listSuggestionResources() always
 *     includes the suggestions catalog; finance/billing entries score > 0.1
 *     against intent 'list stripe payments'.
 *     NOTE: `alternatives` is always present in cast:plan (not conditionally
 *     spread as in cast:executed); with 3 stripe tools, slice(1,4) gives 2 items.
 *     NOTE: `args` always included in cast:plan (toolArgs extracted from intent).
 *     NOTE: `hint` always included as the 'call cast again without confirm' prompt.
 *
 *   cast:plan (with sessionId) → above set PLUS sessionContext
 *
 *   cast:plan (with explain:true) → base set PLUS explanation
 *
 * Invariants frozen by GAT:
 *
 *   GAT-1  cast:plan without session, without focus, without explain has
 *          EXACTLY {alternatives, args, cast, hint, intent, latencyMs, resolved,
 *          resolvedBy, resources} — the 9-key base set.
 *          (GK/GS froze value types; no test on main froze the exact key set;
 *           a regression adding e.g. latencyBreakdown or score at the plan
 *           root would pass all prior tests silently.)
 *
 *   GAT-2  cast:plan WITH sessionId adds exactly sessionContext and no other
 *          new key. (GS froze sessionContext VALUE TYPES in cast:plan; no test
 *          froze that sessionContext is the only extra key added by the session
 *          path.)
 *
 *   GAT-3  cast:plan does NOT contain explanation when explain is not set.
 *          (No test on main asserts explanation's ABSENCE in cast:plan.)
 *
 *   GAT-4  cast:plan WITH explain:true adds exactly explanation and no other new
 *          key. Symmetric to GAT-3.
 *
 *   GAT-5  cast:plan does NOT contain focus, scope, suggestions,
 *          resolvedFromCatalog, chainContinuation, or prompts when not applicable
 *          (no focus active, no scope param, no catalog match, no chain,
 *          stripe fixture has no backend prompts).
 *
 * Source: src-stdio/aggregator.ts line ~1595 (cast:plan body construction).
 *
 * Frozen 2026-09-24.
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

const INTENT = 'list stripe payments';

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gat-${Date.now()}-${++_seq}.jsonl`);
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

test('GAT-1: cast:plan base top-level key set is exactly the frozen set (no session, no focus, no explain)', async () => {
  const agg = makeAgg();
  const body = await plan(agg);
  assertExactKeys(body, PLAN_KEYS_BASE, 'GAT-1');
});

test('GAT-2: cast:plan WITH sessionId adds exactly sessionContext and no other new key', async () => {
  const agg = makeAgg();
  const SESSION = 'gat-test-session-1';
  await agg.callTool('ch1tty/cast', { intent: INTENT, confirm: true, sessionId: SESSION });
  const body = await plan(agg, { sessionId: SESSION });
  assertExactKeys(body, PLAN_KEYS_WITH_SESSION, 'GAT-2');
});

test('GAT-3: cast:plan does NOT contain explanation when explain is not set', async () => {
  const agg = makeAgg();
  const body = await plan(agg);
  assert.ok(
    !Object.prototype.hasOwnProperty.call(body, 'explanation'),
    'explanation must be absent in cast:plan when explain param is not set',
  );
});

test('GAT-4: cast:plan WITH explain:true adds exactly explanation and no other new key', async () => {
  const agg = makeAgg();
  const body = await plan(agg, { explain: true });
  assertExactKeys(body, PLAN_KEYS_WITH_EXPLAIN, 'GAT-4');
});

test('GAT-5: cast:plan does NOT contain focus, scope, suggestions, resolvedFromCatalog, chainContinuation, or prompts when not applicable', async () => {
  const agg = makeAgg();
  const body = await plan(agg);
  for (const absent of ['focus', 'scope', 'suggestions', 'resolvedFromCatalog', 'chainContinuation', 'prompts']) {
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, absent),
      `"${absent}" must be absent in cast:plan when not applicable`,
    );
  }
});
