/**
 * GEF drift guard: freeze cast:resolved exact top-level key set when BOTH
 * a catalog combo matches AND explain:true is set.
 *
 * Prior tests cover these two conditionals independently:
 *
 *   GEA froze cast:resolved + catalogCombo key sets (4 variants: no session/scope,
 *       with session, with scope, with scope+session) — all WITHOUT explain.
 *
 *   GEE froze cast:resolved + explain key sets (no-focus, focus:code — no catalogCombo
 *       in either case) — GEE-3 covers focus+explain but suppresses catalogCombo by
 *       passing `suggestionsCatalog: {}`.
 *
 * Neither test covers the three-way combination: focus ∧ catalogCombo ∧ explain.
 * A regression that:
 *   (a) drops `explanation` from the resolved response when catalogCombo is also
 *       present (treating explain:true as incompatible with the catalog path), or
 *   (b) injects an extra key (e.g. `chainContinuation`, `suggestions`) only when
 *       both catalogCombo and explain are active,
 *   (c) drops `catalogCombo` when explain:true is set (incorrectly exclusive), or
 *   (d) accidentally adds `scope` or `sessionContext` when neither was requested,
 * would pass GEA (which never sets explain) and GEE (which never triggers catalogCombo).
 *
 * Actual resolved body construction (aggregator.ts ~line 1564):
 *   { cast: 'resolved', resolvedBy, intent, latencyMs,
 *     ...(focusName        ? { focus }        : {}),
 *     ...(scopeAnnotation  ? { scope }         : {}),
 *     ...(explanation      ? { explanation }   : {}),
 *     resolved: { tool, score },
 *     ...(catalogCombo     ? { catalogCombo }  : {}),
 *     ...(resolvedCtx      ? { sessionContext } : {}),
 *   }
 *
 * GEF freezes:
 *
 *   GEF-1  focus + catalogCombo + explain (no session, no scope) → EXACTLY
 *          {cast, catalogCombo, explanation, focus, intent, latencyMs,
 *           resolved, resolvedBy} — 8 keys
 *          (GEA-1 base + explanation; both catalogCombo and explanation must
 *           coexist without any extra key appearing)
 *
 *   GEF-2  focus + catalogCombo + explain + session → GEF-1 + sessionContext
 *          — 9 keys
 *          (GEA-2 base + explanation; confirms the three-way: catalog ∧ explain
 *           ∧ session all compose cleanly)
 *
 *   GEF-3  focus + catalogCombo + explain + scope → GEF-1 + scope — 9 keys
 *          (GEA-3 base + explanation; closes catalog ∧ explain ∧ scope)
 *
 *   GEF-4  focus + catalogCombo + explain + scope + session → GEF-1 + scope +
 *          sessionContext — 10 keys
 *          (GEA-4 base + explanation; all five conditional fields composed)
 *
 *   GEF-5  `explanation` is ABSENT from cast:resolved WITH catalogCombo when
 *          explain is NOT set — symmetric absence guard.
 *          (GEA-1 shows catalogCombo present without explanation; GEF-5 is an
 *           explicit guard that re-confirms `explanation` is absent in that
 *           baseline, closing the symmetric risk that GEF-1–4 might only test
 *           the presence path without guarding the absence path)
 *
 * Fixture: identical to GEA — single neon server, 1-step catalog combo starting
 * at `neon/list_projects`. Intent "list neon projects" reliably resolves to
 * neon/list_projects via keyword scoring. KeywordOnlyCoordinator disables the
 * brain route for determinism. suggestionsCatalog has 'code' entry — matched
 * by focus:'code'.
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level cast:resolved
 *     key set presence/absence, not the explanation sub-object fields)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Frozen exact key sets ─────────────────────────────────────────────────────

// GEF-1: focus + catalogCombo + explain (no session, no scope) — 8 keys.
const RESOLVED_CATALOG_EXPLAIN_BASE: readonly string[] = [
  'cast', 'catalogCombo', 'explanation', 'focus', 'intent', 'latencyMs', 'resolved', 'resolvedBy',
];

// GEF-2: GEF-1 + sessionContext — 9 keys.
const RESOLVED_CATALOG_EXPLAIN_SESSION: readonly string[] = [
  ...RESOLVED_CATALOG_EXPLAIN_BASE, 'sessionContext',
];

// GEF-3: GEF-1 + scope — 9 keys.
const RESOLVED_CATALOG_EXPLAIN_SCOPE: readonly string[] = [
  ...RESOLVED_CATALOG_EXPLAIN_BASE, 'scope',
];

// GEF-4: GEF-1 + scope + sessionContext — 10 keys.
const RESOLVED_CATALOG_EXPLAIN_SCOPE_SESSION: readonly string[] = [
  ...RESOLVED_CATALOG_EXPLAIN_BASE, 'scope', 'sessionContext',
];

// ── Fixture definitions ───────────────────────────────────────────────────────

const BASE_CONFIG: ServerConfig = {
  id: 'neon',
  name: 'Neon DB',
  type: 'remote',
  access: 'readwrite',
  category: 'code',
  endpoint: 'https://neon.test/mcp',
  lazy: true,
};

// A one-step catalog combo starting at neon/list_projects — triggers catalogCombo
// in cast:resolved when focus:'code' is active and the intent matches.
const GEF_CATALOG = {
  code: {
    description: 'Code focus profile for testing',
    combos: [
      {
        name: 'neon-list',
        chain: ['neon/list_projects'],
        accomplishes: 'List all Neon projects',
        verified: true,
      },
    ],
    prompts: [],
  },
};

const GEF_FOCUS_PROFILES = {
  profiles: {
    code: { categories: ['code'], servers: [], boost: 0.5 },
  },
};

const INTENT = 'list neon projects';

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gef-${Date.now()}-${++_seq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

function makeBackend(): FixtureBackend {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [
      {
        name: 'list_projects',
        description: 'List all neon database projects',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '["proj-1","proj-2"]' }] },
      },
    ],
    prompts: [],
    resources: [],
  });
  return backend;
}

function makeAgg(): Aggregator {
  const path = dlq();
  return new Aggregator([BASE_CONFIG], {
    backendFactory: () => makeBackend(),
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: GEF_CATALOG,
    focus: 'code',
    focusProfiles: GEF_FOCUS_PROFILES,
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  } as Parameters<typeof Aggregator.prototype.callTool>[1]);
}

/** Assert exact sorted key set with a descriptive failure message. */
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

