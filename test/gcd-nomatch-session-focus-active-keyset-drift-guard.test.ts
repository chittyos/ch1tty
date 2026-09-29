/**
 * GCD drift guard: freeze cast:no_match exact top-level key set when BOTH a
 * session and a focus profile are active simultaneously.
 *
 * This completes the 2×2 session/focus matrix for cast:no_match:
 *
 *   ┌──────────────┬─────────────────────────────────────────────────────────┐
 *   │              │  Focus active                  Focus inactive            │
 *   ├──────────────┼────────────────────────────────────────────────────────-┤
 *   │ Session on   │ GCD (this file)                GCC                      │
 *   │ Session off  │ GCB                            GU                       │
 *   └──────────────┴─────────────────────────────────────────────────────────┘
 *
 * GU froze the base no_match key set: {cast, hint, intent, latencyMs, resolvedBy}.
 * GCB froze no_match when focus is active (no session):
 *     +catalog match: adds `suggestions`; no catalog match: base only.
 * GCC froze no_match when session is active (no focus):
 *     +session: adds `sessionContext`; no session: base only.
 * GCC-5 tested the positive case of session+focus+catalog-match as a one-off
 * supplement — but GCD is the dedicated 5-test freeze for the session+focus
 * combination with full permutation coverage.
 *
 * The gap GCD closes:
 *   A regression that (a) drops `sessionContext` when focus is also active,
 *   (b) adds an unexpected key when both conditions are true, or (c) silently
 *   loses `suggestions` when a session accompanies the focus would pass GU,
 *   GCB, and GCC — none of which test the combined session+focus path together
 *   with the full complement of optional params (scope, explain).
 *
 * Exact key sets when BOTH session and focus are active (probed 2026-09-26
 * via source inspection of src-stdio/aggregator.ts lines ~1354–1375):
 *
 *   +session +focus +catalog-match           → base + sessionContext + suggestions
 *   +session +focus +no-catalog-match        → base + sessionContext  (no suggestions)
 *   +session +focus +catalog-match +scope    → base + sessionContext + scope + suggestions
 *   +session +focus +catalog-match +explain  → base + sessionContext + explanation + suggestions
 *   +session +focus +catalog-match +scope+explain → base + sessionContext + scope + explanation + suggestions
 *
 * GCD freezes:
 *
 *   GCD-1  session active + focus active (catalog match)
 *          → {cast, hint, intent, latencyMs, resolvedBy, sessionContext, suggestions}
 *          Anchor: both contributions compose cleanly.
 *
 *   GCD-2  session active + focus active (empty catalog — no catalog match)
 *          → {cast, hint, intent, latencyMs, resolvedBy, sessionContext}
 *          Guard: `suggestions` must NOT appear when focus has no catalog entry,
 *          even though a session is active. `sessionContext` must still appear.
 *
 *   GCD-3  session active + focus (catalog match) + scope param
 *          → {cast, hint, intent, latencyMs, resolvedBy, scope, sessionContext, suggestions}
 *          Guard: scope adds exactly one key; session and focus contributions unchanged.
 *
 *   GCD-4  session active + focus (catalog match) + explain:true
 *          → {cast, explanation, hint, intent, latencyMs, resolvedBy, sessionContext, suggestions}
 *          Guard: explain adds exactly `explanation`; session and focus contributions unchanged.
 *
 *   GCD-5  session active + focus (catalog match) + scope + explain
 *          → {cast, explanation, hint, intent, latencyMs, resolvedBy, scope, sessionContext, suggestions}
 *          Guard: all three conditional contributions compose without phantom fields.
 *
 * Session isolation: sessions are warmed via ch1tty/status (not cast), so no
 * server affinity builds. Without affinity, focus boost alone cannot push a
 * nonsense intent above the 0.1 no_match threshold (confirmed in GCB/GCC).
 *
 * Catalog isolation: focusProfiles and suggestionsCatalog are injected inline;
 * no dependency on focus-profiles.json or focus-suggestions.json at CWD.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level cast
 *     key set, not the explanation sub-object)
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

const NO_MATCH_BASE: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'resolvedBy',
];

// +session +focus +catalog-match
const NO_MATCH_SESSION_FOCUS_CATALOG: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'sessionContext', 'suggestions',
];

// +session +focus +no-catalog-match
const NO_MATCH_SESSION_FOCUS_NO_CATALOG: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'sessionContext',
];

// +session +focus +catalog-match +scope
const NO_MATCH_SESSION_FOCUS_SCOPE: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'scope', 'sessionContext', 'suggestions',
];

// +session +focus +catalog-match +explain
const NO_MATCH_SESSION_FOCUS_EXPLAIN: readonly string[] = [
  'cast', 'explanation', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'sessionContext', 'suggestions',
];

// +session +focus +catalog-match +scope +explain
const NO_MATCH_SESSION_FOCUS_SCOPE_EXPLAIN: readonly string[] = [
  'cast', 'explanation', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'scope', 'sessionContext', 'suggestions',
];

// ── Config fixtures ───────────────────────────────────────────────────────────

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

// Focus profile keyed on 'code' category — matched by neon's category.
const FOCUS_PROFILES = {
  profiles: {
    dev: { categories: ['code'], servers: [], boost: 0.5 },
  },
};

// Catalog with a 'dev' entry — used in GCD-1/3/4/5 so suggestions is non-null.
const CATALOG_WITH_DEV = {
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

// Empty catalog — used in GCD-2 so suggestions is absent even with focus active.
const CATALOG_EMPTY: Record<string, unknown> = {};

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gcd-${Date.now()}-${++_seq}.jsonl`);
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
    suggestionsCatalog: opts.catalog !== undefined ? opts.catalog : CATALOG_WITH_DEV,
    ...(opts.focus !== undefined ? { focus: opts.focus } : {}),
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

/** Warm a session via ch1tty/status — builds coordinator context without affinity. */
async function warmSession(agg: Aggregator, sessionId: string): Promise<void> {
  await agg.callTool('ch1tty/status', { sessionId });
}

