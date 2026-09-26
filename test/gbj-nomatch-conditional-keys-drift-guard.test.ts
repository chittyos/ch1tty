/**
 * GBJ drift guard: freeze cast:no_match conditional key set additions for
 * +explain, +focus (suggestions), +focus+explain, and +focus+session.
 *
 * GU froze the exact key sets for base (no session) and +session:
 *   base → {cast, hint, intent, latencyMs, resolvedBy}
 *   +session → + sessionContext
 *
 * The conditional keys added by the explain and focus params were unfrozen:
 * a regression that injects or drops `explanation` or `suggestions` in the
 * no_match path would pass all GU tests silently.
 *
 * Source (src-stdio/aggregator.ts ~line 1364):
 *   cast:no_match body =
 *     { cast, resolvedBy, intent, latencyMs,
 *       ...(scopeAnnotation ? { scope } : {}),
 *       ...(explain        ? { explanation } : {}),
 *       ...(focusSuggestions ? { suggestions } : {}),
 *       ...(noMatchSessionContext ? { sessionContext } : {}),
 *       hint }
 *
 * Actual key sets (probed 2026-09-26 via source inspection):
 *   +explain only      → {cast, explanation, hint, intent, latencyMs, resolvedBy}
 *   +focus only (code) → {cast, hint, intent, latencyMs, resolvedBy, suggestions}
 *   +focus+explain     → {cast, explanation, hint, intent, latencyMs, resolvedBy, suggestions}
 *   +focus+session     → {cast, hint, intent, latencyMs, resolvedBy, sessionContext, suggestions}
 *
 * GBJ freezes:
 *   GBJ-1  +explain adds exactly `explanation` (and nothing else) to the base key set
 *   GBJ-2  +focus adds exactly `suggestions` (and nothing else) to the base key set
 *   GBJ-3  +focus+explain adds exactly `explanation` + `suggestions` to the base key set
 *   GBJ-4  +focus+session adds exactly `suggestions` + `sessionContext` to the base key set
 *   GBJ-5  absence guards — no `explanation` without explain; no `suggestions` without focus
 *   GBJ-6  +explain+session adds exactly `explanation` + `sessionContext` to the base key set
 *   GBJ-7  per-call focus arg (not constructor default) activates `suggestions`
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

const NO_MATCH_EXPLAIN: readonly string[] = [
  'cast', 'explanation', 'hint', 'intent', 'latencyMs', 'resolvedBy',
];

const NO_MATCH_FOCUS: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'suggestions',
];

const NO_MATCH_FOCUS_EXPLAIN: readonly string[] = [
  'cast', 'explanation', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'suggestions',
];

const NO_MATCH_FOCUS_SESSION: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'sessionContext', 'suggestions',
];

const NO_MATCH_EXPLAIN_SESSION: readonly string[] = [
  'cast', 'explanation', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'sessionContext',
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
  return join(tmpdir(), `ch1tty-gbj-${Date.now()}-${++_seq}.jsonl`);
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

/** Invoke cast with an intent that reliably produces cast:no_match. */
async function castNoMatch(
  agg: Aggregator,
  extras: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const args: Record<string, unknown> = {
    intent: 'zzzzzzz_gbj_unique_no_match_99999',
    ...extras,
  };
  const result = await agg.callTool('ch1tty/cast', args);
  assert.equal(result.isError, undefined, 'cast must not return isError');
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body.cast, 'no_match',
    `expected cast:no_match but got cast:${body.cast}; intent may have matched unexpectedly`);
  return body;
}

// ── GBJ-1: +explain adds exactly `explanation` to the base key set ────────────

test('GBJ-1: cast:no_match +explain has exactly base keys + explanation', async () => {
  const agg = makeAgg();
  try {
    const body = await castNoMatch(agg, { explain: true });
    assertExactKeys(body, NO_MATCH_EXPLAIN, 'cast:no_match +explain');
    assert.equal(typeof body.explanation, 'object', 'explanation must be an object');
    assert.notEqual(body.explanation, null, 'explanation must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GBJ-2: +focus adds exactly `suggestions` to the base key set ─────────────

test('GBJ-2: cast:no_match +focus (code) has exactly base keys + suggestions', async () => {
  const agg = makeAgg({ focus: 'code' });
  try {
    const body = await castNoMatch(agg);
    assertExactKeys(body, NO_MATCH_FOCUS, 'cast:no_match +focus:code');
    assert.equal(typeof body.suggestions, 'object', 'suggestions must be an object');
    assert.notEqual(body.suggestions, null, 'suggestions must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GBJ-3: +focus+explain adds exactly `explanation` + `suggestions` ─────────

test('GBJ-3: cast:no_match +focus+explain has exactly base keys + explanation + suggestions', async () => {
  const agg = makeAgg({ focus: 'code' });
  try {
    const body = await castNoMatch(agg, { explain: true });
    assertExactKeys(body, NO_MATCH_FOCUS_EXPLAIN, 'cast:no_match +focus:code +explain');
  } finally {
    await agg.shutdown();
  }
});

// ── GBJ-4: +focus+session adds exactly `suggestions` + `sessionContext` ───────

test('GBJ-4: cast:no_match +focus+session has exactly base keys + suggestions + sessionContext', async () => {
  const agg = makeAgg({ focus: 'code' });
  try {
    const body = await castNoMatch(agg, { sessionId: 'gbj-session-focus' });
    assertExactKeys(body, NO_MATCH_FOCUS_SESSION, 'cast:no_match +focus:code +session');
  } finally {
    await agg.shutdown();
  }
});

// ── GBJ-5: absence guards — no `explanation` without explain; no `suggestions` without focus ──

test('GBJ-5: cast:no_match base has no explanation and no suggestions', async () => {
  const agg = makeAgg();
  try {
    const body = await castNoMatch(agg);
    assertExactKeys(body, NO_MATCH_BASE, 'cast:no_match base');
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'explanation'),
      false,
      'cast:no_match without explain must not include explanation',
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'suggestions'),
      false,
      'cast:no_match without active focus must not include suggestions',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GBJ-6: +explain+session adds exactly `explanation` + `sessionContext` ─────

test('GBJ-6: cast:no_match +explain+session has exactly base keys + explanation + sessionContext', async () => {
  const agg = makeAgg();
  try {
    const body = await castNoMatch(agg, { explain: true, sessionId: 'gbj-session-explain' });
    assertExactKeys(body, NO_MATCH_EXPLAIN_SESSION, 'cast:no_match +explain +session');
    assert.equal(typeof body.explanation, 'object', 'explanation must be an object');
    assert.notEqual(body.explanation, null, 'explanation must not be null');
    assert.equal(typeof body.sessionContext, 'object', 'sessionContext must be an object');
  } finally {
    await agg.shutdown();
  }
});

// ── GBJ-7: per-call `focus` arg activates suggestions (constructor has no focus) ─

test('GBJ-7: cast:no_match per-call focus arg adds exactly `suggestions`', async () => {
  const agg = makeAgg(); // no constructor-level focus
  try {
    const body = await castNoMatch(agg, { focus: 'code' });
    assertExactKeys(body, NO_MATCH_FOCUS, 'cast:no_match per-call focus:code');
    assert.equal(typeof body.suggestions, 'object', 'suggestions must be an object');
    assert.notEqual(body.suggestions, null, 'suggestions must not be null');
  } finally {
    await agg.shutdown();
  }
});
