/**
 * GEI drift guard: freeze cast:discovered exact top-level key set when BOTH
 * explain:true AND sessionId are active simultaneously (no scope).
 *
 * Prior discovered exact-keyset coverage:
 *   GBC (PR #1500): base key set (no scope, no session, no explain)
 *                   {cast, hint, intent, latencyMs, prompts, resolvedBy} — 6 keys
 *   GBH (PR #1509): conditional additions individually:
 *                   GBH-2: +explain → base+1=7 keys
 *                   GBH-3: +session → base+1=7 keys
 *                   GBH-4: +scope   → base+1=7 keys
 *   GBS (PR #1520): scope+session combos (scope+session, scope+session+explain)
 *   GCI (PR #1541): focus active combos (focus alone, focus+catalog, focus+catalog+session)
 *
 * Gap: No test on main freezes the exact key set when explain AND session are
 * BOTH active simultaneously on cast:discovered — without scope. GBH tests
 * each conditional individually; GBS-3 covers scope+session+explain (three-way
 * with scope); no test covers the explain+session two-way combination without scope.
 *
 * A regression that:
 *   (a) drops `explanation` from discovered when a session is also active
 *       (treating them as mutually exclusive), or
 *   (b) drops `sessionContext` when explain is also active, or
 *   (c) injects an unexpected key (e.g. `sessionExplanation`, `contextHint`)
 *       only when both explain and session are present,
 * would pass GBH, GBS, GCI, and all prior tests silently.
 *
 * Actual cast:discovered body construction (aggregator.ts ~lines 1416–1444):
 *   { cast: 'discovered', resolvedBy, intent, latencyMs,
 *     ...(scopeAnnotation          ? { scope }         : {}),
 *     ...(explanation              ? { explanation }   : {}),
 *     hint,
 *     ...related,                     // { prompts } from billing fixture
 *     ...(discoveredSessionContext ? { sessionContext } : {}),
 *     ...(focusSuggestions         ? { suggestions }   : {}),
 *   }
 *
 * Actual key sets (billing fixture, empty catalog, 2026-09-30):
 *
 *   explain+session (no scope, no focus):
 *     → {cast, explanation, hint, intent, latencyMs, prompts, resolvedBy,
 *        sessionContext}  — 8 keys
 *
 * GEI freezes:
 *
 *   GEI-1  explain+session (no scope, no focus) → EXACTLY 8 keys:
 *          {cast, explanation, hint, intent, latencyMs, prompts, resolvedBy,
 *           sessionContext}.
 *          (GBH tests explain alone and session alone; neither freezes the
 *           combined path; a regression treating them as mutually exclusive
 *           would pass GBH-2 and GBH-3 undetected.)
 *
 *   GEI-2  `explanation` is an object when explain+session set — not null,
 *          not a primitive.
 *          (Type guard: confirms the explanation code path survives the session
 *           branch without being nulled out or overwritten.)
 *
 *   GEI-3  `sessionContext` is an object with EXACTLY {callCount, recentTools}
 *          when explain+session (no focus from constructor → no activeSessionFocus).
 *          (Confirms sessionContext sub-key set is not expanded by the explain path.)
 *
 *   GEI-4  `explanation` is ABSENT when session is active but explain is NOT set.
 *          (Symmetric absence guard: confirms that an active session does not
 *           accidentally trigger explanation injection — the two conditionals
 *           are independent even when used on the same aggregator instance.)
 *
 *   GEI-5  `sessionContext` is ABSENT when explain is active but session is NOT set.
 *          (Symmetric absence guard: confirms that explain:true does not
 *           accidentally trigger sessionContext injection when no sessionId
 *           is provided — the two conditionals are independent.)
 *
 * Fixture: billing server — tool "create_subscription" (no keyword overlap with
 * "find invoice"), prompt "retrieve_invoice" (matches "find invoice") — reliably
 * routes to cast:discovered (no tool match, prompt match only).
 *
 * Catalog isolation: suggestionsCatalog:{} prevents any resources/suggestions
 * injection; the key set stays deterministic.
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level cast:discovered
 *     key set, not the explanation sub-object fields)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Frozen exact key sets ──────────────────────────────────────────────────────

// Base: {cast, hint, intent, latencyMs, prompts, resolvedBy} — 6 keys.
// billing fixture: tool "create_subscription" (no overlap with "invoice"),
// prompt "retrieve_invoice" (matches "invoice"). No resources.
const DISCOVERED_BASE: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'prompts', 'resolvedBy',
];

// GEI-1 / GEI-2 / GEI-3: explain + session → base + explanation + sessionContext.
const DISCOVERED_EXPLAIN_SESSION: readonly string[] = [
  ...DISCOVERED_BASE, 'explanation', 'sessionContext',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

// Keyword-only coordinator — no brain routing; keeps scoring deterministic.
class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

const BASE_CONFIGS: ServerConfig[] = [{
  id: 'billing',
  name: 'Billing',
  type: 'remote',
  access: 'readwrite',
  category: 'ecosystem',
  endpoint: 'https://billing.test/mcp',
  lazy: true,
}];

const INTENT = 'find invoice';

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gei-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('billing', {
    tools: [{
      name: 'create_subscription',
      description: 'create a new recurring subscription plan',
      inputSchema: { type: 'object' },
      response: { content: [{ type: 'text', text: 'ok' }] },
    }],
    prompts: [
      { name: 'retrieve_invoice', description: 'retrieve and format an invoice for a customer' },
    ],
    resources: [],
  });
  const path = dlq();
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: {},
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

/** Cast and assert cast:discovered, returning the parsed body. */
async function castDiscovered(
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
    'discovered',
    `expected cast:discovered, got cast="${String(body['cast'])}"`,
  );
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
    `${label}: exact key set mismatch.\n  expected: ${JSON.stringify(exp)}\n  actual:   ${JSON.stringify(actual)}`,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GEI-1: cast:discovered with explain+session has EXACTLY base+explanation+sessionContext (8 keys)', async () => {
  const agg = makeAgg();
  try {
    const SESSION = 'gei-test-session-1';
    // Warm session so coordinator.hasSession() is true for subsequent call.
    await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SESSION });
    const body = await castDiscovered(agg, { explain: true, sessionId: SESSION });
    assertExactKeys(body, DISCOVERED_EXPLAIN_SESSION, 'GEI-1');
  } finally {
    await agg.shutdown();
  }
});

