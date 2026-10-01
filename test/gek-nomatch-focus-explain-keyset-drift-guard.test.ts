/**
 * GEK drift guard: freeze cast:no_match exact top-level key set when BOTH
 * a focus profile is active AND explain:true is set.
 *
 * Prior tests cover these conditionals separately or in other combinations:
 *
 *   BJ      tests cast:no_match + explain:true/false as presence/absence checks
 *           WITHOUT focus active — not a keyset freeze, and no focus path.
 *
 *   cast-no-match.test.ts ("no_match with active focus") verifies `suggestions`
 *           appears with an active focus+catalog, but asserts individual keys
 *           rather than freezing the EXACT key set.
 *
 *   cast-scope.test.ts ("scope annotation present in no_match response") checks
 *           `scope` appears but does not freeze the full key set.
 *
 * None of the above tests freeze the EXACT top-level key set when focus AND
 * explain are both active on the cast:no_match path.  A regression that:
 *   (a) injects `focus` as a top-level no_match key (mirroring cast:resolved
 *       which DOES carry `focus`, unlike no_match), or
 *   (b) drops `explanation` from cast:no_match when a focus is active, or
 *   (c) injects `suggestions` when the catalog has no entry for the active
 *       focus (leaking the wrong catalog bucket), or
 *   (d) adds an unexpected key (`focusHint`, `focusScore`, etc.) alongside
 *       explain+focus on the nomatch path,
 * would pass all existing tests silently.
 *
 * Actual cast:no_match body construction (aggregator.ts ~line 1364):
 *   {
 *     cast: 'no_match',
 *     resolvedBy, intent, latencyMs,
 *     ...(scopeAnnotation    ? { scope }         : {}),
 *     ...(explain            ? { explanation }   : {}),
 *     ...(focusSuggestions   ? { suggestions }   : {}),
 *     ...(noMatchSessionCtx  ? { sessionContext } : {}),
 *     hint,
 *   }
 *
 * IMPORTANT: `focus` is NOT a top-level key on cast:no_match (unlike
 * cast:resolved and cast:plan which carry `focus`). GEK-1 guards this
 * absence explicitly.
 *
 * GEK freezes:
 *
 *   GEK-1  focus active + no catalog suggestions + explain:true (no scope,
 *          no session) → EXACTLY
 *          {cast, explanation, hint, intent, latencyMs, resolvedBy} — 6 keys.
 *          Specifically asserts `focus` is ABSENT (no_match never carries it).
 *
 *   GEK-2  GEK-1 conditions + session → GEK-1 set PLUS sessionContext — 7 keys.
 *          (Confirms sessionContext adds alongside explanation without leaking
 *           `focus` or any other key.)
 *
 *   GEK-3  GEK-1 conditions + scope → GEK-1 set PLUS scope — 7 keys.
 *          (Confirms scope annotation adds cleanly on the nomatch focus+explain
 *           path.)
 *
 *   GEK-4  focus active + catalog suggestions present + explain:true (no scope,
 *          no session) → EXACTLY
 *          {cast, explanation, hint, intent, latencyMs, resolvedBy,
 *           suggestions} — 7 keys.
 *          (Confirms suggestions and explanation coexist on the focus nomatch
 *           path, and no extra key appears.)
 *
 *   GEK-5  `explanation` ABSENT when explain NOT set (focus active + catalog
 *          suggestions present) → EXACTLY
 *          {cast, hint, intent, latencyMs, resolvedBy, suggestions} — 6 keys.
 *          (Symmetric absence guard: suggestions and explanation are independent
 *           conditionals; `explanation` must be absent when explain is falsy
 *           even when suggestions is present.)
 *
 * Fixture: stripe only (list_payments, get_balance, create_payment_intent from
 * FIXTURE_SERVERS). Focus profile 'payments' → boosts stripe server.
 * No-match intent: 'xyzzy frobulate unknownterm qrvwx' — guaranteed zero
 * keyword overlap with stripe tool descriptions.
 * Warm-up intent for session tests: 'list stripe payments' — reliably resolves.
 * KeywordOnlyCoordinator disables brain route for determinism.
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level cast:no_match
 *     key set presence/absence, not the explanation sub-object fields)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Frozen exact key sets ─────────────────────────────────────────────────────

// GEK-1: focus active, no suggestions, explain:true (no scope, no session) — 6 keys.
const NOMATCH_FOCUS_EXPLAIN_BASE: readonly string[] = [
  'cast', 'explanation', 'hint', 'intent', 'latencyMs', 'resolvedBy',
];

// GEK-2: GEK-1 + sessionContext — 7 keys.
const NOMATCH_FOCUS_EXPLAIN_SESSION: readonly string[] = [
  ...NOMATCH_FOCUS_EXPLAIN_BASE, 'sessionContext',
];

// GEK-3: GEK-1 + scope — 7 keys.
const NOMATCH_FOCUS_EXPLAIN_SCOPE: readonly string[] = [
  ...NOMATCH_FOCUS_EXPLAIN_BASE, 'scope',
];

// GEK-4: focus active, catalog suggestions present, explain:true — 7 keys.
const NOMATCH_FOCUS_EXPLAIN_SUGGESTIONS: readonly string[] = [
  ...NOMATCH_FOCUS_EXPLAIN_BASE, 'suggestions',
];

// GEK-5: focus active, catalog suggestions present, explain NOT set — 6 keys.
const NOMATCH_FOCUS_SUGGESTIONS_NO_EXPLAIN: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'suggestions',
];

// ── Fixture definitions ───────────────────────────────────────────────────────

const STRIPE_CFG: ServerConfig = {
  id: 'stripe',
  name: 'Stripe',
  type: 'remote',
  access: 'readwrite',
  category: 'ecosystem',
  endpoint: 'https://stripe.com/mcp',
  lazy: true,
};

const GEK_FOCUS_PROFILES = {
  profiles: {
    payments: { categories: ['ecosystem'], servers: [], boost: 0.5 },
  },
};

// Catalog with a 'payments' entry — makes focusSuggestions non-null.
const GEK_CATALOG_WITH_PAYMENTS = {
  payments: {
    description: 'Payments focus suggestions',
    combos: [
      {
        name: 'stripe-reconcile',
        chain: ['stripe/list_payments', 'stripe/get_balance'],
        accomplishes: 'reconcile stripe payment balances',
        verified: true,
      },
    ],
    prompts: [
      { text: 'List all recent payments', resolves_to: 'stripe/list_payments' },
    ],
  },
};

// Intent guaranteed NOT to match any stripe tool keyword.
const NO_MATCH_INTENT = 'xyzzy frobulate unknownterm qrvwx';

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gek-${Date.now()}-${++_seq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

function makeBackend(): FixtureBackend {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', FIXTURE_SERVERS['stripe']!);
  return backend;
}

/** Aggregator with focus active but NO catalog suggestions (empty catalog). */
function makeAggNoSuggestions(): Aggregator {
  const path = dlq();
  return new Aggregator([STRIPE_CFG], {
    backendFactory: () => makeBackend(),
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: {},
    focus: 'payments',
    focusProfiles: GEK_FOCUS_PROFILES,
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  } as Parameters<typeof Aggregator.prototype.callTool>[1]);
}

