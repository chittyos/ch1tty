/**
 * GEP drift guard: freeze cast:plan exact top-level key set when scope is
 * active WITHOUT focus — four combinations (scope, scope+session,
 * scope+explain, scope+session+explain maximal).
 *
 * Prior cast:plan exact-keyset coverage:
 *   GCJ   : base set — {alternatives, args, cast, hint, intent, latencyMs,
 *            resolved, resolvedBy}  (8 keys; no scope, no focus, no session)
 *   GCA   : + focus active            (9 keys: base + focus)
 *   GCG   : + session + focus         (10 keys: base + focus + sessionContext)
 *   GEG   : + focus + explain         (10 keys: base + focus + explanation)
 *   GEH   : + focus + explain + catalog
 *   GEJ   : + scope + focus + explain (maximal 4-way, all four active)
 *   GEN   : + session + explain       (open PR — no scope, no focus)
 *
 * Gap: no test freezes the exact key set for cast:plan when scope is provided
 * WITHOUT focus active. GEJ covers scope∧focus∧explain; but scope∧¬focus is
 * structurally independent — a regression that:
 *   (a) drops `scope` from the plan body when focus is absent, or
 *   (b) injects a phantom key (e.g. `focusScope`) only when scope is set
 *       without a focus profile,
 * would pass GCA (focus, no scope) and GEJ (scope+focus+explain) silently.
 *
 * Actual cast:plan body (aggregator.ts ~line 1599):
 *   { cast: 'plan', resolvedBy, intent, latencyMs,
 *     ...(focusName ? { focus } : {}),
 *     ...(scopeAnnot ? { scope } : {}),
 *     ...(explanation ? { explanation } : {}),
 *     resolved: { tool, server, category, description, score, inputSchema },
 *     ...(catalogCombo ? { resolvedFromCatalog } : {}),
 *     ...(chainContinuation ? { chainContinuation } : {}),
 *     alternatives, ...related,
 *     ...(planSessionContext ? { sessionContext } : {}),
 *     ...(focusSuggestions ? { suggestions } : {}),
 *     args, hint,
 *   }
 *
 * Probed 2026-10-01:
 *   scope(servers), no session, no explain  → 9 keys  (base + scope)
 *   scope + session                          → 10 keys (base + scope + sessionContext)
 *   scope + explain                          → 10 keys (base + scope + explanation)
 *   scope + session + explain (maximal)      → 11 keys (base + scope + explanation + sessionContext)
 *
 * GEP freezes:
 *
 *   GEP-1  scope only (no session, no explain) → EXACTLY 9 keys
 *          {alternatives, args, cast, hint, intent, latencyMs, resolved,
 *           resolvedBy, scope}
 *
 *   GEP-2  scope + session → EXACTLY 10 keys (GEP-1 + sessionContext)
 *
 *   GEP-3  scope + explain → EXACTLY 10 keys (GEP-1 + explanation)
 *
 *   GEP-4  scope + session + explain (maximal, no focus) → EXACTLY 11 keys
 *          (GEP-1 + explanation + sessionContext)
 *
 *   GEP-5  absence guard — `scope` ABSENT when scope param not provided.
 *          Guards against a regression that always injects scope regardless
 *          of whether it was passed (symmetric with GCJ-1 base).
 *
 * Fixture: stripe only; focus NOT set (neither constructor nor per-call param).
 * Intent: "list stripe payments" → stripe/list_payments.
 * Catalog isolation: suggestionsCatalog:{} prevents catalog path injection.
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

// GEP-1: scope only (no focus, no session, no explain)
const PLAN_SCOPE_BASE: readonly string[] = [
  'alternatives', 'args', 'cast', 'hint', 'intent', 'latencyMs', 'resolved', 'resolvedBy', 'scope',
];

// GEP-2: scope + session
const PLAN_SCOPE_SESSION: readonly string[] = [
  ...PLAN_SCOPE_BASE, 'sessionContext',
];

// GEP-3: scope + explain
const PLAN_SCOPE_EXPLAIN: readonly string[] = [
  ...PLAN_SCOPE_BASE, 'explanation',
];

// GEP-4: scope + session + explain (maximal, no focus)
const PLAN_SCOPE_SESSION_EXPLAIN: readonly string[] = [
  ...PLAN_SCOPE_BASE, 'explanation', 'sessionContext',
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

const INTENT = 'list stripe payments';

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gep-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  // No focus set — GEP is the no-focus scope path.
  return new Aggregator([STRIPE_CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    suggestionsCatalog: {},
  });
}

// ── Shared helpers ────────────────────────────────────────────────────────────

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

async function castPlan(
  agg: Aggregator,
  extras: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', {
    intent: INTENT,
    confirm: true,
    ...extras,
  });
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

// ── GEP-1: scope only ─────────────────────────────────────────────────────────

test('GEP-1: cast:plan + scope (no focus, no session, no explain) → EXACTLY {alternatives,args,cast,hint,intent,latencyMs,resolved,resolvedBy,scope}', async () => {
  const agg = makeAgg();
  try {
    const body = await castPlan(agg, { scope: { servers: ['stripe'] } });
    assertExactKeys(body, PLAN_SCOPE_BASE, 'GEP-1 plan+scope (no focus, no session, no explain)');
    assert.equal(typeof body['scope'], 'object', 'GEP-1: scope must be an object');
    assert.notEqual(body['scope'], null, 'GEP-1: scope must not be null');
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'focus'),
      false,
      'GEP-1: focus must be absent when no focus profile is active',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEP-2: scope + session ────────────────────────────────────────────────────

test('GEP-2: cast:plan + scope + session (no focus, no explain) → EXACTLY GEP-1 + sessionContext', async () => {
  const agg = makeAgg();
  try {
    const body = await castPlan(agg, { scope: { servers: ['stripe'] }, sessionId: 'gep-session-2' });
    assertExactKeys(body, PLAN_SCOPE_SESSION, 'GEP-2 plan+scope+session (no focus, no explain)');
    assert.equal(typeof body['scope'], 'object', 'GEP-2: scope must be an object');
    assert.notEqual(body['scope'], null, 'GEP-2: scope must not be null');
    assert.equal(typeof body['sessionContext'], 'object', 'GEP-2: sessionContext must be an object');
    assert.notEqual(body['sessionContext'], null, 'GEP-2: sessionContext must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GEP-3: scope + explain ────────────────────────────────────────────────────

test('GEP-3: cast:plan + scope + explain (no focus, no session) → EXACTLY GEP-1 + explanation', async () => {
  const agg = makeAgg();
  try {
    const body = await castPlan(agg, { scope: { servers: ['stripe'] }, explain: true });
    assertExactKeys(body, PLAN_SCOPE_EXPLAIN, 'GEP-3 plan+scope+explain (no focus, no session)');
    assert.equal(typeof body['scope'], 'object', 'GEP-3: scope must be an object');
    assert.notEqual(body['scope'], null, 'GEP-3: scope must not be null');
    assert.equal(typeof body['explanation'], 'object', 'GEP-3: explanation must be an object');
    assert.notEqual(body['explanation'], null, 'GEP-3: explanation must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GEP-4: scope + session + explain (maximal, no focus) ─────────────────────

test('GEP-4: cast:plan + scope + session + explain (no focus, maximal) → EXACTLY GEP-1 + explanation + sessionContext', async () => {
  const agg = makeAgg();
  try {
    const body = await castPlan(agg, {
      scope: { servers: ['stripe'] },
      sessionId: 'gep-session-4',
      explain: true,
    });
    assertExactKeys(body, PLAN_SCOPE_SESSION_EXPLAIN, 'GEP-4 plan+scope+session+explain (no focus, maximal)');
    assert.equal(typeof body['scope'], 'object', 'GEP-4: scope must be an object');
    assert.notEqual(body['scope'], null, 'GEP-4: scope must not be null');
    assert.equal(typeof body['explanation'], 'object', 'GEP-4: explanation must be an object');
    assert.notEqual(body['explanation'], null, 'GEP-4: explanation must not be null');
    assert.equal(typeof body['sessionContext'], 'object', 'GEP-4: sessionContext must be an object');
    assert.notEqual(body['sessionContext'], null, 'GEP-4: sessionContext must not be null');
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'focus'),
      false,
      'GEP-4: focus must be absent when no focus profile is active',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEP-5: absence guard — scope ABSENT when not provided ────────────────────

test('GEP-5: cast:plan WITHOUT scope → scope key ABSENT', async () => {
  const agg = makeAgg();
  try {
    const body = await castPlan(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'scope'),
      false,
      `GEP-5: scope must be absent when scope param is not provided; got keys: ${JSON.stringify(Object.keys(body))}`,
    );
  } finally {
    await agg.shutdown();
  }
});
