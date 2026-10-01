/**
 * GEL drift guard: freeze cast:resolved exact top-level key set when
 * focus + scope + explain are all active — with and without a session.
 *
 * Prior test coverage of cast:resolved conditional fields:
 *
 *   GU-3/4   no focus, no scope, no explain  → base {cast,intent,latencyMs,resolved,resolvedBy}
 *            + optional sessionContext
 *   GBM-3    no focus + scope + explain       → base + scope + explanation (7 keys)
 *   GBM-4    no focus + scope + focus         → base + scope + focus (7 keys)
 *   GCH-3    focus + session + scope          → base + focus + scope + sessionContext (8 keys)
 *   GCH-4    focus + session + explain        → base + focus + explanation + sessionContext (8 keys)
 *   GEE-3    focus + explain (no scope)       → base + focus + explanation (7 keys)
 *   GEF-1/4  focus + catalogCombo + explain + (scope + session variants) → 8–10 keys
 *
 * Coverage gap:
 *   No test freezes the exact key set when focus + scope + explain are all active
 *   WITHOUT a catalogCombo. GCH-3 has scope but not explain. GCH-4 has explain but
 *   not scope. GEF-3/4 have scope + explain but always with catalogCombo. A regression
 *   that accidentally drops `explanation` when `scope` is set (or vice-versa) on the
 *   non-catalog focus path would pass every prior drift guard.
 *
 * Source (src-stdio/aggregator.ts ~line 1564):
 *   cast:resolved body (dryRun path) =
 *     { cast, resolvedBy, intent, latencyMs,
 *       ...(focusName        ? { focus }        : {}),
 *       ...(scopeAnnotation  ? { scope }         : {}),
 *       ...(explanation      ? { explanation }   : {}),
 *       resolved: { tool, score },
 *       ...(catalogCombo     ? { catalogCombo }  : {}),   // absent: suggestionsCatalog:{}
 *       ...(resolvedCtx      ? { sessionContext } : {}),
 *     }
 *
 * GEL freezes:
 *
 *   GEL-1  focus + scope + explain (no session, no catalogCombo) →
 *          EXACTLY {cast, explanation, focus, intent, latencyMs, resolved,
 *                   resolvedBy, scope} — 8 keys
 *          (GBM-3 had scope+explain without focus; GEE-3 had focus+explain without
 *           scope; this closes the three-way: focus ∧ scope ∧ explain, no session)
 *
 *   GEL-2  focus + scope + explain + session (no catalogCombo) →
 *          EXACTLY GEL-1 + sessionContext — 9 keys
 *          (GCH-3: focus+session+scope no explain; GCH-4: focus+session+explain no
 *           scope; neither covers the four-way composition without catalogCombo)
 *
 *   GEL-3  `explanation` is a non-null object in the GEL-2 combo
 *          (confirms the explanation spread fires and produces a real sub-object;
 *           a regression that produces undefined/null would pass GEL-2 if key
 *           presence were somehow preserved)
 *
 *   GEL-4  sessionContext.recentTools is Array + callCount is number in GEL-2 combo
 *          (structural guard on the sessionContext sub-object in the four-way path)
 *
 *   GEL-5  `catalogCombo` is ABSENT from GEL-2 combo
 *          (absence guard — confirms that suppressing catalogCombo via empty
 *           suggestionsCatalog works correctly in the focus+scope+explain+session
 *           path; guards against a regression that injects catalogCombo unconditionally)
 *
 * Fixture: single neon server (lazy remote), focus:'code', suggestionsCatalog:{}.
 * Intent "list neon projects" reliably resolves to neon/list_projects via keyword scoring.
 * scope: { servers: ['neon'] } keeps neon in scope and triggers scopeAnnotation.
 * KeywordOnlyCoordinator disables brain routing for determinism.
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level cast:resolved
 *     key set presence/absence, not the explanation sub-object statistical fields)
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

// GEL-1: focus + scope + explain, no session, no catalogCombo.
const RESOLVED_FOCUS_SCOPE_EXPLAIN: readonly string[] = [
  'cast', 'explanation', 'focus', 'intent', 'latencyMs', 'resolved', 'resolvedBy', 'scope',
];

// GEL-2: focus + scope + explain + session, no catalogCombo.
const RESOLVED_FOCUS_SCOPE_EXPLAIN_SESSION: readonly string[] = [
  ...RESOLVED_FOCUS_SCOPE_EXPLAIN, 'sessionContext',
];

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NEON_CONFIG: ServerConfig = {
  id: 'neon',
  name: 'Neon DB',
  type: 'remote',
  access: 'readwrite',
  category: 'code',
  endpoint: 'https://neon.tech/mcp',
  lazy: true,
};

const FOCUS_PROFILES = {
  profiles: {
    code: { categories: ['code'], servers: [], boost: 0.5 },
  },
};

// Empty catalog — no catalogCombo will match; focus stays active but catalogCombo is null.
const CATALOG_EMPTY: Record<string, unknown> = {};

// Scope that keeps neon in scope (triggers scopeAnnotation in the resolved body).
const SCOPE_NEON = { servers: ['neon'] };

const INTENT = 'list neon projects';

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gel-${Date.now()}-${++_seq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

function makeAgg(): Aggregator {
  const path = dlq();
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  return new Aggregator([NEON_CONFIG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    focus: 'code',
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: CATALOG_EMPTY,
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

/** Assert exact sorted key set. */
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
    `${label}: key set mismatch.\n  expected: ${JSON.stringify(exp)}\n  actual:   ${JSON.stringify(actual)}`,
  );
}

