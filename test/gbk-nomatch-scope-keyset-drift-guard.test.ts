/**
 * GBK drift guard: freeze cast:no_match exact top-level key set when the
 * `scope` parameter is set (servers and/or categories filter).
 *
 * GU froze the base no_match key set: {cast, hint, intent, latencyMs, resolvedBy}
 * GBJ froze conditional additions from +explain, +focus, +session.
 * EQ (eq-cast-scope-sub-object-shape.test.ts) froze scope sub-object shape
 *   and scope presence/absence across cast modes.
 *
 * The gap: no test freezes the EXACT top-level key set of cast:no_match
 * when scope is set. A regression that injects or drops a top-level field
 * in the scope=present no_match path would pass GU, GBJ, and EQ silently.
 *
 * Source (src-stdio/aggregator.ts ~line 1364):
 *   cast:no_match body =
 *     { cast, resolvedBy, intent, latencyMs,
 *       ...(scopeAnnotation ? { scope }       : {}),
 *       ...(explain        ? { explanation }   : {}),
 *       ...(focusSuggestions ? { suggestions } : {}),
 *       ...(noMatchSessionContext ? { sessionContext } : {}),
 *       hint }
 *
 * Actual key sets (probed 2026-09-26 via source inspection):
 *   +scope (servers)     → {cast, hint, intent, latencyMs, resolvedBy, scope}
 *   +scope (categories)  → {cast, hint, intent, latencyMs, resolvedBy, scope}
 *   +scope+explain       → {cast, explanation, hint, intent, latencyMs, resolvedBy, scope}
 *   +scope+focus         → {cast, hint, intent, latencyMs, resolvedBy, scope, suggestions}
 *   base (no scope)      → {cast, hint, intent, latencyMs, resolvedBy}  (absence guard)
 *
 * GBK freezes:
 *   GBK-1  +scope (servers only) adds exactly `scope` to the base no_match key set
 *   GBK-2  +scope (categories only) also yields exactly base + `scope`
 *   GBK-3  +scope+explain → base + `scope` + `explanation`
 *   GBK-4  +scope+focus   → base + `scope` + `suggestions`
 *   GBK-5  absence guard  — no `scope` without scope param; base matches GU exactly
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

const NO_MATCH_SCOPE: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'scope',
];

const NO_MATCH_SCOPE_EXPLAIN: readonly string[] = [
  'cast', 'explanation', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'scope',
];

const NO_MATCH_SCOPE_FOCUS: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'scope', 'suggestions',
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
  return join(tmpdir(), `ch1tty-gbk-${Date.now()}-${++_seq}.jsonl`);
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

/** Invoke cast with a nonsense intent + nonexistent scope that reliably produces cast:no_match. */
async function castNoMatchScoped(
  agg: Aggregator,
  scope: Record<string, unknown>,
  extras: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const args: Record<string, unknown> = {
    intent: 'zzzzzzz_gbk_unique_no_match_99999',
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

// ── GBK-1: +scope (servers) adds exactly `scope` to the base key set ──────────

test('GBK-1: cast:no_match +scope(servers) has exactly base keys + scope', async () => {
  const agg = makeAgg();
  try {
    const body = await castNoMatchScoped(agg, { servers: ['nonexistent-server'] });
    assertExactKeys(body, NO_MATCH_SCOPE, 'cast:no_match +scope(servers)');
    assert.equal(typeof body.scope, 'object', 'scope must be an object');
    assert.notEqual(body.scope, null, 'scope must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GBK-2: +scope (categories) also yields exactly base + `scope` ────────────

test('GBK-2: cast:no_match +scope(categories) has exactly base keys + scope', async () => {
  const agg = makeAgg();
  try {
    const body = await castNoMatchScoped(agg, { categories: ['nonexistent-category'] });
    assertExactKeys(body, NO_MATCH_SCOPE, 'cast:no_match +scope(categories)');
    assert.equal(typeof body.scope, 'object', 'scope must be an object');
    assert.notEqual(body.scope, null, 'scope must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GBK-3: +scope+explain → base + `scope` + `explanation` ───────────────────

test('GBK-3: cast:no_match +scope+explain has exactly base keys + scope + explanation', async () => {
  const agg = makeAgg();
  try {
    const body = await castNoMatchScoped(agg, { servers: ['nonexistent-server'] }, { explain: true });
    assertExactKeys(body, NO_MATCH_SCOPE_EXPLAIN, 'cast:no_match +scope+explain');
    assert.equal(typeof body.explanation, 'object', 'explanation must be an object');
    assert.notEqual(body.explanation, null, 'explanation must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GBK-4: +scope+focus → base + `scope` + `suggestions` ─────────────────────

test('GBK-4: cast:no_match +scope+focus has exactly base keys + scope + suggestions', async () => {
  const agg = makeAgg({ focus: 'code' });
  try {
    const body = await castNoMatchScoped(agg, { servers: ['nonexistent-server'] });
    assertExactKeys(body, NO_MATCH_SCOPE_FOCUS, 'cast:no_match +scope+focus');
    assert.equal(typeof body.suggestions, 'object', 'suggestions must be an object');
    assert.notEqual(body.suggestions, null, 'suggestions must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GBK-5: absence guard — no `scope` without scope param; base matches GU ───

test('GBK-5: cast:no_match without scope has no scope key (base matches GU exactly)', async () => {
  const agg = makeAgg();
  try {
    const args: Record<string, unknown> = { intent: 'zzzzzzz_gbk_unique_no_match_99999' };
    const result = await agg.callTool('ch1tty/cast', args);
    assert.equal(result.isError, undefined, 'cast must not return isError');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body.cast, 'no_match', `expected cast:no_match but got cast:${body.cast}`);
    assertExactKeys(body, NO_MATCH_BASE, 'cast:no_match without scope (absence guard)');
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'scope'),
      false,
      'cast:no_match without scope param must not include scope',
    );
  } finally {
    await agg.shutdown();
  }
});
