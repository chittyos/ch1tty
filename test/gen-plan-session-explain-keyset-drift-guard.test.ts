/**
 * GEN drift guard: freeze cast:plan exact top-level key set when sessionId and
 * explain:true are active simultaneously WITHOUT a focus profile or scope.
 *
 * Prior plan exact-keyset coverage for 2-conditional combos involving session:
 *
 *   GBF-4  session only (no focus, no explain, no scope) → base 8 + sessionContext (9 keys).
 *   GCG-1  session + focus (no explain, no scope)        → base 8 + focus + sessionContext (10 keys).
 *   GBO    scope + session (no focus, no explain)        → base 8 + scope + sessionContext (10 keys).
 *   GBO    scope + session + explain (no focus)          → base 8 + scope + sessionContext + explanation (11 keys).
 *
 * Prior plan exact-keyset coverage for 2-conditional combos involving explain:
 *
 *   GBF-3  focus + explain (no session, no scope)        → base 8 + focus + explanation (10 keys).
 *   GBP    scope + explain (no session)                  → base 8 + scope + explanation (10 keys).
 *   GCJ-3  explain only (no session, no scope)           → base 8 + explanation (9 keys).
 *
 * The symmetric gap for session + explain: no test freezes the exact top-level
 * key set when BOTH sessionId AND explain:true are present WITHOUT focus or scope.
 * A regression that:
 *   (a) drops `explanation` when sessionId is active alongside explain:true
 *       (treating them as mutually exclusive in some code path), or
 *   (b) drops `sessionContext` when explain:true is active (treating the two
 *       as competing), or
 *   (c) injects an unexpected key in that combination,
 * would pass GBF-4 (no explain), GCJ-3 (no session), and GBO (no-scope path
 * untested for session+explain) silently.
 *
 * Actual cast:plan body construction (src-stdio/aggregator.ts ~line 1599):
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
 * GEN freezes:
 *
 *   GEN-1  session + explain (no focus, no scope, no catalog) → EXACTLY
 *          {alternatives, args, cast, explanation, hint, intent, latencyMs,
 *           resolved, resolvedBy, sessionContext} — 10 keys.
 *          (GBF-4 base 9 + explanation; GCJ-3 base 9 + sessionContext; confirms
 *           both conditional fields appear together and no third key leaks in.)
 *
 *   GEN-2  explanation is a non-null object in the session + explain combination.
 *          (Type guard — explanation must survive the session code path.)
 *
 *   GEN-3  plan + session WITHOUT explain has NO `explanation` key (absence guard
 *          symmetric to GEN-1: verifies explain:true is required for the field).
 *
 *   GEN-4  plan + explain WITHOUT session has NO `sessionContext` key (absence
 *          guard symmetric to GEN-1: verifies sessionId is required for the field).
 *
 *   GEN-5  sessionContext in the session+explain combination is a non-null object
 *          with EXACTLY {callCount, recentTools} when no focus is set via
 *          setSessionFocus (no activeSessionFocus; symmetric to GCG-5 for the
 *          no-focus path).
 *
 * Fixture: stripe only (list_payments, get_balance, create_payment_intent).
 * No focus profile, no scope: tests the pure session+explain conditional pair.
 * Catalog isolation: suggestionsCatalog:{} prevents catalog-resource injection.
 * Sessions warmed via ch1tty/status before plan calls (builds callCount without
 * tool-call affinity confusion).
 *
 * Frozen 2026-10-01.
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

// Base: cast:plan with empty catalog, no focus, no session, no explain, no scope.
const PLAN_KEYS_BASE: readonly string[] = [
  'alternatives', 'args', 'cast', 'hint', 'intent', 'latencyMs', 'resolved', 'resolvedBy',
];

// GEN-1: session + explain (no focus, no scope, no catalog).
const PLAN_SESSION_EXPLAIN_KEYS: readonly string[] = [
  ...PLAN_KEYS_BASE, 'explanation', 'sessionContext',
];

// sessionContext sub-object keys when no focus is set via setSessionFocus.
const SESSION_CONTEXT_KEYS: readonly string[] = ['callCount', 'recentTools'];

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

const INTENT = 'list stripe payments';

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gen-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator([STRIPE_CONFIG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    suggestionsCatalog: {},
  });
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
    `${label}: exact key set mismatch.\n  expected: ${JSON.stringify(exp)}\n  actual:   ${JSON.stringify(actual)}`,
  );
}

async function warmSession(agg: Aggregator, sessionId: string): Promise<void> {
  await agg.callTool('ch1tty/status', { sessionId });
}

async function castPlan(
  agg: Aggregator,
  extras: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, confirm: true, ...extras });
  assert.equal(result.isError, undefined, 'cast must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥ 1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(
    body['cast'],
    'plan',
    `expected cast:plan, got cast="${String(body['cast'])}"`,
  );
  return body;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GEN-1: cast:plan session+explain (no focus, no scope) → EXACTLY base + sessionContext + explanation (10 keys)', async () => {
  const agg = makeAgg();
  const SID = 'gen-session-1';
  try {
    await warmSession(agg, SID);
    const body = await castPlan(agg, { sessionId: SID, explain: true });
    assertExactKeys(body, PLAN_SESSION_EXPLAIN_KEYS, 'cast:plan session+explain (no focus, no scope)');
  } finally {
    await agg.shutdown();
  }
});

test('GEN-2: explanation is a non-null object in the session+explain combination', async () => {
  const agg = makeAgg();
  const SID = 'gen-session-2';
  try {
    await warmSession(agg, SID);
    const body = await castPlan(agg, { sessionId: SID, explain: true });
    const exp = body['explanation'];
    assert.ok(
      exp !== null && typeof exp === 'object',
      `explanation must be a non-null object; got ${typeof exp} (${JSON.stringify(exp)})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GEN-3: cast:plan session WITHOUT explain has NO explanation key (absence guard)', async () => {
  const agg = makeAgg();
  const SID = 'gen-session-3';
  try {
    await warmSession(agg, SID);
    const body = await castPlan(agg, { sessionId: SID });
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'explanation'),
      'explanation must be absent when explain is not set (session-only path)',
    );
  } finally {
    await agg.shutdown();
  }
});

test('GEN-4: cast:plan explain WITHOUT sessionId has NO sessionContext key (absence guard)', async () => {
  const agg = makeAgg();
  try {
    const body = await castPlan(agg, { explain: true });
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'sessionContext'),
      'sessionContext must be absent when no sessionId is passed (explain-only path)',
    );
  } finally {
    await agg.shutdown();
  }
});

test('GEN-5: sessionContext in session+explain has EXACTLY {callCount, recentTools} (no activeSessionFocus without setSessionFocus)', async () => {
  const agg = makeAgg();
  const SID = 'gen-session-5';
  try {
    await warmSession(agg, SID);
    const body = await castPlan(agg, { sessionId: SID, explain: true });
    const ctx = body['sessionContext'] as Record<string, unknown>;
    assert.ok(ctx !== null && typeof ctx === 'object', 'sessionContext must be a non-null object');
    const ctxKeys = Object.keys(ctx).sort();
    assert.deepEqual(
      ctxKeys,
      [...SESSION_CONTEXT_KEYS].sort(),
      `sessionContext keys must be exactly ${JSON.stringify(SESSION_CONTEXT_KEYS)} ` +
        `when no focus set via setSessionFocus; got ${JSON.stringify(ctxKeys)}`,
    );
    assert.ok(Array.isArray(ctx['recentTools']), 'sessionContext.recentTools must be an array');
    assert.equal(typeof ctx['callCount'], 'number', 'sessionContext.callCount must be a number');
    assert.ok(
      !Object.prototype.hasOwnProperty.call(ctx, 'activeSessionFocus'),
      'activeSessionFocus must be absent when focus is not set via setSessionFocus',
    );
  } finally {
    await agg.shutdown();
  }
});
