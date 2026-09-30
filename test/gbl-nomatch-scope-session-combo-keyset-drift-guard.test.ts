/**
 * GBL drift guard: freeze cast:no_match exact top-level key set for
 * scope+session combinations and the maximal all-four-conditional combo.
 *
 * GU  froze base no_match key set: {cast, hint, intent, latencyMs, resolvedBy}
 *       + conditional sessionContext for +session.
 * GBJ froze +explain, +focus, +session without scope.
 * GBK froze +scope alone, +scope+explain, +scope+focus, and absence guard.
 *
 * Gap: no test froze the key set when scope is present AND sessionId is given,
 * nor the triple (+scope+focus+explain) or the maximal all-four combo.
 * A regression that conditionally injects or drops sessionContext on the
 * scope-present path would pass GU, GBJ, GBK, and EQ silently.
 *
 * Source (src-stdio/aggregator.ts ~line 1364):
 *   cast:no_match body =
 *     { cast, resolvedBy, intent, latencyMs,
 *       ...(scopeAnnotation       ? { scope }          : {}),
 *       ...(explain               ? { explanation }    : {}),
 *       ...(focusSuggestions      ? { suggestions }    : {}),
 *       ...(noMatchSessionContext ? { sessionContext }  : {}),
 *       hint }
 *
 * Actual key sets (probed 2026-09-26 via source inspection):
 *   +scope+session          → {cast, hint, intent, latencyMs, resolvedBy, scope, sessionContext}
 *   +scope+focus+explain    → {cast, explanation, hint, intent, latencyMs, resolvedBy, scope, suggestions}
 *   +scope+focus+session    → {cast, hint, intent, latencyMs, resolvedBy, scope, sessionContext, suggestions}
 *   +scope+explain+session  → {cast, explanation, hint, intent, latencyMs, resolvedBy, scope, sessionContext}
 *   +scope+focus+explain+session (maximal) →
 *     {cast, explanation, hint, intent, latencyMs, resolvedBy, scope, sessionContext, suggestions}
 *
 * GBL freezes:
 *   GBL-1  +scope+session          → base + scope + sessionContext
 *   GBL-2  +scope+focus+explain    → base + scope + explanation + suggestions (triple)
 *   GBL-3  +scope+focus+session    → base + scope + suggestions + sessionContext
 *   GBL-4  +scope+explain+session  → base + scope + explanation + sessionContext
 *   GBL-5  maximal (all four)      → base + scope + explanation + sessionContext + suggestions
 *
 * Catalog isolation: focusProfiles and suggestionsCatalog are injected inline —
 * no dependency on focus-profiles.json or focus-suggestions.json at CWD.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level cast response
 *     fields, not the explanation sub-object)
 *
 * Frozen 2026-09-26.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { FocusSuggestions } from '../src/suggestions.js';
import type { FocusProfile } from '../src/focus.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Frozen exact key sets ──────────────────────────────────────────────────────

const NO_MATCH_BASE: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'resolvedBy',
];

const NO_MATCH_SCOPE_SESSION: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'scope', 'sessionContext',
];

const NO_MATCH_SCOPE_FOCUS_EXPLAIN: readonly string[] = [
  'cast', 'explanation', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'scope', 'suggestions',
];

const NO_MATCH_SCOPE_FOCUS_SESSION: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'scope', 'sessionContext', 'suggestions',
];

const NO_MATCH_SCOPE_EXPLAIN_SESSION: readonly string[] = [
  'cast', 'explanation', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'scope', 'sessionContext',
];

const NO_MATCH_MAXIMAL: readonly string[] = [
  'cast', 'explanation', 'hint', 'intent', 'latencyMs', 'resolvedBy',
  'scope', 'sessionContext', 'suggestions',
];

// ── Inline catalog fixtures (avoid CWD dependency on focus-suggestions.json) ──

const CODE_FOCUS_PROFILE: FocusProfile = {
  description: 'Software development tools',
  categories: ['code'],
  servers: ['neon'],
  boost: 0.5,
};

const CODE_SUGGESTIONS_CATALOG: Record<string, FocusSuggestions> = {
  code: {
    description: 'Code search, database, filesystem, and quality metrics tools.',
    combos: [{
      name: 'code-search-with-docs',
      chain: ['neon/list-projects', 'neon/get-connection-string'],
      accomplishes: 'Find a Neon project and get its connection string.',
      verified: false,
    }],
    prompts: [{
      text: 'List all Neon projects',
      resolves_to: 'neon/list-projects',
    }],
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_CONFIGS: ServerConfig[] = [
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

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gbl-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(opts: { focus?: string } = {}): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    focusProfiles: { profiles: { code: CODE_FOCUS_PROFILE } },
    suggestionsCatalog: CODE_SUGGESTIONS_CATALOG,
    ...(opts.focus ? { focus: opts.focus } : {}),
  });
}

/** Exact key-set assertion: sorted actual keys must deep-equal sorted expected keys. */
function assertExactKeys(
  body: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(body).sort();
  const exp = [...expected].sort();
  assert.deepEqual(actual, exp,
    `${label}: exact key set mismatch.\n  expected: ${JSON.stringify(exp)}\n  actual:   ${JSON.stringify(actual)}`);
}