/** Call cast:resolved (dryRun:true) and assert cast === 'resolved'. */
async function castResolved(
  agg: Aggregator,
  extras: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  // Warm the session so coordinator.hasSession is true before the main call.
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

// ── GEL-1: focus + scope + explain (no session, no catalogCombo) ─────────────

test('GEL-1: cast:resolved focus+scope+explain (no session) has EXACTLY 8 keys (base + focus + scope + explanation)', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg, { scope: SCOPE_NEON, explain: true });
    assertExactKeys(body, RESOLVED_FOCUS_SCOPE_EXPLAIN, 'GEL-1 focus+scope+explain no session');

    assert.ok(
      typeof body['focus'] === 'string' && (body['focus'] as string).length > 0,
      'focus must be a non-empty string',
    );
    assert.ok(
      typeof body['scope'] === 'object' && body['scope'] !== null,
      'scope must be a non-null object',
    );
    assert.ok(
      typeof body['explanation'] === 'object' && body['explanation'] !== null,
      'explanation must be a non-null object',
    );
    // catalogCombo must NOT be present — empty catalog.
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'catalogCombo'),
      false,
      'catalogCombo must be absent when suggestionsCatalog is empty',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEL-2: focus + scope + explain + session (no catalogCombo) ───────────────

test('GEL-2: cast:resolved focus+scope+explain+session (no catalogCombo) has EXACTLY 9 keys', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg, {
      scope: SCOPE_NEON,
      explain: true,
      sessionId: 'gel-session-2',
    });
    assertExactKeys(body, RESOLVED_FOCUS_SCOPE_EXPLAIN_SESSION, 'GEL-2 focus+scope+explain+session');

    assert.ok(
      typeof body['focus'] === 'string' && (body['focus'] as string).length > 0,
      'focus must be present as non-empty string',
    );
    assert.ok(
      typeof body['scope'] === 'object' && body['scope'] !== null,
      'scope must be present as non-null object',
    );
    assert.ok(
      typeof body['explanation'] === 'object' && body['explanation'] !== null,
      'explanation must be present as non-null object',
    );
    assert.ok(
      typeof body['sessionContext'] === 'object' && body['sessionContext'] !== null,
      'sessionContext must be present as non-null object',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEL-3: explanation is a non-null object in the four-way combo ─────────────

test('GEL-3: explanation is a non-null object with a string method key in GEL-2 combo', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg, {
      scope: SCOPE_NEON,
      explain: true,
      sessionId: 'gel-session-3',
    });

    const explanation = body['explanation'] as Record<string, unknown>;
    assert.ok(
      typeof explanation === 'object' && explanation !== null,
      'explanation must be a non-null object',
    );
    assert.ok(
      typeof explanation['method'] === 'string' && (explanation['method'] as string).length > 0,
      'explanation.method must be a non-empty string',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEL-4: sessionContext structural guard in four-way combo ──────────────────

test('GEL-4: sessionContext.recentTools is Array and callCount is number in GEL-2 combo', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg, {
      scope: SCOPE_NEON,
      explain: true,
      sessionId: 'gel-session-4',
    });

    const ctx = body['sessionContext'] as Record<string, unknown>;
    assert.ok(
      typeof ctx === 'object' && ctx !== null,
      'sessionContext must be a non-null object',
    );
    assert.ok(
      Array.isArray(ctx['recentTools']),
      'sessionContext.recentTools must be an Array',
    );
    assert.ok(
      typeof ctx['callCount'] === 'number',
      'sessionContext.callCount must be a number',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEL-5: catalogCombo absent from focus+scope+explain+session combo ─────────

test('GEL-5: catalogCombo is ABSENT from cast:resolved when suggestionsCatalog is empty', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg, {
      scope: SCOPE_NEON,
      explain: true,
      sessionId: 'gel-session-5',
    });

    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'catalogCombo'),
      false,
      'catalogCombo must not appear when no catalog entry exists for the active focus',
    );
    // Confirm the other four conditionals ARE all present (test is exercising the right path).
    assert.ok('focus' in body, 'focus must be present');
    assert.ok('scope' in body, 'scope must be present');
    assert.ok('explanation' in body, 'explanation must be present');
    assert.ok('sessionContext' in body, 'sessionContext must be present');
  } finally {
    await agg.shutdown();
  }
});