test('GEI-2: explanation is an object when explain+session active on cast:discovered', async () => {
  const agg = makeAgg();
  try {
    const SESSION = 'gei-test-session-2';
    await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SESSION });
    const body = await castDiscovered(agg, { explain: true, sessionId: SESSION });
    const explanation = body['explanation'];
    assert.ok(
      typeof explanation === 'object' && explanation !== null,
      `explanation must be an object, got ${typeof explanation}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GEI-3: sessionContext has exactly {callCount, recentTools} when explain+session active on cast:discovered', async () => {
  const agg = makeAgg();
  try {
    const SESSION = 'gei-test-session-3';
    await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SESSION });
    const body = await castDiscovered(agg, { explain: true, sessionId: SESSION });
    const ctx = body['sessionContext'];
    assert.ok(
      typeof ctx === 'object' && ctx !== null,
      'sessionContext must be an object',
    );
    const ctxKeys = Object.keys(ctx as Record<string, unknown>).sort();
    assert.deepEqual(
      ctxKeys,
      ['callCount', 'recentTools'],
      `sessionContext must have exactly {callCount, recentTools}; got ${JSON.stringify(ctxKeys)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GEI-4: explanation is ABSENT when session active but explain not set on cast:discovered', async () => {
  const agg = makeAgg();
  try {
    const SESSION = 'gei-test-session-4';
    // Warm session, then call without explain — explanation must stay absent.
    await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SESSION });
    const body = await castDiscovered(agg, { sessionId: SESSION });
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'explanation'),
      'explanation must be absent when explain is not set, even with an active session',
    );
    // sessionContext IS present (confirm session did activate).
    assert.ok(
      Object.prototype.hasOwnProperty.call(body, 'sessionContext'),
      'sessionContext must be present for sanity (session is active)',
    );
  } finally {
    await agg.shutdown();
  }
});

test('GEI-5: sessionContext is ABSENT when explain active but session not set on cast:discovered', async () => {
  const agg = makeAgg();
  try {
    // No sessionId — sessionContext must stay absent even when explain is set.
    const body = await castDiscovered(agg, { explain: true });
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'sessionContext'),
      'sessionContext must be absent when no sessionId is provided, even with explain:true',
    );
    // explanation IS present (confirm explain did activate).
    assert.ok(
      Object.prototype.hasOwnProperty.call(body, 'explanation'),
      'explanation must be present for sanity (explain:true was passed)',
    );
  } finally {
    await agg.shutdown();
  }
});
