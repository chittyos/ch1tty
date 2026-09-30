/**
 * GCB drift guard: freeze cast:no_match exact top-level key set when a focus
 * profile is active.
 *
 * GU froze the base no_match key set: {cast, hint, intent, latencyMs, resolvedBy}.
 * GBK froze no_match when scope is set (and incidentally tested focus+scope as GBK-4).
 * GBL froze no_match for scope+session combos.
 *
 * The gap: no test freezes the EXACT top-level key set of cast:no_match when
 * focus is active WITHOUT scope. A regression adding or removing a top-level key in
 * the focus-only path (e.g. leaking a `focus` annotation, silently dropping
 * `suggestions`, or adding a new field alongside `suggestions`) would pass GU,
 * GBK, and GBL silently.
 *
 * Source: src-stdio/aggregator.ts lines ~1353–1379 (cast:no_match body):
 *   {
 *     cast: 'no_match', resolvedBy, intent, latencyMs,
 *     ...(scopeAnnotation ? { scope } : {}),
 *     ...(explain ? { explanation } : {}),
 *     ...(focusSuggestions ? { suggestions } : {}),
 *     ...(noMatchSessionContext ? { sessionContext } : {}),
 *     hint,
 *   }
 *
 * Actual key sets when focus is active (probed 2026-09-26 via source inspection):
 *   +focus (catalog match)       → {cast, hint, intent, latencyMs, resolvedBy, suggestions}
 *   +focus (no catalog match)    → {cast, hint, intent, latencyMs, resolvedBy}
 *   +focus+scope                 → {cast, hint, intent, latencyMs, resolvedBy, scope, suggestions}
 *   +focus+explain               → {cast, explanation, hint, intent, latencyMs, resolvedBy, suggestions}
 *   +focus+session               → {cast, hint, intent, latencyMs, resolvedBy, sessionContext, suggestions}
 *
 * GCB freezes:
 *
 *   GCB-1  focus active + catalog match (no scope, no session) adds exactly
 *          `suggestions` to the base set — no other new key.
 *          Result set: {cast, hint, intent, latencyMs, resolvedBy, suggestions}.
 *
 *   GCB-2  focus active BUT no catalog entry for the active focus → key set
 *          stays at base {cast, hint, intent, latencyMs, resolvedBy} (no
 *          suggestions added when focusSuggestions is null).
 *
 *   GCB-3  focus active + catalog match + scope → base + `suggestions` + `scope`.
 *          (Complements GBK-4 which tested scope+focus but froze THAT set, not
 *          the focus-first perspective; this freezes the same result from the
 *          focus-primary viewpoint to close the symmetric gap.)
 *
 *   GCB-4  focus active + catalog match + explain → base + `suggestions` + `explanation`.
 *          (explain adds `explanation` alongside suggestions; no other field.)
 *
 *   GCB-5  focus active + catalog match + live session → base + `suggestions` +
 *          `sessionContext`. (session data adds `sessionContext` alongside suggestions.)
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

// +focus (catalog match): adds `suggestions`.
const NO_MATCH_FOCUS: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'suggestions',
];

// +focus+scope: adds `suggestions` + `scope`.
const NO_MATCH_FOCUS_SCOPE: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'scope', 'suggestions',
];

// +focus+explain: adds `suggestions` + `explanation`.
const NO_MATCH_FOCUS_EXPLAIN: readonly string[] = [
  'cast', 'explanation', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'suggestions',
];

// +focus+session: adds `suggestions` + `sessionContext`.
const NO_MATCH_FOCUS_SESSION: readonly string[] = [
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

// Focus profile keyed on 'code' category — neon belongs to that category.
const FOCUS_PROFILES = {
  profiles: {
    dev: { categories: ['code'], servers: [], boost: 0.5 },
  },
};

// Catalog with an entry for 'dev' focus so focusSuggestions is non-null when
// focus='dev' is active.
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

// Empty catalog: no 'dev' entry → focusSuggestions stays null even when focus='dev'.
const SUGGESTIONS_CATALOG_EMPTY = {};

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gcb-${Date.now()}-${++_seq}.jsonl`);
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

/** Invoke cast with a nonsense intent that reliably produces cast:no_match. */
async function castNoMatch(
  agg: Aggregator,
  extras: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'zzzzzzz_gcb_unique_no_match_99999',
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

// ── GCB-1: focus active + catalog match → base + suggestions ─────────────────

test('GCB-1: cast:no_match with focus active and catalog match has exactly base + suggestions', async () => {
  const agg = makeAgg({ focus: 'dev' });
  try {
    const body = await castNoMatch(agg);
    assertExactKeys(body, NO_MATCH_FOCUS, 'cast:no_match +focus(catalog match)');
    assert.equal(typeof body.suggestions, 'object', 'suggestions must be an object');
    assert.notEqual(body.suggestions, null, 'suggestions must not be null');
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'scope'),
      false,
      'no scope key expected without scope param',
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

// ── GCB-2: focus active, no catalog match → base only ────────────────────────

test('GCB-2: cast:no_match with focus active but no catalog entry stays at base', async () => {
  const agg = makeAgg({ focus: 'dev', catalog: SUGGESTIONS_CATALOG_EMPTY });
  try {
    const body = await castNoMatch(agg);
    assertExactKeys(body, NO_MATCH_BASE, 'cast:no_match +focus(no catalog match)');
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'suggestions'),
      false,
      'no suggestions when focusSuggestions is null',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GCB-3: focus active + catalog match + scope → base + suggestions + scope ─

test('GCB-3: cast:no_match with focus+scope has exactly base + suggestions + scope', async () => {
  const agg = makeAgg({ focus: 'dev' });
  try {
    const body = await castNoMatch(agg, { scope: { servers: ['nonexistent-server-gcb'] } });
    assertExactKeys(body, NO_MATCH_FOCUS_SCOPE, 'cast:no_match +focus+scope');
    assert.equal(typeof body.scope, 'object', 'scope must be an object');
    assert.notEqual(body.scope, null, 'scope must not be null');
    assert.equal(typeof body.suggestions, 'object', 'suggestions must be an object');
  } finally {
    await agg.shutdown();
  }
});

// ── GCB-4: focus active + catalog match + explain → base + suggestions + explanation

test('GCB-4: cast:no_match with focus+explain has exactly base + suggestions + explanation', async () => {
  const agg = makeAgg({ focus: 'dev' });
  try {
    const body = await castNoMatch(agg, { explain: true });
    assertExactKeys(body, NO_MATCH_FOCUS_EXPLAIN, 'cast:no_match +focus+explain');
    assert.equal(typeof body.explanation, 'object', 'explanation must be an object');
    assert.notEqual(body.explanation, null, 'explanation must not be null');
    assert.equal(typeof body.suggestions, 'object', 'suggestions must be an object');
  } finally {
    await agg.shutdown();
  }
});

// ── GCB-5: focus active + catalog match + live session → base + suggestions + sessionContext

test('GCB-5: cast:no_match with focus+session has exactly base + suggestions + sessionContext', async () => {
  const agg = makeAgg({ focus: 'dev' });
  const sessionId = 'gcb-test-session-5';
  try {
    // Warm the session coordinator via ch1tty/status — this lazily creates the
    // session context (so coordinator.hasSession() returns true) without building
    // tool-server affinity, which avoids boosting neon tools above the no_match
    // threshold on the subsequent cast call.
    await agg.callTool('ch1tty/status', { sessionId });
    // Now trigger no_match with the same sessionId.
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'zzzzzzz_gcb_unique_no_match_99999',
      sessionId,
    });
    assert.equal(result.isError, undefined, 'cast must not return isError');
    const body = JSON.parse(
      (result.content[0] as { text: string }).text,
    ) as Record<string, unknown>;
    assert.equal(
      body.cast,
      'no_match',
      `expected cast:no_match but got cast:${body.cast}`,
    );
    assertExactKeys(body, NO_MATCH_FOCUS_SESSION, 'cast:no_match +focus+session');
    assert.equal(typeof body.sessionContext, 'object', 'sessionContext must be an object');
    assert.notEqual(body.sessionContext, null, 'sessionContext must not be null');
    assert.equal(typeof body.suggestions, 'object', 'suggestions must be an object');
  } finally {
    await agg.shutdown();
  }
});
