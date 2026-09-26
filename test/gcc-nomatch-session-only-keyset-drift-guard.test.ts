/**
 * GCC drift guard: freeze cast:no_match exact top-level key set when a session
 * is active but NO focus profile is in effect.
 *
 * GU froze the base no_match key set: {cast, hint, intent, latencyMs, resolvedBy}.
 * GBK froze no_match when scope is set (and incidentally tested focus+scope).
 * GBL froze no_match for scope+session combos.
 * GCB froze no_match when focus is active (with/without scope/explain/session).
 *
 * The gap: no test freezes the EXACT top-level key set of cast:no_match when
 * a session is active WITHOUT a focus profile. A regression adding or removing
 * a top-level key in the session-only path (e.g. leaking an `activeSession`
 * annotation, silently dropping `sessionContext`, or adding a new field next to
 * `sessionContext`) would pass GU, GBK, GBL, and GCB silently.
 *
 * Source: src-stdio/aggregator.ts lines ~1354–1363 (noMatchSessionContext):
 *   let noMatchSessionContext = null;
 *   if (effectiveSessionId && this.coordinator.hasSession(effectiveSessionId)) {
 *     const ctxPat = this.coordinator.getToolPatterns(effectiveSessionId, 1000);
 *     const sfocus = this.coordinator.getSessionFocus(effectiveSessionId);
 *     noMatchSessionContext = {
 *       recentTools: ctxPat.slice(0, 5).map(p => p.tool),
 *       callCount: ctxPat.reduce((s, p) => s + p.count, 0),
 *       ...(sfocus ? { activeSessionFocus: sfocus } : {}),
 *     };
 *   }
 *
 * noMatchSessionContext is always non-null when the session coordinator has the
 * session registered — even for a freshly-warmed session with no tool calls yet
 * (recentTools:[], callCount:0). So any sessionId present in the coordinator
 * adds `sessionContext` to the no_match body.
 *
 * Actual key sets when session is active, no focus (probed 2026-09-26 via source inspection):
 *   +session (no focus)         → {cast, hint, intent, latencyMs, resolvedBy, sessionContext}
 *   no session                  → {cast, hint, intent, latencyMs, resolvedBy}
 *   +session+scope              → {cast, hint, intent, latencyMs, resolvedBy, scope, sessionContext}
 *   +session+explain            → {cast, explanation, hint, intent, latencyMs, resolvedBy, sessionContext}
 *   +session+focus (cat match)  → {cast, hint, intent, latencyMs, resolvedBy, sessionContext, suggestions}
 *
 * GCC freezes:
 *
 *   GCC-1  session active, no focus → base + `sessionContext`.
 *          Result set: {cast, hint, intent, latencyMs, resolvedBy, sessionContext}.
 *
 *   GCC-2  no session at all → base only.
 *          Result set: {cast, hint, intent, latencyMs, resolvedBy}.
 *          (Complements GU's base freeze from the session-absent perspective.)
 *
 *   GCC-3  session active + scope, no focus → base + `sessionContext` + `scope`.
 *          Result set: {cast, hint, intent, latencyMs, resolvedBy, scope, sessionContext}.
 *
 *   GCC-4  session active + explain, no focus → base + `sessionContext` + `explanation`.
 *          Result set: {cast, explanation, hint, intent, latencyMs, resolvedBy, sessionContext}.
 *
 *   GCC-5  session active + focus with catalog match → base + `sessionContext` + `suggestions`.
 *          Verifies session and focus contributions compose correctly: each adds exactly
 *          one extra key, no unexpected field appears or disappears.
 *          Result set: {cast, hint, intent, latencyMs, resolvedBy, sessionContext, suggestions}.
 *
 * Session isolation: all session warming is done via ch1tty/status (not cast),
 * so no server affinity is built. Without affinity, focus boost alone cannot push
 * tools above the 0.1 no_match threshold on a nonsense intent (confirmed in GCB).
 *
 * Catalog isolation: focusProfiles and suggestionsCatalog are injected inline —
 * no dependency on focus-profiles.json or focus-suggestions.json at CWD.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level cast key set,
 *     not the explanation sub-object)
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

// Base set (from GU): always present on cast:no_match.
const NO_MATCH_BASE: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'resolvedBy',
];

// +session (no focus): adds `sessionContext`.
const NO_MATCH_SESSION: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'sessionContext',
];

// +session+scope: adds `sessionContext` + `scope`.
const NO_MATCH_SESSION_SCOPE: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'scope', 'sessionContext',
];

// +session+explain: adds `sessionContext` + `explanation`.
const NO_MATCH_SESSION_EXPLAIN: readonly string[] = [
  'cast', 'explanation', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'sessionContext',
];

// +session+focus (catalog match): adds `sessionContext` + `suggestions`.
const NO_MATCH_SESSION_FOCUS: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'sessionContext', 'suggestions',
];

// ── Config fixtures ────────────────────────────────────────────────────────────

const SERVER_CONFIGS: ServerConfig[] = [
  {
    id: 'neon',
    name: 'Neon DB',
    type: 'remote',
    access: 'readwrite',
    category: 'code',
    endpoint: 'https://neon.tech/mcp',
    lazy: true,
  },
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

// Focus profile keyed on 'code' category — used in GCC-5 to add suggestions.
const FOCUS_PROFILES = {
  profiles: {
    dev: { categories: ['code'], servers: [], boost: 0.5 },
  },
};

// Catalog with an entry for 'dev' — used in GCC-5 so focusSuggestions is non-null.
const SUGGESTIONS_CATALOG_WITH_DEV = {
  dev: {
    description: 'Developer database workflows',
    combos: [
      {
        name: 'Query and schema',
        chain: ['neon/query_database', 'neon/list_tables'],
        accomplishes: 'Query database and inspect schema',
        verified: true,
      },
    ],
    prompts: [
      { text: 'List all tables in the database', resolves_to: 'neon/list_tables' },
    ],
  },
};

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gcc-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(opts: {
  focus?: string;
  catalog?: Record<string, unknown>;
} = {}): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(SERVER_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: opts.catalog ?? SUGGESTIONS_CATALOG_WITH_DEV,
    ...(opts.focus ? { focus: opts.focus } : {}),
  });
}

/** Exact key-set assertion: sorted actual keys must deep-equal sorted expected. */
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

