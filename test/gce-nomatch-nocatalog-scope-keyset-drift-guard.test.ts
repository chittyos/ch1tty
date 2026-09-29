/**
 * GCE drift guard: freeze cast:no_match exact top-level key set when the
 * focus profile is active but the suggestions catalog has NO entry for it,
 * across scope/explain/session parameter combinations.
 *
 * The GCE gap:
 *   GCB-2 showed that focus + empty catalog → base only (no suggestions, no scope).
 *   GCB-3 showed that focus + catalog match + scope → base + scope + suggestions.
 *   GCD-2 showed that session + focus + empty catalog → base + sessionContext (no scope).
 *   GCD-3 showed that session + focus + catalog match + scope → base + sessionContext + scope + suggestions.
 *
 *   Missing: what happens when the catalog is missing the active focus profile
 *   AND a scope param is passed?  These paths verify:
 *     1. scope appears even when catalog has no entry for the active focus.
 *     2. suggestions NEVER appears when catalog has no matching entry.
 *     3. Both session and explain compose correctly with no-catalog + scope.
 *
 * Exact key sets frozen here (probed 2026-09-26 via aggregator source):
 *
 *   focus + no-catalog + scope                  → base + scope
 *   focus + no-catalog + scope + explain        → base + scope + explanation
 *   session + focus + no-catalog + scope        → base + sessionContext + scope
 *   session + focus + no-catalog + scope+explain→ base + sessionContext + scope + explanation
 *   focus + mismatched-catalog + scope          → base + scope
 *     (catalog has an entry for a DIFFERENT profile key than the active focus;
 *      no suggestions because the active profile has no catalog entry)
 *
 * GCE tests (5):
 *   GCE-1  focus active (empty catalog) + scope
 *          → {cast, hint, intent, latencyMs, resolvedBy, scope}
 *   GCE-2  focus active (empty catalog) + scope + explain
 *          → {cast, explanation, hint, intent, latencyMs, resolvedBy, scope}
 *   GCE-3  session + focus (empty catalog) + scope
 *          → {cast, hint, intent, latencyMs, resolvedBy, scope, sessionContext}
 *   GCE-4  session + focus (empty catalog) + scope + explain
 *          → {cast, explanation, hint, intent, latencyMs, resolvedBy, scope, sessionContext}
 *   GCE-5  focus (mismatched catalog — entry for 'other', active focus 'dev') + scope
 *          → {cast, hint, intent, latencyMs, resolvedBy, scope}
 *          Verifies: a populated catalog without the active focus key is equivalent
 *          to an empty catalog (suggestions absent).
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level key set)
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

// base: the 5 keys always present on cast:no_match
const NO_MATCH_BASE: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'resolvedBy',
];

// focus + no-catalog + scope (GCE-1)
const NO_MATCH_FOCUS_NO_CATALOG_SCOPE: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'scope',
];

// focus + no-catalog + scope + explain (GCE-2)
const NO_MATCH_FOCUS_NO_CATALOG_SCOPE_EXPLAIN: readonly string[] = [
  'cast', 'explanation', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'scope',
];

// session + focus + no-catalog + scope (GCE-3)
const NO_MATCH_SESSION_FOCUS_NO_CATALOG_SCOPE: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'scope', 'sessionContext',
];

// session + focus + no-catalog + scope + explain (GCE-4)
const NO_MATCH_SESSION_FOCUS_NO_CATALOG_SCOPE_EXPLAIN: readonly string[] = [
  'cast', 'explanation', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'scope', 'sessionContext',
];

// focus + mismatched catalog (entry for 'other', active focus 'dev') + scope (GCE-5)
// same shape as GCE-1 — no suggestions because active profile has no catalog entry
const NO_MATCH_FOCUS_MISMATCH_CATALOG_SCOPE: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'scope',
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

// Focus profile keyed on 'code' category — active focus name is 'dev'.
const FOCUS_PROFILES = {
  profiles: {
    dev: { categories: ['code'], servers: [], boost: 0.5 },
  },
};

// Empty suggestions catalog — no entry for any focus profile.
const CATALOG_EMPTY: Record<string, unknown> = {};

// Mismatched catalog — has an entry for 'other' (not 'dev'); active focus is 'dev'.
const CATALOG_MISMATCHED = {
  other: {
    description: 'Other workflows',
    combos: [
      {
        name: 'Other combo',
        chain: ['stripe/list_customers'],
        accomplishes: 'List Stripe customers',
        verified: true,
      },
    ],
    prompts: [
      { text: 'List all customers', resolves_to: 'stripe/list_customers' },
    ],
  },
};

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gce-${Date.now()}-${++_seq}.jsonl`);
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
    suggestionsCatalog: opts.catalog !== undefined ? opts.catalog : CATALOG_EMPTY,
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
    intent: 'zzzzzzz_gce_unique_no_match_99999',
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

// ── GCE-1: focus (empty catalog) + scope ─────────────────────────────────────

test('GCE-1: cast:no_match with focus active (empty catalog) + scope has exactly base + scope, no suggestions', async () => {
  const agg = makeAgg({ focus: 'dev', catalog: CATALOG_EMPTY });
  try {
    const body = await castNoMatch(agg, {
      scope: { servers: ['nonexistent-server-gce-1'] },
    });
    assertExactKeys(body, NO_MATCH_FOCUS_NO_CATALOG_SCOPE, 'cast:no_match +focus+no-catalog+scope');

    assert.equal(typeof body.scope, 'object', 'scope must be an object');
    assert.notEqual(body.scope, null, 'scope must not be null');

    // suggestions must NOT appear — catalog has no 'dev' entry.
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'suggestions'),
      false,
      'suggestions must not appear when catalog has no entry for the active focus',
    );
    // sessionContext must NOT appear — no session active.
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'sessionContext'),
      false,
      'sessionContext must not appear when no session is active',
    );
    // explanation must NOT appear — explain not requested.
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'explanation'),
      false,
      'explanation must not appear without explain:true',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GCE-2: focus (empty catalog) + scope + explain ───────────────────────────

test('GCE-2: cast:no_match with focus active (empty catalog) + scope + explain has exactly base + scope + explanation, no suggestions', async () => {
  const agg = makeAgg({ focus: 'dev', catalog: CATALOG_EMPTY });
  try {
    const body = await castNoMatch(agg, {
      scope: { servers: ['nonexistent-server-gce-2'] },
      explain: true,
    });
    assertExactKeys(body, NO_MATCH_FOCUS_NO_CATALOG_SCOPE_EXPLAIN, 'cast:no_match +focus+no-catalog+scope+explain');

    assert.equal(typeof body.scope, 'object', 'scope must be an object');
    assert.notEqual(body.scope, null, 'scope must not be null');
    assert.equal(typeof body.explanation, 'object', 'explanation must be an object');
    assert.notEqual(body.explanation, null, 'explanation must not be null');

    // suggestions must NOT appear — catalog still empty regardless of explain.
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'suggestions'),
      false,
      'suggestions must not appear when catalog has no entry for the active focus',
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'sessionContext'),
      false,
      'sessionContext must not appear when no session is active',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GCE-3: session + focus (empty catalog) + scope ───────────────────────────

test('GCE-3: cast:no_match with session + focus (empty catalog) + scope has exactly base + sessionContext + scope, no suggestions', async () => {
  const agg = makeAgg({ focus: 'dev', catalog: CATALOG_EMPTY });
  const sessionId = 'gce-test-session-3';
  try {
    await warmSession(agg, sessionId);
    const body = await castNoMatch(agg, {
      sessionId,
      scope: { servers: ['nonexistent-server-gce-3'] },
    });
    assertExactKeys(body, NO_MATCH_SESSION_FOCUS_NO_CATALOG_SCOPE, 'cast:no_match +session+focus+no-catalog+scope');

    assert.equal(typeof body.sessionContext, 'object', 'sessionContext must be an object');
    assert.notEqual(body.sessionContext, null, 'sessionContext must not be null');
    const ctx = body.sessionContext as Record<string, unknown>;
    assert.ok(Array.isArray(ctx.recentTools), 'sessionContext.recentTools must be an array');
    assert.equal(typeof ctx.callCount, 'number', 'sessionContext.callCount must be a number');

    assert.equal(typeof body.scope, 'object', 'scope must be an object');
    assert.notEqual(body.scope, null, 'scope must not be null');

    // suggestions must NOT appear — catalog has no 'dev' entry.
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'suggestions'),
      false,
      'suggestions must not appear when catalog has no entry for the active focus',
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'explanation'),
      false,
      'explanation must not appear without explain:true',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GCE-4: session + focus (empty catalog) + scope + explain ─────────────────

test('GCE-4: cast:no_match with session + focus (empty catalog) + scope + explain has exactly base + sessionContext + scope + explanation, no suggestions', async () => {
  const agg = makeAgg({ focus: 'dev', catalog: CATALOG_EMPTY });
  const sessionId = 'gce-test-session-4';
  try {
    await warmSession(agg, sessionId);
    const body = await castNoMatch(agg, {
      sessionId,
      scope: { servers: ['nonexistent-server-gce-4'] },
      explain: true,
    });
    assertExactKeys(body, NO_MATCH_SESSION_FOCUS_NO_CATALOG_SCOPE_EXPLAIN, 'cast:no_match +session+focus+no-catalog+scope+explain');

    assert.equal(typeof body.sessionContext, 'object', 'sessionContext must be an object');
    assert.notEqual(body.sessionContext, null, 'sessionContext must not be null');
    assert.equal(typeof body.scope, 'object', 'scope must be an object');
    assert.notEqual(body.scope, null, 'scope must not be null');
    assert.equal(typeof body.explanation, 'object', 'explanation must be an object');
    assert.notEqual(body.explanation, null, 'explanation must not be null');

    // suggestions must NOT appear — catalog empty regardless of session/explain/scope.
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'suggestions'),
      false,
      'suggestions must not appear when catalog has no entry for the active focus',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GCE-5: focus (mismatched catalog) + scope ─────────────────────────────────

test('GCE-5: cast:no_match with focus active (catalog has entry for different profile) + scope has exactly base + scope, no suggestions', async () => {
  // Active focus is 'dev'; catalog has entry for 'other' (not 'dev').
  // This verifies that a populated catalog without the active profile key behaves
  // the same as an empty catalog: suggestions are absent.
  const agg = makeAgg({ focus: 'dev', catalog: CATALOG_MISMATCHED });
  try {
    const body = await castNoMatch(agg, {
      scope: { servers: ['nonexistent-server-gce-5'] },
    });
    assertExactKeys(body, NO_MATCH_FOCUS_MISMATCH_CATALOG_SCOPE, 'cast:no_match +focus+mismatch-catalog+scope');

    assert.equal(typeof body.scope, 'object', 'scope must be an object');
    assert.notEqual(body.scope, null, 'scope must not be null');

    // suggestions must NOT appear — catalog has no 'dev' entry (only 'other').
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'suggestions'),
      false,
      'suggestions must not appear when catalog has no entry for the active focus profile key',
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'sessionContext'),
      false,
      'sessionContext must not appear when no session is active',
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'explanation'),
      false,
      'explanation must not appear without explain:true',
    );
  } finally {
    await agg.shutdown();
  }
});