/** Call cast with dryRun:true and assert the result is cast:resolved with catalogCombo present. */
async function castResolved(
  agg: Aggregator,
  extras: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  if (typeof extras['sessionId'] === 'string') {
    await agg.callTool('ch1tty/cast', { intent: INTENT, dryRun: true, sessionId: extras['sessionId'] });
  }
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, dryRun: true, ...extras });
  assert.equal((result as { isError?: unknown }).isError, undefined, 'cast must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(
    body['cast'],
    'resolved',
    `expected cast:resolved, got cast="${String(body['cast'])}"`,
  );
  return body;
}

// ── GEF-1: focus + catalogCombo + explain (no session, no scope) ─────────────

test('GEF-1: cast:resolved WITH catalogCombo + explain (no session, no scope) has EXACTLY {cast,catalogCombo,explanation,focus,intent,latencyMs,resolved,resolvedBy}', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg, { explain: true });
    assert.ok(
      'catalogCombo' in body,
      `catalogCombo must be present; got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    assert.ok(
      'explanation' in body,
      `explanation must be present when explain:true; got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    assertExactKeys(body, RESOLVED_CATALOG_EXPLAIN_BASE, 'GEF-1 focus+catalogCombo+explain (no session, no scope)');
    assert.equal(typeof body['explanation'], 'object', 'explanation must be an object');
    assert.notEqual(body['explanation'], null, 'explanation must not be null');
    assert.equal(body['focus'], 'code', 'focus must equal the active profile name');
  } finally {
    await agg.shutdown();
  }
});

// ── GEF-2: focus + catalogCombo + explain + session ──────────────────────────

test('GEF-2: cast:resolved WITH catalogCombo + explain + session has EXACTLY GEF-1 set + sessionContext', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg, { explain: true, sessionId: 'gef-session-2' });
    assert.ok(
      'catalogCombo' in body,
      `catalogCombo must be present; got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    assert.ok(
      'explanation' in body,
      `explanation must be present; got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    assertExactKeys(body, RESOLVED_CATALOG_EXPLAIN_SESSION, 'GEF-2 focus+catalogCombo+explain+session');
    assert.equal(typeof body['sessionContext'], 'object', 'sessionContext must be an object');
    assert.notEqual(body['sessionContext'], null, 'sessionContext must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GEF-3: focus + catalogCombo + explain + scope ────────────────────────────

test('GEF-3: cast:resolved WITH catalogCombo + explain + scope has EXACTLY GEF-1 set + scope', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg, { explain: true, scope: { servers: ['neon'] } });
    assert.ok(
      'catalogCombo' in body,
      `catalogCombo must be present; got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    assert.ok(
      'explanation' in body,
      `explanation must be present; got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    assertExactKeys(body, RESOLVED_CATALOG_EXPLAIN_SCOPE, 'GEF-3 focus+catalogCombo+explain+scope');
    assert.equal(typeof body['scope'], 'object', 'scope must be an object');
  } finally {
    await agg.shutdown();
  }
});

// ── GEF-4: focus + catalogCombo + explain + scope + session ──────────────────

test('GEF-4: cast:resolved WITH catalogCombo + explain + scope + session has EXACTLY GEF-1 set + scope + sessionContext', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg, {
      explain: true,
      scope: { servers: ['neon'] },
      sessionId: 'gef-session-4',
    });
    assert.ok(
      'catalogCombo' in body,
      `catalogCombo must be present; got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    assert.ok(
      'explanation' in body,
      `explanation must be present; got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    assertExactKeys(body, RESOLVED_CATALOG_EXPLAIN_SCOPE_SESSION, 'GEF-4 focus+catalogCombo+explain+scope+session');
    assert.equal(typeof body['scope'], 'object', 'scope must be an object');
    assert.equal(typeof body['sessionContext'], 'object', 'sessionContext must be an object');
    assert.notEqual(body['sessionContext'], null, 'sessionContext must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GEF-5: `explanation` ABSENT when explain NOT set (with catalogCombo active) ──

test('GEF-5: `explanation` absent from cast:resolved WITH catalogCombo when explain is NOT set', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg);
    assert.ok(
      'catalogCombo' in body,
      `catalogCombo must be present in baseline; got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'explanation'),
      false,
      `explanation must be ABSENT when explain param is not set (even with catalogCombo active); ` +
      `got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
  } finally {
    await agg.shutdown();
  }
});