/** Aggregator with focus active AND catalog suggestions for the 'payments' profile. */
function makeAggWithSuggestions(): Aggregator {
  const path = dlq();
  return new Aggregator([STRIPE_CFG], {
    backendFactory: () => makeBackend(),
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: GEK_CATALOG_WITH_PAYMENTS,
    focus: 'payments',
    focusProfiles: GEK_FOCUS_PROFILES,
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  } as Parameters<typeof Aggregator.prototype.callTool>[1]);
}

/** Assert the exact sorted key set with a clear failure message. */
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

/**
 * Call cast with the no-match intent and assert it returns cast:no_match.
 * No warm-up is needed: handleMetaTool creates the coordinator session before
 * the cast handler runs, so sessionContext appears on the first call when
 * sessionId is present (hasSession is true, recentTools:[], callCount:0).
 */
async function castNoMatch(
  agg: Aggregator,
  extras: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: NO_MATCH_INTENT, ...extras });
  assert.equal((result as { isError?: unknown }).isError, undefined, 'cast must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(
    body['cast'],
    'no_match',
    `expected cast:no_match, got cast="${String(body['cast'])}" ` +
    `(intent may have matched — adjust NO_MATCH_INTENT)`,
  );
  return body;
}

// ── GEK-1: focus active, no suggestions, explain:true ────────────────────────

