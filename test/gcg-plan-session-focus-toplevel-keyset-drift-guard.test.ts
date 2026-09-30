/**
 * GCG drift guard: freeze cast:plan exact top-level key set when BOTH
 * a session AND a focus profile are active.
 *
 * GCA froze the exact key set of cast:plan when focus is active (no session).
 * GCF froze the exact key set of cast:executed when session+focus are both
 * active. The symmetric gap for cast:plan: no test freezes the EXACT top-level
 * key set when BOTH a session is active AND a focus profile is in effect.
 *
 * A regression adding an extra annotation (e.g. `sessionFocus`) or silently
 * dropping `focus` when a session is present would pass GCA undetected.
 *
 * Source: src-stdio/aggregator.ts cast:plan body (confirm:true path):
 *   ...(focusName ? { focus: focusName } : {})
 *   ...(planSessionContext ? { sessionContext: planSessionContext } : {})
 *   ...(focusSuggestions ? { suggestions: focusSuggestions } : {})
 *
 * GCG-1  session + focus active, no catalog → GCA-1 base + sessionContext.
 *         Set: {alternatives, args, cast, focus, hint, intent, latencyMs,
 *               resolved, resolvedBy, sessionContext}
 *         (GCA-1 froze the no-session focus set; this freezes the session
 *          addition — exactly one new key.)
 *
 * GCG-2  session + focus active WITH catalog → GCA-2 set + sessionContext.
 *         Set: {alternatives, args, cast, chainContinuation, focus, hint,
 *               intent, latencyMs, resolved, resolvedBy, resolvedFromCatalog,
 *               resources, sessionContext, suggestions}
 *         (Verifies session and catalog paths compose without unexpected keys.)
 *
 * GCG-3  session + focus + scope (no catalog) → GCG-1 set + scope.
 *         Set: {alternatives, args, cast, focus, hint, intent, latencyMs,
 *               resolved, resolvedBy, scope, sessionContext}
 *
 * GCG-4  session + focus + explain (no catalog) → GCG-1 set + explanation.
 *         Set: {alternatives, args, cast, explanation, focus, hint, intent,
 *               latencyMs, resolved, resolvedBy, sessionContext}
 *
 * GCG-5  `sessionContext` sub-object when session+focus active has exactly
 *         {recentTools, callCount} — no `activeSessionFocus` when focus is
 *         injected via the Aggregator constructor (not via setSessionFocus).
 *
 * Session isolation: sessions are warmed via ch1tty/status to build coordinator
 * context without building tool affinity. Catalog is injected inline.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level cast key
 *     set, not explanation sub-object)
 *
 * Frozen 2026-09-26.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Frozen exact key sets ─────────────────────────────────────────────────────

// GCG-1: session + focus, no catalog. GCA-1 base + sessionContext.
const PLAN_FOCUS_SESSION: readonly string[] = [
  'alternatives', 'args', 'cast', 'focus', 'hint', 'intent',
  'latencyMs', 'resolved', 'resolvedBy', 'sessionContext',
];

// GCG-2: session + focus + catalog. GCA-2 keys + sessionContext.
const PLAN_FOCUS_SESSION_CATALOG: readonly string[] = [
  'alternatives', 'args', 'cast', 'chainContinuation', 'focus', 'hint',
  'intent', 'latencyMs', 'resolved', 'resolvedBy', 'resolvedFromCatalog',
  'resources', 'sessionContext', 'suggestions',
];

// GCG-3: session + focus + scope. GCG-1 + scope.
const PLAN_FOCUS_SESSION_SCOPE: readonly string[] = [
  ...PLAN_FOCUS_SESSION, 'scope',
];

// GCG-4: session + focus + explain. GCG-1 + explanation.
const PLAN_FOCUS_SESSION_EXPLAIN: readonly string[] = [
  ...PLAN_FOCUS_SESSION, 'explanation',
];

// sessionContext sub-object keys when focus is from constructor (not setSessionFocus).
const SESSION_CONTEXT_KEYS: readonly string[] = ['callCount', 'recentTools'];

// ── Config fixtures ───────────────────────────────────────────────────────────

const STRIPE_CONFIG: ServerConfig = {
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
    payments: { categories: ['ecosystem'], servers: [], boost: 0.5 },
  },
};

const SUGGESTIONS_CATALOG = {
  payments: {
    description: 'Payments-focused workflows',
    combos: [
      {
        name: 'List and balance',
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
  return join(tmpdir(), `ch1tty-gcg-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(opts: { withCatalog: boolean }): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator([STRIPE_CONFIG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    focus: 'payments',
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: opts.withCatalog ? SUGGESTIONS_CATALOG : {},
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

test('GCG-1: cast:plan with session+focus active (no catalog) has exactly base+focus+sessionContext', async () => {
  const agg = makeAgg({ withCatalog: false });
  const sessionId = 'gcg-session-1';
  try {
    await warmSession(agg, sessionId);
    const body = await castPlan(agg, { sessionId });
    assertExactKeys(body, PLAN_FOCUS_SESSION, 'cast:plan session+focus (no catalog)');
    assert.equal(body['focus'], 'payments', 'focus value must equal active profile name');
    assert.equal(typeof body['sessionContext'], 'object', 'sessionContext must be an object');
    assert.notEqual(body['sessionContext'], null, 'sessionContext must not be null');
  } finally {
    await agg.shutdown();
  }
});

test('GCG-2: cast:plan with session+focus+catalog has exactly GCA-2 set + sessionContext', async () => {
  const agg = makeAgg({ withCatalog: true });
  const sessionId = 'gcg-session-2';
  try {
    await warmSession(agg, sessionId);
    const body = await castPlan(agg, { sessionId });
    assertExactKeys(body, PLAN_FOCUS_SESSION_CATALOG, 'cast:plan session+focus+catalog');
    assert.equal(body['focus'], 'payments', 'focus value must equal active profile name');
    assert.equal(typeof body['sessionContext'], 'object', 'sessionContext must be an object');
    assert.equal(typeof body['suggestions'], 'object', 'suggestions must be an object');
    const suggestions = body['suggestions'] as Record<string, unknown>;
    assert.ok(Array.isArray(suggestions['combos']), 'suggestions.combos must be an array');
    assert.ok(Array.isArray(suggestions['prompts']), 'suggestions.prompts must be an array');
  } finally {
    await agg.shutdown();
  }
});

test('GCG-3: cast:plan with session+focus+scope (no catalog) has exactly base+focus+sessionContext+scope', async () => {
  const agg = makeAgg({ withCatalog: false });
  const sessionId = 'gcg-session-3';
  try {
    await warmSession(agg, sessionId);
    const body = await castPlan(agg, {
      sessionId,
      scope: { servers: ['stripe'] },
    });
    assertExactKeys(body, PLAN_FOCUS_SESSION_SCOPE, 'cast:plan session+focus+scope');
    assert.equal(body['focus'], 'payments', 'focus value must equal active profile name');
    assert.equal(typeof body['scope'], 'object', 'scope must be an object');
    assert.notEqual(body['scope'], null, 'scope must not be null');
  } finally {
    await agg.shutdown();
  }
});

test('GCG-4: cast:plan with session+focus+explain (no catalog) has exactly base+focus+sessionContext+explanation', async () => {
  const agg = makeAgg({ withCatalog: false });
  const sessionId = 'gcg-session-4';
  try {
    await warmSession(agg, sessionId);
    const body = await castPlan(agg, { sessionId, explain: true });
    assertExactKeys(body, PLAN_FOCUS_SESSION_EXPLAIN, 'cast:plan session+focus+explain');
    assert.equal(body['focus'], 'payments', 'focus value must equal active profile name');
    assert.equal(typeof body['explanation'], 'object', 'explanation must be an object');
    assert.notEqual(body['explanation'], null, 'explanation must not be null');
  } finally {
    await agg.shutdown();
  }
});

test('GCG-5: cast:plan sessionContext has exactly {recentTools, callCount} when focus is from constructor', async () => {
  const agg = makeAgg({ withCatalog: false });
  const sessionId = 'gcg-session-5';
  try {
    await warmSession(agg, sessionId);
    const body = await castPlan(agg, { sessionId });
    const ctx = body['sessionContext'] as Record<string, unknown>;
    assert.ok(ctx !== null && typeof ctx === 'object', 'sessionContext must be an object');
    const ctxKeys = Object.keys(ctx).sort();
    assert.deepEqual(
      ctxKeys,
      [...SESSION_CONTEXT_KEYS].sort(),
      `sessionContext keys must be exactly ${JSON.stringify(SESSION_CONTEXT_KEYS)} ` +
        `when focus is from constructor (no activeSessionFocus); got ${JSON.stringify(ctxKeys)}`,
    );
    assert.ok(Array.isArray(ctx['recentTools']), 'sessionContext.recentTools must be an array');
    assert.equal(typeof ctx['callCount'], 'number', 'sessionContext.callCount must be a number');
    assert.equal(
      Object.prototype.hasOwnProperty.call(ctx, 'activeSessionFocus'),
      false,
      'activeSessionFocus must be absent when focus is set via constructor, not setSessionFocus',
    );
  } finally {
    await agg.shutdown();
  }
});
