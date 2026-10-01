/**
 * GEH drift guard: freeze cast:executed exact top-level key set when BOTH
 * a sessionId AND explain:true are active (no focus profile).
 *
 * GV froze cast:executed key sets for the base, session, and explain cases
 * independently:
 *   GV-2  session active, no focus, no explain → base + sessionContext
 *   GV-4  explain:true, no session, no focus   → base + explanation
 *
 * Neither GV nor any subsequent test freezes the EXACT top-level key set for
 * the session + explain COMBINATION without a focus profile. The gap:
 *
 *   A regression that:
 *   (a) drops `explanation` when a session is also active (treats them as
 *       mutually exclusive), or
 *   (b) drops `sessionContext` when explain:true is set, or
 *   (c) injects an extra key (e.g. `sessionExplain`, `sessionScore`) only
 *       when both fields are present,
 *   would pass GV-2 and GV-4 silently.
 *
 * Source: src-stdio/aggregator.ts line ~1648 (cast:executed body construction):
 *   { cast: 'executed', resolvedBy, intent, latencyMs, latencyBreakdown,
 *     ...(focusName ? { focus } : {}),
 *     ...(explanation ? { explanation } : {}),
 *     resolved, score,
 *     ...(alternatives.length > 0 ? { alternatives } : {}),
 *     ...related,
 *     ...(castSessionContext ? { sessionContext } : {}),
 *     ...(focusSuggestions ? { suggestions } : {}) }
 *
 * Actual shapes (stripe fixture, empty catalog, no focus, probed 2026-09-30):
 *
 *   cast:executed (session active, no explain, no focus, empty catalog)
 *     → {alternatives, cast, intent, latencyBreakdown, latencyMs,
 *        resolved, resolvedBy, score, sessionContext}  (9 keys)
 *
 *   cast:executed (session + explain:true, no focus, empty catalog)
 *     → {alternatives, cast, explanation, intent, latencyBreakdown, latencyMs,
 *        resolved, resolvedBy, score, sessionContext}  (10 keys)
 *
 * GEH freezes:
 *
 *   GEH-1  cast:executed + sessionId (no explain, no focus) → EXACTLY
 *          {alternatives, cast, intent, latencyBreakdown, latencyMs,
 *           resolved, resolvedBy, score, sessionContext} — 9 keys.
 *          (Baseline with session, no explain; confirms no phantom `explanation`
 *           bleeds in when session is active.)
 *
 *   GEH-2  cast:executed + sessionId + explain:true (no focus) → EXACTLY
 *          GEH-1 set PLUS `explanation` — 10 keys.
 *          (Both conditional fields present; no third key injected.)
 *
 *   GEH-3  `explanation` is ABSENT when sessionId is active but explain:true
 *          is NOT set.
 *          (Absence guard for GEH-1; confirms GEH-1 does not accidentally carry
 *           `explanation` from a prior session or code path.)
 *
 *   GEH-4  `sessionContext` is ABSENT when explain:true is active but no
 *          sessionId is passed.
 *          (Symmetric absence guard; confirms `sessionContext` cannot bleed in
 *           from an explain-only call.)
 *
 *   GEH-5  `explanation` is a non-null plain object (not a primitive, not an
 *          array) when session + explain:true are both active.
 *          (Type guard — the value must survive the session code path intact.)
 *
 * Fixture: stripe only (list_payments, get_balance, create_payment_intent).
 * Empty catalog via `suggestionsCatalog: {}` — isolates from catalog changes.
 * Intent: 'list stripe payments' — reliably resolves to stripe/list_payments.
 * Session: warmed with one prior cast call so sessionContext has callCount > 0.
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

// Base (empty catalog, no session, no focus, no explain):
// Stripe fixture → 3 tools → 2 alternatives; empty catalog → no resources.
const EXECUTED_KEYS_BASE: readonly string[] = [
  'alternatives', 'cast', 'intent', 'latencyBreakdown', 'latencyMs',
  'resolved', 'resolvedBy', 'score',
];

// GEH-1: session active, no explain, no focus → base + sessionContext.
const EXECUTED_KEYS_SESSION: readonly string[] = [
  ...EXECUTED_KEYS_BASE, 'sessionContext',
];

// GEH-2: session + explain:true, no focus → base + sessionContext + explanation.
const EXECUTED_KEYS_SESSION_EXPLAIN: readonly string[] = [
  ...EXECUTED_KEYS_BASE, 'explanation', 'sessionContext',
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
const SESSION = 'geh-session-1';

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

/** Warm the session with one prior cast call so sessionContext.callCount > 0. */
async function warmSession(agg: Aggregator): Promise<void> {
  await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SESSION });
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

// ── GEH-1: session active (no explain) → base + sessionContext ─────────────────

test('GEH-1: cast:executed + session (no explain, no focus) has exactly {base, sessionContext}', async () => {
  const agg = makeAgg();
  try {
    await warmSession(agg);
    const body = await executed(agg, { sessionId: SESSION });
    assertExactKeys(body, EXECUTED_KEYS_SESSION, 'GEH-1');
  } finally {
    await agg.shutdown();
  }
});

// ── GEH-2: session + explain → base + sessionContext + explanation ─────────────

test('GEH-2: cast:executed + session + explain:true (no focus) has exactly {base, explanation, sessionContext}', async () => {
  const agg = makeAgg();
  try {
    await warmSession(agg);
    const body = await executed(agg, { sessionId: SESSION, explain: true });
    assertExactKeys(body, EXECUTED_KEYS_SESSION_EXPLAIN, 'GEH-2');
  } finally {
    await agg.shutdown();
  }
});

// ── GEH-3: explanation absent when session active but explain not set ──────────

test('GEH-3: explanation absent when session active but explain:true not set', async () => {
  const agg = makeAgg();
  try {
    await warmSession(agg);
    const body = await executed(agg, { sessionId: SESSION });
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'explanation'),
      'explanation must be absent when session is active but explain:true is not set',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEH-4: sessionContext absent when explain active but no sessionId ──────────

test('GEH-4: sessionContext absent when explain:true is active but no sessionId is passed', async () => {
  const agg = makeAgg();
  try {
    const body = await executed(agg, { explain: true });
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'sessionContext'),
      'sessionContext must be absent when explain:true is set but no sessionId is passed',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEH-5: explanation is a non-null plain object when session + explain active ─

test('GEH-5: explanation is a non-null plain object when session + explain:true are both active', async () => {
  const agg = makeAgg();
  try {
    await warmSession(agg);
    const body = await executed(agg, { sessionId: SESSION, explain: true });
    const explanation = body['explanation'];
    assert.notEqual(explanation, undefined, 'explanation must be present when explain:true + session active');
    assert.notEqual(explanation, null, 'explanation must not be null');
    assert.equal(typeof explanation, 'object', `explanation must be an object, got ${typeof explanation}`);
    assert.ok(!Array.isArray(explanation), 'explanation must not be an array');
  } finally {
    await agg.shutdown();
  }
});