test('GEK-1: cast:no_match with focus active + explain:true (no suggestions, no scope, no session) has EXACTLY {cast,explanation,hint,intent,latencyMs,resolvedBy}', async () => {
  const agg = makeAggNoSuggestions();
  try {
    const body = await castNoMatch(agg, { explain: true });
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'focus'),
      false,
      `'focus' MUST be absent from cast:no_match top-level keys ` +
      `(unlike cast:resolved which carries it); got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    assert.ok(
      'explanation' in body,
      `explanation must be present when explain:true; got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    assertExactKeys(body, NOMATCH_FOCUS_EXPLAIN_BASE, 'GEK-1 focus+explain (no suggestions, no scope, no session)');
    assert.equal(typeof body['explanation'], 'object', 'explanation must be an object');
    assert.notEqual(body['explanation'], null, 'explanation must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GEK-2: focus active, no suggestions, explain:true, session ───────────────

test('GEK-2: cast:no_match with focus active + explain:true + session has EXACTLY GEK-1 set PLUS sessionContext', async () => {
  const agg = makeAggNoSuggestions();
  const sid = 'gek-session-2';
  try {
    const body = await castNoMatch(agg, { explain: true, sessionId: sid });
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'focus'),
      false,
      `'focus' must be absent from cast:no_match; got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    assert.ok(
      'sessionContext' in body,
      `sessionContext must be present after session warm-up; got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    assertExactKeys(body, NOMATCH_FOCUS_EXPLAIN_SESSION, 'GEK-2 focus+explain+session (no suggestions, no scope)');
    assert.equal(typeof body['sessionContext'], 'object', 'sessionContext must be an object');
    assert.notEqual(body['sessionContext'], null, 'sessionContext must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GEK-3: focus active, no suggestions, explain:true, scope ─────────────────

test('GEK-3: cast:no_match with focus active + explain:true + scope has EXACTLY GEK-1 set PLUS scope', async () => {
  const agg = makeAggNoSuggestions();
  try {
    const body = await castNoMatch(agg, { explain: true, scope: { servers: ['stripe'] } });
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'focus'),
      false,
      `'focus' must be absent from cast:no_match; got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    assert.ok(
      'scope' in body,
      `scope must be present when scope param is passed; got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    assertExactKeys(body, NOMATCH_FOCUS_EXPLAIN_SCOPE, 'GEK-3 focus+explain+scope (no suggestions, no session)');
    assert.equal(typeof body['scope'], 'object', 'scope must be an object');
  } finally {
    await agg.shutdown();
  }
});

// ── GEK-4: focus active, catalog suggestions present, explain:true ────────────

test('GEK-4: cast:no_match with focus active + catalog suggestions + explain:true has EXACTLY {cast,explanation,hint,intent,latencyMs,resolvedBy,suggestions}', async () => {
  const agg = makeAggWithSuggestions();
  try {
    const body = await castNoMatch(agg, { explain: true });
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'focus'),
      false,
      `'focus' must be absent from cast:no_match; got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    assert.ok(
      'suggestions' in body,
      `suggestions must be present when catalog has entry for active focus; ` +
      `got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    assert.ok(
      'explanation' in body,
      `explanation must be present when explain:true; got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    assertExactKeys(body, NOMATCH_FOCUS_EXPLAIN_SUGGESTIONS, 'GEK-4 focus+explain+suggestions (no scope, no session)');
    assert.equal(typeof body['suggestions'], 'object', 'suggestions must be an object');
    assert.notEqual(body['suggestions'], null, 'suggestions must not be null');
    assert.equal(typeof body['explanation'], 'object', 'explanation must be an object');
    assert.notEqual(body['explanation'], null, 'explanation must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GEK-5: `explanation` ABSENT when explain NOT set (focus + suggestions) ────

test('GEK-5: `explanation` absent from cast:no_match when explain NOT set (focus active + catalog suggestions)', async () => {
  const agg = makeAggWithSuggestions();
  try {
    const body = await castNoMatch(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'explanation'),
      false,
      `explanation must be ABSENT when explain param is not set; ` +
      `got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    assert.ok(
      'suggestions' in body,
      `suggestions must remain present even without explain; ` +
      `got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    assertExactKeys(body, NOMATCH_FOCUS_SUGGESTIONS_NO_EXPLAIN, 'GEK-5 focus+suggestions (no explain, no scope, no session)');
  } finally {
    await agg.shutdown();
  }
});
