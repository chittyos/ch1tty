/**
 * GEI drift guard: freeze cast:executed exact top-level key set when scope is
 * set AND explain:true is passed (no session, no focus profile).
 *
 * Prior tests cover the scope and explain conditionals independently:
 *
 *   GBQ    froze cast:executed + scope (no session, no explain) with the LIVE
 *          catalog — scope alone adds exactly `scope` to the base 9-key set.
 *
 *   GVF-1  froze cast:executed base with an EMPTY catalog → 8 keys (no `resources`).
 *
 *   GVF-3  froze cast:executed + focus + explain (no scope, no session) →
 *          base + focus + explanation (10 keys).
 *
 *   GBR-3  froze cast:executed + scope + session + explain → 12 keys (base +
 *          scope + sessionContext + explanation) — but scope+session+explain, not
 *          scope+explain without a session.
 *
 * Gap: no test freezes the exact top-level key set when scope is present AND
 * explain:true is set but there is NO sessionId. A regression that:
 *   (a) drops `scope` from the response when explain:true is active (treats them
 *       as mutually exclusive), or
 *   (b) drops `explanation` when scope is present (scope path skips the
 *       explanation append), or
 *   (c) injects `sessionContext` into a scope+explain call that has no session,
 *       or any other phantom key (focusBoost, scopeScore, etc.),
 * would pass GBQ (no explain), GVF-3 (no scope), and GBR-3 (adds session) silently.
 *
 * Source: src-stdio/aggregator.ts cast:executed body construction:
 *   { cast: 'executed', resolvedBy, intent, latencyMs, latencyBreakdown,
 *     ...(focusName      ? { focus }       : {}),
 *     ...(scopeAnnot     ? { scope }       : {}),
 *     ...(explanation    ? { explanation } : {}),
 *     resolved, score,
 *     ...(alternatives.length > 0 ? { alternatives } : {}),
 *     ...related,
 *     ...(castSessionContext ? { sessionContext } : {}),
 *     ...(focusSuggestions  ? { suggestions }   : {}) }
 *
 * Actual shapes (stripe fixture, empty catalog, no session, no focus, probed 2026-09-30):
 *
 *   cast:executed (scope set, no explain, no session, no focus, empty catalog)
 *     → {alternatives, cast, intent, latencyBreakdown, latencyMs,
 *        resolved, resolvedBy, scope, score}  (9 keys)
 *
 *   cast:executed (scope + explain:true, no session, no focus, empty catalog)
 *     → {alternatives, cast, explanation, intent, latencyBreakdown, latencyMs,
 *        resolved, resolvedBy, scope, score}  (10 keys)
 *
 * GEI freezes:
 *
 *   GEI-1  scope set (no explain, no session, no focus) → EXACTLY base + scope
 *          (9 keys). Baseline for this file; confirms scope adds exactly 1 key
 *          with an empty catalog (no `resources`).
 *
 *   GEI-2  scope + explain:true (no session, no focus) → EXACTLY base + scope +
 *          explanation (10 keys). Both conditional fields present; no extra key.
 *
 *   GEI-3  `explanation` is ABSENT when scope is set but explain:true is NOT set.
 *          (Absence guard; GEI-1 must not accidentally carry `explanation`.)
 *
 *   GEI-4  `scope` is ABSENT when explain:true is set but no scope param is passed.
 *          (Symmetric absence guard.)
 *
 *   GEI-5  `sessionContext` is ABSENT when scope+explain:true are both active
 *          but no sessionId is passed.
 *          (Scope+explain must not bleed in sessionContext from a prior session
 *           call or code path.)
 *
 * Fixture: stripe only (list_payments, get_balance, create_payment_intent).
 * Empty catalog via `suggestionsCatalog: {}` — isolates from catalog changes.
 * Intent: 'list stripe payments' — reliably resolves to stripe/list_payments.
 * No session warming — GEI has no sessionId in any call.
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level cast:executed
 *     key set, not the explanation sub-object fields)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Frozen exact key sets ──────────────────────────────────────────────────────

// Base (empty catalog, no session, no focus, no scope, no explain):
// Stripe fixture → 3 tools → 2 alternatives; empty catalog → no `resources`.
const EXECUTED_KEYS_BASE: readonly string[] = [
  'alternatives', 'cast', 'intent', 'latencyBreakdown', 'latencyMs',
  'resolved', 'resolvedBy', 'score',
];

// GEI-1: scope set (no explain, no session) → base + scope.
const EXECUTED_KEYS_SCOPE: readonly string[] = [
  ...EXECUTED_KEYS_BASE, 'scope',
];

// GEI-2: scope + explain:true (no session) → base + scope + explanation.
const EXECUTED_KEYS_SCOPE_EXPLAIN: readonly string[] = [
  ...EXECUTED_KEYS_BASE, 'explanation', 'scope',
].sort() as string[];

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
  return join(tmpdir(), `ch1tty-gei-${Date.now()}-${++_seq}.jsonl`);
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

// ── GEI-1: scope set, no explain → base + scope (9 keys) ─────────────────────

test('GEI-1: cast:executed + scope (no explain, no session, no focus) has exactly base + scope (9 keys)', async () => {
  const agg = makeAgg();
  try {
    const body = await executed(agg, { scope: { servers: ['stripe'] } });
    assertExactKeys(body, EXECUTED_KEYS_SCOPE, 'GEI-1');
  } finally {
    await agg.shutdown();
  }
});

// ── GEI-2: scope + explain → base + scope + explanation (10 keys) ─────────────

test('GEI-2: cast:executed + scope + explain:true (no session, no focus) has exactly base + scope + explanation (10 keys)', async () => {
  const agg = makeAgg();
  try {
    const body = await executed(agg, { scope: { servers: ['stripe'] }, explain: true });
    assertExactKeys(body, EXECUTED_KEYS_SCOPE_EXPLAIN, 'GEI-2');
  } finally {
    await agg.shutdown();
  }
});

// ── GEI-3: explanation absent when scope active but explain not set ────────────

test('GEI-3: explanation absent when scope is set but explain:true is not passed', async () => {
  const agg = makeAgg();
  try {
    const body = await executed(agg, { scope: { servers: ['stripe'] } });
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'explanation'),
      'explanation must be absent when scope is set but explain:true is not passed',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEI-4: scope absent when explain active but no scope param ────────────────

test('GEI-4: scope absent when explain:true is set but no scope param is passed', async () => {
  const agg = makeAgg();
  try {
    const body = await executed(agg, { explain: true });
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'scope'),
      'scope must be absent when explain:true is set but no scope param is passed',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEI-5: sessionContext absent when scope+explain active but no session ──────

test('GEI-5: sessionContext absent when scope+explain:true are both active but no sessionId is passed', async () => {
  const agg = makeAgg();
  try {
    const body = await executed(agg, { scope: { servers: ['stripe'] }, explain: true });
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'sessionContext'),
      'sessionContext must be absent when scope+explain:true are active but no sessionId is passed',
    );
  } finally {
    await agg.shutdown();
  }
});