/** Invoke cast with a nonsense intent that reliably produces cast:no_match. */
async function castNoMatch(
  agg: Aggregator,
  extras: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'zzzzzzz_gcd_unique_no_match_88888',
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

// ── GCD-1: session + focus (catalog match) ────────────────────────────────────

test('GCD-1: cast:no_match with session active + focus (catalog match) has exactly base + sessionContext + suggestions', async () => {
  const agg = makeAgg({ focus: 'dev' });
  const sessionId = 'gcd-test-session-1';
  try {
    await warmSession(agg, sessionId);
    const body = await castNoMatch(agg, { sessionId });
    assertExactKeys(body, NO_MATCH_SESSION_FOCUS_CATALOG, 'cast:no_match +session+focus+catalog');

    assert.equal(typeof body.sessionContext, 'object', 'sessionContext must be an object');
    assert.notEqual(body.sessionContext, null, 'sessionContext must not be null');
    const ctx = body.sessionContext as Record<string, unknown>;
    assert.ok(Array.isArray(ctx.recentTools), 'sessionContext.recentTools must be an array');
    assert.equal(typeof ctx.callCount, 'number', 'sessionContext.callCount must be a number');

    assert.equal(typeof body.suggestions, 'object', 'suggestions must be an object');
    assert.notEqual(body.suggestions, null, 'suggestions must not be null');

    // No phantom keys.
    assert.equal(Object.prototype.hasOwnProperty.call(body, 'scope'), false, 'no scope without scope param');
    assert.equal(Object.prototype.hasOwnProperty.call(body, 'explanation'), false, 'no explanation without explain param');
  } finally {
    await agg.shutdown();
  }
});

// ── GCD-2: session + focus (no catalog match) ─────────────────────────────────

test('GCD-2: cast:no_match with session active + focus (empty catalog) has exactly base + sessionContext, no suggestions', async () => {
  const agg = makeAgg({ focus: 'dev', catalog: CATALOG_EMPTY });
  const sessionId = 'gcd-test-session-2';
  try {
    await warmSession(agg, sessionId);
    const body = await castNoMatch(agg, { sessionId });
    assertExactKeys(body, NO_MATCH_SESSION_FOCUS_NO_CATALOG, 'cast:no_match +session+focus+no-catalog');

    assert.equal(typeof body.sessionContext, 'object', 'sessionContext must be an object');
    assert.notEqual(body.sessionContext, null, 'sessionContext must not be null');

    // suggestions must be absent: no catalog entry for 'dev'.
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'suggestions'),
      false,
      'suggestions must not appear when catalog has no entry for the active focus',
    );

    // Base keys must not leak phantom fields either.
    assert.equal(Object.prototype.hasOwnProperty.call(body, 'scope'), false, 'no scope without scope param');
    assert.equal(Object.prototype.hasOwnProperty.call(body, 'explanation'), false, 'no explanation without explain param');
  } finally {
    await agg.shutdown();
  }
});