/** Warm a session via ch1tty/status — creates coordinator context without building affinity. */
async function warmSession(agg: Aggregator, sessionId: string): Promise<void> {
  await agg.callTool('ch1tty/status', { sessionId });
}

/** Invoke cast with a nonsense intent that reliably produces cast:no_match. */
async function castNoMatch(
  agg: Aggregator,
  extras: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'zzzzzzz_gcc_unique_no_match_99999',
    ...extras,
  });
  assert.equal(result.isError, undefined, 'cast must not return isError');
  const body = JSON.parse(
    (result.content[0] as { text: string }).text,
  ) as Record<string, unknown>;
  assert.equal(
    body.cast,
    'no_match',
    `expected cast:no_match but got cast:${body.cast}; intent matched unexpectedly`,
  );
  return body;
}

// ── GCC-1: session active, no focus → base + sessionContext ──────────────────

test('GCC-1: cast:no_match with session active (no focus) has exactly base + sessionContext', async () => {
  const agg = makeAgg();
  const sessionId = 'gcc-test-session-1';
  try {
    await warmSession(agg, sessionId);
    const body = await castNoMatch(agg, { sessionId });
    assertExactKeys(body, NO_MATCH_SESSION, 'cast:no_match +session(no focus)');
    assert.equal(typeof body.sessionContext, 'object', 'sessionContext must be an object');
    assert.notEqual(body.sessionContext, null, 'sessionContext must not be null');
    const ctx = body.sessionContext as Record<string, unknown>;
    assert.ok(Array.isArray(ctx.recentTools), 'sessionContext.recentTools must be an array');
    assert.equal(typeof ctx.callCount, 'number', 'sessionContext.callCount must be a number');
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'suggestions'),
      false,
      'no suggestions key expected without focus+catalog match',
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'focus'),
      false,
      'cast:no_match must not include a top-level focus key',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GCC-2: no session at all → base only ─────────────────────────────────────

test('GCC-2: cast:no_match with no session stays at base key set', async () => {
  const agg = makeAgg();
  try {
    const body = await castNoMatch(agg);
    assertExactKeys(body, NO_MATCH_BASE, 'cast:no_match (no session, no focus)');
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'sessionContext'),
      false,
      'no sessionContext expected when no sessionId is provided',
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'suggestions'),
      false,
      'no suggestions expected without focus',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GCC-3: session + scope, no focus → base + sessionContext + scope ─────────

test('GCC-3: cast:no_match with session+scope (no focus) has exactly base + sessionContext + scope', async () => {
  const agg = makeAgg();
  const sessionId = 'gcc-test-session-3';
  try {
    await warmSession(agg, sessionId);
    const body = await castNoMatch(agg, {
      sessionId,
      scope: { servers: ['nonexistent-server-gcc'] },
    });
    assertExactKeys(body, NO_MATCH_SESSION_SCOPE, 'cast:no_match +session+scope');
    assert.equal(typeof body.sessionContext, 'object', 'sessionContext must be an object');
    assert.notEqual(body.sessionContext, null, 'sessionContext must not be null');
    assert.equal(typeof body.scope, 'object', 'scope must be an object');
    assert.notEqual(body.scope, null, 'scope must not be null');
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'suggestions'),
      false,
      'no suggestions expected without focus',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GCC-4: session + explain, no focus → base + sessionContext + explanation ─

test('GCC-4: cast:no_match with session+explain (no focus) has exactly base + sessionContext + explanation', async () => {
  const agg = makeAgg();
  const sessionId = 'gcc-test-session-4';
  try {
    await warmSession(agg, sessionId);
    const body = await castNoMatch(agg, { sessionId, explain: true });
    assertExactKeys(body, NO_MATCH_SESSION_EXPLAIN, 'cast:no_match +session+explain');
    assert.equal(typeof body.sessionContext, 'object', 'sessionContext must be an object');
    assert.notEqual(body.sessionContext, null, 'sessionContext must not be null');
    assert.equal(typeof body.explanation, 'object', 'explanation must be an object');
    assert.notEqual(body.explanation, null, 'explanation must not be null');
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'suggestions'),
      false,
      'no suggestions expected without focus',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GCC-5: session + focus (catalog match) → base + sessionContext + suggestions

test('GCC-5: cast:no_match with session+focus (catalog match) has exactly base + sessionContext + suggestions', async () => {
  const agg = makeAgg({ focus: 'dev' });
  const sessionId = 'gcc-test-session-5';
  try {
    await warmSession(agg, sessionId);
    const body = await castNoMatch(agg, { sessionId });
    assertExactKeys(body, NO_MATCH_SESSION_FOCUS, 'cast:no_match +session+focus(catalog match)');
    assert.equal(typeof body.sessionContext, 'object', 'sessionContext must be an object');
    assert.notEqual(body.sessionContext, null, 'sessionContext must not be null');
    assert.equal(typeof body.suggestions, 'object', 'suggestions must be an object');
    assert.notEqual(body.suggestions, null, 'suggestions must not be null');
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'scope'),
      false,
      'no scope key expected without scope param',
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'explanation'),
      false,
      'no explanation key expected without explain param',
    );
  } finally {
    await agg.shutdown();
  }
});
