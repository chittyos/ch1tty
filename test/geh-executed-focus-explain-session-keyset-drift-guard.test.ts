/**
 * GEH drift guard: freeze cast:executed exact top-level key set when BOTH a
 * focus profile AND explain:true AND a sessionId are active simultaneously.
 *
 * Prior tests cover two-way combinations on cast:executed:
 *
 *   GVF-3 froze cast:executed + focus + explain:true WITHOUT session:
 *         EXACTLY {alternatives, cast, explanation, focus, intent,
 *                  latencyBreakdown, latencyMs, resolved, resolvedBy, score} (10 keys).
 *
 *   GVF-4 froze cast:executed + focus + sessionId WITHOUT explain:
 *         EXACTLY {alternatives, cast, focus, intent, latencyBreakdown,
 *                  latencyMs, resolved, resolvedBy, score, sessionContext} (10 keys).
 *
 * Neither covers the three-way combination: focus ∧ explain:true ∧ sessionId.
 * A regression that:
 *   (a) makes focus + session suppress explanation (treating them mutually exclusive), or
 *   (b) makes focus + explain suppress sessionContext, or
 *   (c) injects an unexpected key (e.g. `focusDebug`, `sessionExplain`) only
 *       when all three are present together
 * would pass GVF-3 (no session) and GVF-4 (no explain) silently.
 *
 * GEG-2 froze the symmetric combination for cast:plan (11 keys); GEH is its
 * counterpart for cast:executed.
 *
 * Actual cast:executed body construction (aggregator.ts ~line 1648):
 *   { cast: 'executed', resolvedBy, intent, latencyMs, latencyBreakdown,
 *     ...(focusName ? { focus: focusName } : {}),
 *     ...(scopeAnnotation ? { scope } : {}),
 *     ...(explanation ? { explanation } : {}),
 *     resolved, score,
 *     ...(alternatives.length > 0 ? { alternatives } : {}),
 *     ...(castSessionContext ? { sessionContext } : {}),
 *     ...(focusSuggestions ? { suggestions } : {}),
 *   }
 *
 * GEH freezes:
 *
 *   GEH-1  cast:executed + focus + explain:true + sessionId → EXACTLY
 *          {alternatives, cast, explanation, focus, intent, latencyBreakdown,
 *           latencyMs, resolved, resolvedBy, score, sessionContext} — 11 keys.
 *          (GVF base-8 + focus + explanation + sessionContext; the three-way
 *           combination that GVF-3 and GVF-4 together do NOT cover.)
 *
 *   GEH-2  cast:executed + focus + explain:false + sessionId → EXACTLY 10 keys
 *          (base+focus+sessionContext — same as GVF-4); explanation ABSENT.
 *          (Symmetric absence guard: session active but explain:false must NOT
 *           inject explanation even when focus is also active.)
 *
 *   GEH-3  cast:executed + focus + explain:true + NO session → EXACTLY 10 keys
 *          (base+focus+explanation — same as GVF-3); sessionContext ABSENT.
 *          (Symmetric absence guard: explain active but no session must NOT
 *           inject sessionContext even when focus is also active.)
 *
 *   GEH-4  `explanation` field in GEH-1 result is a non-null plain object.
 *          (Type guard: confirms explanation survives all three conditionals;
 *           a code path that short-circuits explanation to null or undefined
 *           when session is also active would still pass GEH-1 if JSON.stringify
 *           omits null/undefined — this closes that loophole.)
 *
 *   GEH-5  `sessionContext` field in GEH-1 result is a non-null plain object.
 *          (Symmetric type guard for sessionContext alongside GEH-4.)
 *
 * Fixture: stripe only (list_payments, get_balance, create_payment_intent).
 * Focus: 'finance' per-call param (aggregator loads focus-profiles.json which
 * includes a 'finance' profile). Empty catalog prevents suggestion injection.
 * Intent: "list stripe payments" reliably resolves to stripe/list_payments.
 * Session: initialised with one prior cast call so coordinator.hasSession() is
 * true, guaranteeing planSessionContext/castSessionContext is non-null.
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level cast:executed
 *     key set presence/absence, not the explanation sub-object fields)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Frozen exact key sets ─────────────────────────────────────────────────────

// GVF base (8 keys) — cast:executed with empty catalog.
const EXECUTED_BASE: readonly string[] = [
  'alternatives', 'cast', 'intent', 'latencyBreakdown', 'latencyMs',
  'resolved', 'resolvedBy', 'score',
];

// GVF-3 (10 keys): base + focus + explanation — focus+explain, no session.
const EXECUTED_FOCUS_EXPLAIN: readonly string[] = [
  ...EXECUTED_BASE, 'explanation', 'focus',
];

// GVF-4 (10 keys): base + focus + sessionContext — focus+session, no explain.
const EXECUTED_FOCUS_SESSION: readonly string[] = [
  ...EXECUTED_BASE, 'focus', 'sessionContext',
];

// GEH-1 (11 keys): base + focus + explanation + sessionContext.
const EXECUTED_FOCUS_EXPLAIN_SESSION: readonly string[] = [
  ...EXECUTED_BASE, 'explanation', 'focus', 'sessionContext',
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
const FOCUS = 'finance';
const SESSION_ID = 'geh-session-001';

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-geh-${Date.now()}-${++_seq}.jsonl`);
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

async function primeSession(agg: Aggregator): Promise<void> {
  await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SESSION_ID, focus: FOCUS });
}

async function castExecuted(
  agg: Aggregator,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, ...extra });
  assert.equal(result.isError, undefined, 'cast must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥ 1 content items');
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(body['cast'], 'executed', `expected cast:executed, got cast="${String(body['cast'])}"`);
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

test('GEH-1: cast:executed + focus + explain:true + sessionId has EXACTLY 11 keys', async () => {
  const agg = makeAgg();
  try {
    await primeSession(agg);
    const body = await castExecuted(agg, { focus: FOCUS, explain: true, sessionId: SESSION_ID });
    assertExactKeys(body, EXECUTED_FOCUS_EXPLAIN_SESSION, 'GEH-1');
  } finally {
    await agg.shutdown();
  }
});

test('GEH-2: cast:executed + focus + explain:false + sessionId has EXACTLY 10 keys; explanation absent', async () => {
  const agg = makeAgg();
  try {
    await primeSession(agg);
    const body = await castExecuted(agg, { focus: FOCUS, sessionId: SESSION_ID });
    assertExactKeys(body, EXECUTED_FOCUS_SESSION, 'GEH-2');
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'explanation'),
      'GEH-2: explanation must be absent when explain is not set, even with focus+session active',
    );
  } finally {
    await agg.shutdown();
  }
});

test('GEH-3: cast:executed + focus + explain:true + no session has EXACTLY 10 keys; sessionContext absent', async () => {
  const agg = makeAgg();
  try {
    const body = await castExecuted(agg, { focus: FOCUS, explain: true });
    assertExactKeys(body, EXECUTED_FOCUS_EXPLAIN, 'GEH-3');
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'sessionContext'),
      'GEH-3: sessionContext must be absent when no session is active, even with focus+explain active',
    );
  } finally {
    await agg.shutdown();
  }
});

test('GEH-4: `explanation` field is a non-null plain object when focus+explain+session are all active', async () => {
  const agg = makeAgg();
  try {
    await primeSession(agg);
    const body = await castExecuted(agg, { focus: FOCUS, explain: true, sessionId: SESSION_ID });
    const explanation = body['explanation'];
    assert.ok(
      explanation !== null && typeof explanation === 'object' && !Array.isArray(explanation),
      `GEH-4: explanation must be a non-null plain object; got ${JSON.stringify(explanation)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GEH-5: `sessionContext` field is a non-null plain object when focus+explain+session are all active', async () => {
  const agg = makeAgg();
  try {
    await primeSession(agg);
    const body = await castExecuted(agg, { focus: FOCUS, explain: true, sessionId: SESSION_ID });
    const sessionContext = body['sessionContext'];
    assert.ok(
      sessionContext !== null && typeof sessionContext === 'object' && !Array.isArray(sessionContext),
      `GEH-5: sessionContext must be a non-null plain object; got ${JSON.stringify(sessionContext)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