// ── GCD-3: session + focus (catalog match) + scope ───────────────────────────

test('GCD-3: cast:no_match with session+focus+scope (catalog match) has exactly base + sessionContext + scope + suggestions', async () => {
  const agg = makeAgg({ focus: 'dev' });
  const sessionId = 'gcd-test-session-3';
  try {
    await warmSession(agg, sessionId);
    const body = await castNoMatch(agg, {
      sessionId,
      scope: { servers: ['nonexistent-server-gcd'] },
    });
    assertExactKeys(body, NO_MATCH_SESSION_FOCUS_SCOPE, 'cast:no_match +session+focus+scope');

    assert.equal(typeof body.sessionContext, 'object', 'sessionContext must be an object');
    assert.notEqual(body.sessionContext, null, 'sessionContext must not be null');
    assert.equal(typeof body.scope, 'object', 'scope must be an object');
    assert.notEqual(body.scope, null, 'scope must not be null');
    assert.equal(typeof body.suggestions, 'object', 'suggestions must be an object');
    assert.notEqual(body.suggestions, null, 'suggestions must not be null');

    assert.equal(Object.prototype.hasOwnProperty.call(body, 'explanation'), false, 'no explanation without explain param');
  } finally {
    await agg.shutdown();
  }
});

// ── GCD-4: session + focus (catalog match) + explain ─────────────────────────

test('GCD-4: cast:no_match with session+focus+explain (catalog match) has exactly base + sessionContext + explanation + suggestions', async () => {
  const agg = makeAgg({ focus: 'dev' });
  const sessionId = 'gcd-test-session-4';
  try {
    await warmSession(agg, sessionId);
    const body = await castNoMatch(agg, { sessionId, explain: true });
    assertExactKeys(body, NO_MATCH_SESSION_FOCUS_EXPLAIN, 'cast:no_match +session+focus+explain');

    assert.equal(typeof body.sessionContext, 'object', 'sessionContext must be an object');
    assert.notEqual(body.sessionContext, null, 'sessionContext must not be null');
    assert.equal(typeof body.explanation, 'object', 'explanation must be an object');
    assert.notEqual(body.explanation, null, 'explanation must not be null');
    assert.equal(typeof body.suggestions, 'object', 'suggestions must be an object');
    assert.notEqual(body.suggestions, null, 'suggestions must not be null');

    assert.equal(Object.prototype.hasOwnProperty.call(body, 'scope'), false, 'no scope without scope param');
  } finally {
    await agg.shutdown();
  }
});

// ── GCD-5: session + focus (catalog match) + scope + explain ─────────────────

test('GCD-5: cast:no_match with session+focus+scope+explain (catalog match) has exactly base + sessionContext + scope + explanation + suggestions', async () => {
  const agg = makeAgg({ focus: 'dev' });
  const sessionId = 'gcd-test-session-5';
  try {
    await warmSession(agg, sessionId);
    const body = await castNoMatch(agg, {
      sessionId,
      explain: true,
      scope: { servers: ['nonexistent-server-gcd-5'] },
    });
    assertExactKeys(body, NO_MATCH_SESSION_FOCUS_SCOPE_EXPLAIN, 'cast:no_match +session+focus+scope+explain');

    assert.equal(typeof body.sessionContext, 'object', 'sessionContext must be an object');
    assert.notEqual(body.sessionContext, null, 'sessionContext must not be null');
    assert.equal(typeof body.scope, 'object', 'scope must be an object');
    assert.notEqual(body.scope, null, 'scope must not be null');
    assert.equal(typeof body.explanation, 'object', 'explanation must be an object');
    assert.notEqual(body.explanation, null, 'explanation must not be null');
    assert.equal(typeof body.suggestions, 'object', 'suggestions must be an object');
    assert.notEqual(body.suggestions, null, 'suggestions must not be null');
  } finally {
    await agg.shutdown();
  }
});
