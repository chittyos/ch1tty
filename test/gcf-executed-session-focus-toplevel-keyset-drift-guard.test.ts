/**
 * GCF drift guard: freeze cast:executed exact top-level key set when BOTH
 * a session AND a focus profile are active.
 *
 * GV-1 froze the base key set (no session, no focus).
 * GV-2 froze base + sessionContext (session active, no focus).
 * GBZ-1 froze executed + focus active, no session, no catalog.
 * GBZ-2 froze executed + focus + catalog (no session).
 *
 * The gap: no test freezes the EXACT top-level key set of cast:executed when
 * BOTH a session is active AND a focus profile is in effect. A regression
 * adding an extra annotation (e.g. `sessionFocus`) or silently dropping `focus`
 * when a session is present would pass GV-2 and GBZ-1 undetected.
 *
 * Source: src-stdio/aggregator.ts lines ~1648–1672 (cast:executed body):
 *   ...(focusName ? { focus: focusName } : {})
 *   ...(castSessionContext ? { sessionContext: castSessionContext } : {})
 *
 * GCF-1  session + focus active, no catalog → base + focus + sessionContext.
 *         Set: {alternatives, cast, focus, intent, latencyBreakdown, latencyMs,
 *               resolved, resolvedBy, score, sessionContext}
 *         (GBZ-1 base + sessionContext; no resources because catalog is empty.)
 *
 * GCF-2  session + focus active WITH catalog → GBZ-2 set + sessionContext.
 *         Set: {alternatives, cast, chainContinuation, focus, intent,
 *               latencyBreakdown, latencyMs, resolved, resolvedBy,
 *               resolvedFromCatalog, resources, score, sessionContext, suggestions}
 *         (Verifies session and catalog paths compose without unexpected keys.)
 *
 * GCF-3  session + focus + scope (no catalog) → GCF-1 set + scope.
 *         Set: {alternatives, cast, focus, intent, latencyBreakdown, latencyMs,
 *               resolved, resolvedBy, scope, score, sessionContext}
 *
 * GCF-4  session + focus + explain (no catalog) → GCF-1 set + explanation.
 *         Set: {alternatives, cast, explanation, focus, intent, latencyBreakdown,
 *               latencyMs, resolved, resolvedBy, score, sessionContext}
 *
 * GCF-5  `sessionContext` sub-object when session+focus active has exactly
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

// ── Frozen exact key sets ──────────────────────────────────────────────────────

// GBZ-1 base (focus active, no catalog, no session):
// No `resources` because suggestionsCatalog is empty → listSuggestionResources() returns nothing.
const EXECUTED_FOCUS_BASE: readonly string[] = [
  'alternatives', 'cast', 'focus', 'intent', 'latencyBreakdown',
  'latencyMs', 'resolved', 'resolvedBy', 'score',
];

// GCF-1 — session + focus, no catalog → EXECUTED_FOCUS_BASE + sessionContext.
const EXECUTED_FOCUS_SESSION: readonly string[] = [
  ...EXECUTED_FOCUS_BASE, 'sessionContext',
];

// GBZ-2 / GCF-2 — session + focus + catalog suggestions (from GBZ):
// resolvedFromCatalog + chainContinuation + resources (catalog-as-resources) + suggestions.
const EXECUTED_FOCUS_SESSION_CATALOG: readonly string[] = [
  'alternatives', 'cast', 'chainContinuation', 'focus', 'intent',
  'latencyBreakdown', 'latencyMs', 'resolved', 'resolvedBy',
  'resolvedFromCatalog', 'resources', 'score', 'sessionContext', 'suggestions',
];

// GCF-3 — session + focus + scope, no catalog.
const EXECUTED_FOCUS_SESSION_SCOPE: readonly string[] = [
  ...EXECUTED_FOCUS_BASE, 'scope', 'sessionContext',
];

// GCF-4 — session + focus + explain, no catalog.
const EXECUTED_FOCUS_SESSION_EXPLAIN: readonly string[] = [
  ...EXECUTED_FOCUS_BASE, 'explanation', 'sessionContext',
];

// sessionContext sub-object keys — no activeSessionFocus when focus is from constructor.
const SESSION_CONTEXT_KEYS: readonly string[] = ['callCount', 'recentTools'];

// ── Config fixtures ────────────────────────────────────────────────────────────

const STRIPE_CONFIG: ServerConfig = {
  id: 'stripe',
  name: 'Stripe',
  type: 'remote',
  access: 'readwrite',
  category: 'ecosystem',
  endpoint: 'https://stripe.com/mcp',
  lazy: true,
};

// Focus profile on 'ecosystem' category — stripe belongs to it.
const FOCUS_PROFILES = {
  profiles: {
    payments: { categories: ['ecosystem'], servers: [], boost: 0.5 },
  },
};

// Catalog with one combo: stripe/list_payments → stripe/get_balance (2-step chain).
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
  return join(tmpdir(), `ch1tty-gcf-${Date.now()}-${++_seq}.jsonl`);
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

async function castExecuted(
  agg: Aggregator,
  extras: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, ...extras });
  assert.equal(result.isError, undefined, 'cast must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥ 1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(
    body['cast'],
    'executed',
    `expected cast:executed, got cast="${String(body['cast'])}"`,
  );
  return body;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GCF-1: cast:executed with session+focus active (no catalog) has exactly base+focus+sessionContext', async () => {
  const agg = makeAgg({ withCatalog: false });
  const sessionId = 'gcf-session-1';
  try {
    await warmSession(agg, sessionId);
    const body = await castExecuted(agg, { sessionId });
    assertExactKeys(body, EXECUTED_FOCUS_SESSION, 'cast:executed session+focus (no catalog)');
    assert.equal(body['focus'], 'payments', 'focus value must equal active profile name');
    assert.equal(typeof body['sessionContext'], 'object', 'sessionContext must be an object');
    assert.notEqual(body['sessionContext'], null, 'sessionContext must not be null');
  } finally {
    await agg.shutdown();
  }
});

test('GCF-2: cast:executed with session+focus+catalog has exactly GBZ-2 set + sessionContext', async () => {
  const agg = makeAgg({ withCatalog: true });
  const sessionId = 'gcf-session-2';
  try {
    await warmSession(agg, sessionId);
    const body = await castExecuted(agg, { sessionId });
    assertExactKeys(body, EXECUTED_FOCUS_SESSION_CATALOG, 'cast:executed session+focus+catalog');
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

test('GCF-3: cast:executed with session+focus+scope (no catalog) has exactly base+focus+sessionContext+scope', async () => {
  const agg = makeAgg({ withCatalog: false });
  const sessionId = 'gcf-session-3';
  try {
    await warmSession(agg, sessionId);
    const body = await castExecuted(agg, {
      sessionId,
      scope: { servers: ['stripe'] },
    });
    assertExactKeys(body, EXECUTED_FOCUS_SESSION_SCOPE, 'cast:executed session+focus+scope');
    assert.equal(body['focus'], 'payments', 'focus value must equal active profile name');
    assert.equal(typeof body['scope'], 'object', 'scope must be an object');
    assert.notEqual(body['scope'], null, 'scope must not be null');
  } finally {
    await agg.shutdown();
  }
});

test('GCF-4: cast:executed with session+focus+explain (no catalog) has exactly base+focus+sessionContext+explanation', async () => {
  const agg = makeAgg({ withCatalog: false });
  const sessionId = 'gcf-session-4';
  try {
    await warmSession(agg, sessionId);
    const body = await castExecuted(agg, { sessionId, explain: true });
    assertExactKeys(body, EXECUTED_FOCUS_SESSION_EXPLAIN, 'cast:executed session+focus+explain');
    assert.equal(body['focus'], 'payments', 'focus value must equal active profile name');
    assert.equal(typeof body['explanation'], 'object', 'explanation must be an object');
    assert.notEqual(body['explanation'], null, 'explanation must not be null');
  } finally {
    await agg.shutdown();
  }
});

test('GCF-5: cast:executed sessionContext has exactly {recentTools, callCount} when focus is from constructor', async () => {
  const agg = makeAgg({ withCatalog: false });
  const sessionId = 'gcf-session-5';
  try {
    await warmSession(agg, sessionId);
    const body = await castExecuted(agg, { sessionId });
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