/**
 * Invoke cast with a nonsense intent + nonexistent scope to produce cast:no_match.
 * scope is always set; extras may include explain, sessionId.
 */
async function castNoMatchScoped(
  agg: Aggregator,
  scope: Record<string, unknown>,
  extras: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const args: Record<string, unknown> = {
    intent: 'zzzzzzz_gbl_unique_no_match_88888',
    scope,
    ...extras,
  };
  const result = await agg.callTool('ch1tty/cast', args);
  assert.equal(result.isError, undefined, 'cast must not return isError');
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body.cast, 'no_match',
    `expected cast:no_match but got cast:${body.cast}; intent may have matched unexpectedly`);
  return body;
}

// ── GBL-1: +scope+session → base + scope + sessionContext ─────────────────────

test('GBL-1: cast:no_match +scope+session has exactly base keys + scope + sessionContext', async () => {
  const agg = makeAgg();
  try {
    const body = await castNoMatchScoped(
      agg,
      { servers: ['nonexistent-server'] },
      { sessionId: 'gbl-session-scope-1' },
    );
    assertExactKeys(body, NO_MATCH_SCOPE_SESSION, 'cast:no_match +scope+session');
    assert.equal(typeof body.scope, 'object', 'scope must be an object');
    assert.notEqual(body.scope, null, 'scope must not be null');
    assert.equal(typeof body.sessionContext, 'object', 'sessionContext must be an object');
    assert.notEqual(body.sessionContext, null, 'sessionContext must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GBL-2: +scope+focus+explain → base + scope + explanation + suggestions ────

test('GBL-2: cast:no_match +scope+focus+explain has exactly base keys + scope + explanation + suggestions', async () => {
  const agg = makeAgg({ focus: 'code' });
  try {
    const body = await castNoMatchScoped(
      agg,
      { servers: ['nonexistent-server'] },
      { explain: true },
    );
    assertExactKeys(body, NO_MATCH_SCOPE_FOCUS_EXPLAIN, 'cast:no_match +scope+focus+explain');
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

// ── GBL-3: +scope+focus+session → base + scope + suggestions + sessionContext ──

test('GBL-3: cast:no_match +scope+focus+session has exactly base keys + scope + suggestions + sessionContext', async () => {
  const agg = makeAgg({ focus: 'code' });
  try {
    const body = await castNoMatchScoped(
      agg,
      { servers: ['nonexistent-server'] },
      { sessionId: 'gbl-session-scope-focus-3' },
    );
    assertExactKeys(body, NO_MATCH_SCOPE_FOCUS_SESSION, 'cast:no_match +scope+focus+session');
    assert.equal(typeof body.scope, 'object', 'scope must be an object');
    assert.notEqual(body.scope, null, 'scope must not be null');
    assert.equal(typeof body.suggestions, 'object', 'suggestions must be an object');
    assert.notEqual(body.suggestions, null, 'suggestions must not be null');
    assert.equal(typeof body.sessionContext, 'object', 'sessionContext must be an object');
    assert.notEqual(body.sessionContext, null, 'sessionContext must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GBL-4: +scope+explain+session → base + scope + explanation + sessionContext ─

test('GBL-4: cast:no_match +scope+explain+session has exactly base keys + scope + explanation + sessionContext', async () => {
  const agg = makeAgg();
  try {
    const body = await castNoMatchScoped(
      agg,
      { servers: ['nonexistent-server'] },
      { explain: true, sessionId: 'gbl-session-scope-explain-4' },
    );
    assertExactKeys(body, NO_MATCH_SCOPE_EXPLAIN_SESSION, 'cast:no_match +scope+explain+session');
    assert.equal(typeof body.scope, 'object', 'scope must be an object');
    assert.notEqual(body.scope, null, 'scope must not be null');
    assert.equal(typeof body.explanation, 'object', 'explanation must be an object');
    assert.notEqual(body.explanation, null, 'explanation must not be null');
    assert.equal(typeof body.sessionContext, 'object', 'sessionContext must be an object');
    assert.notEqual(body.sessionContext, null, 'sessionContext must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GBL-5: maximal (+scope+focus+explain+session) → all 9 fields ─────────────

test('GBL-5: cast:no_match maximal (+scope+focus+explain+session) has exactly the 9-field key set', async () => {
  const agg = makeAgg({ focus: 'code' });
  try {
    const body = await castNoMatchScoped(
      agg,
      { servers: ['nonexistent-server'] },
      { explain: true, sessionId: 'gbl-session-maximal-5' },
    );
    assertExactKeys(body, NO_MATCH_MAXIMAL, 'cast:no_match maximal (+scope+focus+explain+session)');
    assert.equal(typeof body.scope, 'object', 'scope must be an object');
    assert.notEqual(body.scope, null, 'scope must not be null');
    assert.equal(typeof body.explanation, 'object', 'explanation must be an object');
    assert.notEqual(body.explanation, null, 'explanation must not be null');
    assert.equal(typeof body.suggestions, 'object', 'suggestions must be an object');
    assert.notEqual(body.suggestions, null, 'suggestions must not be null');
    assert.equal(typeof body.sessionContext, 'object', 'sessionContext must be an object');
    assert.notEqual(body.sessionContext, null, 'sessionContext must not be null');
  } finally {
    await agg.shutdown();
  }
});
