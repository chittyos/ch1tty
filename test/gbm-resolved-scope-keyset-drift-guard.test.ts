/**
 * GBM drift guard: freeze cast:resolved exact top-level key set when the
 * `scope` parameter is set (servers and/or categories filter).
 *
 * GU froze the base resolved key set without scope: {cast, intent, latencyMs,
 * resolved, resolvedBy} — GU-3. GU-4 froze +sessionId → base + sessionContext.
 * No test freezes the exact key set of cast:resolved when scope is active.
 *
 * A regression that injects or drops a top-level field in the scope=present
 * resolved path would pass GU, GI, GU-4, and all prior tests silently.
 *
 * Complementing GBK (which froze cast:no_match +scope exact key sets), GBM
 * freezes the analogous shapes for cast:resolved (dryRun:true).
 *
 * Source (src-stdio/aggregator.ts ~line 1565 dryRun path):
 *   cast:resolved body =
 *     { cast, resolvedBy, intent, latencyMs,
 *       ...(focusName        ? { focus }        : {}),
 *       ...(scopeAnnotation  ? { scope }         : {}),
 *       ...(explanation      ? { explanation }   : {}),
 *       resolved: { tool, score },
 *       ...(catalogCombo     ? { catalogCombo }  : {}),  // absent: no catalog injected
 *       ...(resolvedSessionContext ? { sessionContext } : {}),
 *     }
 *
 * Actual key sets (probed 2026-09-26 via source inspection; no suggestions catalog):
 *   +scope (servers: neon)      → {cast, intent, latencyMs, resolved, resolvedBy, scope}
 *   +scope (categories: code)   → {cast, intent, latencyMs, resolved, resolvedBy, scope}
 *   +scope+explain              → {cast, explanation, intent, latencyMs, resolved, resolvedBy, scope}
 *   +scope+focus (code)         → {cast, focus, intent, latencyMs, resolved, resolvedBy, scope}
 *   base (no scope)             → {cast, intent, latencyMs, resolved, resolvedBy}  (absence guard)
 *
 * GBM freezes:
 *   GBM-1  +scope (servers: neon) adds exactly `scope` to the GU-3 base key set
 *   GBM-2  +scope (categories: code) also yields exactly base + `scope`
 *   GBM-3  +scope+explain → base + `scope` + `explanation`
 *   GBM-4  +scope+focus   → base + `scope` + `focus`
 *   GBM-5  absence guard  — no `scope` without scope param; base matches GU-3 exactly
 *
 * Catalog isolation: suggestionsCatalog is explicitly empty — no catalogCombo
 * appears in any resolved body (avoids a non-deterministic extra key from
 * catalog matching, so the exact freeze is stable regardless of CWD state).
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
import type { FocusProfile, FocusProfiles } from '../src/focus.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Frozen exact key sets ──────────────────────────────────────────────────────

const RESOLVED_BASE: readonly string[] = [
  'cast', 'intent', 'latencyMs', 'resolved', 'resolvedBy',
];

const RESOLVED_SCOPE: readonly string[] = [
  'cast', 'intent', 'latencyMs', 'resolved', 'resolvedBy', 'scope',
];

const RESOLVED_SCOPE_EXPLAIN: readonly string[] = [
  'cast', 'explanation', 'intent', 'latencyMs', 'resolved', 'resolvedBy', 'scope',
];

const RESOLVED_SCOPE_FOCUS: readonly string[] = [
  'cast', 'focus', 'intent', 'latencyMs', 'resolved', 'resolvedBy', 'scope',
];

// ── Inline focus profile (avoid dependency on focus-profiles.json at CWD) ─────

const CODE_FOCUS_PROFILE: FocusProfile = {
  description: 'Software development tools',
  categories: ['code'],
  servers: ['neon'],
  boost: 0.5,
};

const CODE_FOCUS_PROFILES: FocusProfiles = {
  profiles: { code: CODE_FOCUS_PROFILE },
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
  return join(tmpdir(), `ch1tty-gbm-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(opts: { focus?: string } = {}): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    focusProfiles: CODE_FOCUS_PROFILES,
    suggestionsCatalog: {},
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
 * Invoke cast:resolved (dryRun:true) with optional scope and extra args.
 * Intent 'list neon projects' reliably resolves to neon/list_projects when
 * neon is in scope (or when no scope filter is applied).
 */
async function castResolved(
  agg: Aggregator,
  opts: { scope?: Record<string, unknown>; extras?: Record<string, unknown> } = {},
): Promise<Record<string, unknown>> {
  const args: Record<string, unknown> = {
    intent: 'list neon projects',
    dryRun: true,
    ...(opts.scope !== undefined ? { scope: opts.scope } : {}),
    ...(opts.extras ?? {}),
  };
  const result = await agg.callTool('ch1tty/cast', args);
  assert.equal(result.isError, undefined, 'cast must not return isError');
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body.cast, 'resolved',
    `expected cast:resolved but got cast:${body.cast}; scope may have excluded the matching neon tool`);
  return body;
}

// ── GBM-1: +scope (servers: neon) adds exactly `scope` ───────────────────────

test('GBM-1: cast:resolved +scope(servers:neon) has exactly base keys + scope', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg, { scope: { servers: ['neon'] } });
    assertExactKeys(body, RESOLVED_SCOPE, 'cast:resolved +scope(servers:neon)');
    assert.equal(typeof body.scope, 'object', 'scope must be an object');
    assert.notEqual(body.scope, null, 'scope must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GBM-2: +scope (categories: code) yields exactly base + `scope` ───────────

test('GBM-2: cast:resolved +scope(categories:code) has exactly base keys + scope', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg, { scope: { categories: ['code'] } });
    assertExactKeys(body, RESOLVED_SCOPE, 'cast:resolved +scope(categories:code)');
    assert.equal(typeof body.scope, 'object', 'scope must be an object');
    assert.notEqual(body.scope, null, 'scope must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GBM-3: +scope+explain → base + `scope` + `explanation` ───────────────────

test('GBM-3: cast:resolved +scope+explain has exactly base keys + scope + explanation', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg, { scope: { servers: ['neon'] }, extras: { explain: true } });
    assertExactKeys(body, RESOLVED_SCOPE_EXPLAIN, 'cast:resolved +scope+explain');
    assert.equal(typeof body.explanation, 'object', 'explanation must be an object');
    assert.notEqual(body.explanation, null, 'explanation must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GBM-4: +scope+focus → base + `scope` + `focus` ───────────────────────────

test('GBM-4: cast:resolved +scope+focus has exactly base keys + scope + focus', async () => {
  const agg = makeAgg({ focus: 'code' });
  try {
    const body = await castResolved(agg, { scope: { servers: ['neon'] } });
    assertExactKeys(body, RESOLVED_SCOPE_FOCUS, 'cast:resolved +scope+focus');
    assert.equal(typeof body.focus, 'string', 'focus must be a string');
    assert.equal(body.focus, 'code', 'focus must equal the active profile name');
  } finally {
    await agg.shutdown();
  }
});

// ── GBM-5: absence guard — no `scope` without scope param (base matches GU-3) ─

test('GBM-5: cast:resolved without scope has no scope key (base matches GU-3 exactly)', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg);
    assertExactKeys(body, RESOLVED_BASE, 'cast:resolved without scope (absence guard)');
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'scope'),
      false,
      'cast:resolved without scope param must not include scope; ' +
      'a regression injecting scope unconditionally would silently pass GU-3',
    );
  } finally {
    await agg.shutdown();
  }
});
