/**
 * GEI drift guard: freeze cast:executed exact top-level key set when scope,
 * focus, AND explain are all active simultaneously (no session).
 *
 * Prior coverage of cast:executed with scope and/or focus:
 *   GBQ-3  scope + explain (no focus, no session) → base + scope + explanation
 *   GBQ-4  scope + focus   (no explain, no session) → base + scope + focus + suggestions
 *   GCF-4  focus + session + explain (no scope) → base + focus + sessionContext + explanation
 *   GVF-3  focus + explain (no scope, no session) → base + focus + explanation
 *   GBR-3  scope + session + explain (no focus) → base + scope + sessionContext + explanation
 *   GBR-4  scope + session + focus (no explain) → base + scope + sessionContext + focus + suggestions
 *
 * Gap: no test freezes the exact key set when ALL THREE of scope, focus, and
 * explain are active in a single cast:executed call (no session). A regression
 * that:
 *   (a) drops `explanation` when scope+focus are both active (treating them as
 *       mutually exclusive with explain),
 *   (b) drops `suggestions` when explain is added to a scope+focus call,
 *   (c) injects an extra key (e.g. `scopeFocusExplain`, `combinedScore`) only
 *       when all three conditionals are present,
 * would pass GBQ-3, GBQ-4, GVF-3, and GCF-4 silently.
 *
 * GEI also closes the scope+focus+session+explain "maximum combo" gap:
 * GBR-3 (scope+session+explain) and GBR-4 (scope+session+focus) are both on
 * main but no test combines all four: scope + focus + session + explain.
 *
 * Source: src-stdio/aggregator.ts line ~1648 (cast:executed body construction):
 *   { cast: 'executed', resolvedBy, intent, latencyMs, latencyBreakdown,
 *     ...(focusName       ? { focus }            : {}),
 *     ...(scopeAnnotation ? { scope }             : {}),
 *     ...(explanation     ? { explanation }       : {}),
 *     resolved, score,
 *     ...(alternatives.length > 0 ? { alternatives } : {}),
 *     ...related,
 *     ...(castSessionContext ? { sessionContext } : {}),
 *     ...(focusSuggestions  ? { suggestions }    : {}) }
 *
 * Actual shapes (stripe fixture, live catalog, probed 2026-09-30):
 *
 *   cast:executed (scope(categories), focus:'finance', explain:true, no session)
 *     → {alternatives, cast, explanation, focus, intent, latencyBreakdown,
 *        latencyMs, resolved, resolvedBy, resources, scope, score, suggestions}
 *       (13 keys)
 *
 *   cast:executed (scope(categories), focus:'finance', explain:true, sessionId)
 *     → above + sessionContext  (14 keys)
 *
 * GEI freezes:
 *
 *   GEI-1  scope + focus + explain (no session) → EXACTLY 13 keys:
 *          {alternatives, cast, explanation, focus, intent, latencyBreakdown,
 *           latencyMs, resolved, resolvedBy, resources, scope, score, suggestions}.
 *          (GBQ-4 + explanation; GVF-3 + scope+suggestions; confirms all three
 *           conditional fields appear together with no phantom key injected.)
 *
 *   GEI-2  `explanation` is ABSENT when scope+focus are active but explain:true
 *          is NOT set.
 *          (Absence guard for GEI-1; confirms GBQ-4's frozen set is unchanged when
 *           explain is omitted alongside scope+focus.)
 *
 *   GEI-3  `explanation` is a non-null plain object (not primitive, not array)
 *          when scope + focus + explain are all active.
 *          (Type guard — value must survive the scope+focus code paths intact.)
 *
 *   GEI-4  scope + focus + session + explain → EXACTLY 14 keys:
 *          {alternatives, cast, explanation, focus, intent, latencyBreakdown,
 *           latencyMs, resolved, resolvedBy, resources, scope, score,
 *           sessionContext, suggestions}.
 *          (Maximum combo: all four conditionals simultaneously; extends GBR-4
 *           by adding explanation, confirms no key leaks or drops.)
 *
 *   GEI-5  `sessionContext` is ABSENT when scope + focus + explain are active
 *          but no sessionId is passed.
 *          (Absence guard for GEI-4; symmetric to GEH-4 for the scope+focus path.)
 *
 * Fixture: stripe only (list_payments, get_balance, create_payment_intent).
 * Live catalog (no suggestionsCatalog override) — same as GBQ — so `resources`
 * and `suggestions` are in the base set when focus is active.
 * Focus profile: 'finance' (loaded from focus-profiles.json at repo root).
 * Intent: 'list stripe payments' — reliably resolves to stripe/list_payments.
 * Scope: { categories: ['ecosystem'] } — consistent scope fixture across tests.
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level cast:executed
 *     key set, not explanation sub-object fields)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Frozen exact key sets ──────────────────────────────────────────────────────

// Base: same as GBQ/GV-1 with live catalog. stripe fixture → 3 tools,
// 2 alternatives; live catalog → `resources` from suggestion catalog entries
// matching 'list stripe payments' above threshold.
const EXECUTED_KEYS_BASE: readonly string[] = [
  'alternatives', 'cast', 'intent', 'latencyBreakdown', 'latencyMs',
  'resolved', 'resolvedBy', 'score', 'resources',
];

// GEI-1: scope + focus + explain (no session) — the gap this test closes.
const EXECUTED_KEYS_SCOPE_FOCUS_EXPLAIN: readonly string[] = [
  ...EXECUTED_KEYS_BASE, 'explanation', 'focus', 'scope', 'suggestions',
];

// GEI-4: scope + focus + session + explain — maximum combo.
const EXECUTED_KEYS_SCOPE_FOCUS_SESSION_EXPLAIN: readonly string[] = [
  ...EXECUTED_KEYS_SCOPE_FOCUS_EXPLAIN, 'sessionContext',
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
const SCOPE = { categories: ['ecosystem'] };
const FOCUS = 'finance';
const SESSION = 'gei-session-1';

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gei-${Date.now()}-${++_seq}.jsonl`);
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

// ── GEI-1: scope + focus + explain (no session) → 13 keys ────────────────────

test('GEI-1: cast:executed + scope + focus + explain (no session) has exactly {base, explanation, focus, scope, suggestions}', async () => {
  const agg = makeAgg();
  try {
    const body = await executed(agg, { scope: SCOPE, focus: FOCUS, explain: true });
    assertExactKeys(body, EXECUTED_KEYS_SCOPE_FOCUS_EXPLAIN, 'GEI-1');
  } finally {
    await agg.shutdown();
  }
});

// ── GEI-2: explanation absent when scope+focus active but explain not set ──────

test('GEI-2: explanation absent when scope + focus are active but explain:true is NOT set', async () => {
  const agg = makeAgg();
  try {
    const body = await executed(agg, { scope: SCOPE, focus: FOCUS });
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'explanation'),
      'explanation must be absent when scope+focus are active but explain:true is not set',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEI-3: explanation is a non-null plain object when scope+focus+explain ─────

test('GEI-3: explanation is a non-null plain object when scope + focus + explain are all active', async () => {
  const agg = makeAgg();
  try {
    const body = await executed(agg, { scope: SCOPE, focus: FOCUS, explain: true });
    const explanation = body['explanation'];
    assert.notEqual(explanation, undefined, 'explanation must be present when explain:true + scope + focus active');
    assert.notEqual(explanation, null, 'explanation must not be null');
    assert.equal(typeof explanation, 'object', `explanation must be an object, got ${typeof explanation}`);
    assert.ok(!Array.isArray(explanation), 'explanation must not be an array');
  } finally {
    await agg.shutdown();
  }
});

// ── GEI-4: scope + focus + session + explain → 14 keys ───────────────────────

test('GEI-4: cast:executed + scope + focus + session + explain has exactly {base, explanation, focus, scope, sessionContext, suggestions}', async () => {
  const agg = makeAgg();
  try {
    // Warm the session so sessionContext has callCount > 0.
    await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SESSION });
    const body = await executed(agg, { scope: SCOPE, focus: FOCUS, explain: true, sessionId: SESSION });
    assertExactKeys(body, EXECUTED_KEYS_SCOPE_FOCUS_SESSION_EXPLAIN, 'GEI-4');
  } finally {
    await agg.shutdown();
  }
});

// ── GEI-5: sessionContext absent when scope+focus+explain but no sessionId ─────

test('GEI-5: sessionContext absent when scope + focus + explain are active but no sessionId is passed', async () => {
  const agg = makeAgg();
  try {
    const body = await executed(agg, { scope: SCOPE, focus: FOCUS, explain: true });
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'sessionContext'),
      'sessionContext must be absent when scope+focus+explain active but no sessionId is passed',
    );
  } finally {
    await agg.shutdown();
  }
});
