/**
 * GEL drift guard: freeze cast:resolved (dryRun) exact top-level key set
 * when BOTH focus AND scope are active simultaneously.
 *
 * Prior coverage:
 *   GCH-3  focus + session + scope → 8 keys (focus∧session∧scope)
 *   GEK-1..4 scope without focus → 6–8 keys
 *   GEE-3  focus + explain (no scope) → 7 keys
 *
 * Remaining gap: no test freezes the exact key set when focus AND scope are
 * active together without a session, or with explain, or the maximal 9-key
 * combination (focus + scope + session + explain all active). A regression
 * that drops `focus` when scope is also active, or injects a spurious key
 * under the combined load, passes GCH/GEK/GEE silently.
 *
 * Source shape (src-stdio/aggregator.ts ~1564):
 *   { cast: 'resolved', resolvedBy, intent, latencyMs,
 *     ...(focusName   ? { focus }       : {}),
 *     ...(scopeAnnot  ? { scope }       : {}),
 *     ...(explanation ? { explanation } : {}),
 *     resolved: { tool, score },
 *     ...(resolvedCtx ? { sessionContext } : {}),
 *   }
 *
 * Probed 2026-10-01:
 *   focus + scope (no session, no explain)        → 7 keys
 *   focus + scope + explain (no session)          → 8 keys
 *   focus + scope + session + explain (maximal)   → 9 keys
 *
 * GEL freezes:
 *
 *   GEL-1: focus + scope (no session, no explain) → EXACTLY 7 keys
 *          {cast, focus, intent, latencyMs, resolved, resolvedBy, scope}
 *          (GCH-1 + scope; no-session, no-explain baseline with both active)
 *
 *   GEL-2: focus + scope + explain (no session) → EXACTLY 8 keys
 *          GEL-1 + explanation
 *          (GEE-3 + scope; confirms scope, explanation, and focus all co-exist)
 *
 *   GEL-3: focus + scope + session + explain (maximal) → EXACTLY 9 keys
 *          GEL-1 + explanation + sessionContext
 *          (All 4 conditionals simultaneously; guards against any one blocking
 *           another or leaking an extra key under combined load.)
 *
 *   GEL-4: focus active, NO scope → `scope` ABSENT
 *          (Symmetric absence: when focus is active but no scope arg is passed,
 *           `scope` must not appear; guards against focus path leaking scope.)
 *
 *   GEL-5: focus + scope, NO explain → `explanation` ABSENT
 *          (Symmetric absence: `explanation` must not appear under focus+scope
 *           when explain is not passed; guards against combined-conditional leak.)
 *
 * All tests use a focus-active Aggregator (FixtureBackend + focus: 'code').
 * Scope is passed as { servers: ['neon'] }.
 *
 * Frozen 2026-10-01.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level resolved
 *     key set, not explain sub-object fields)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Frozen exact key sets ─────────────────────────────────────────────────────

// GEL-1: focus + scope (no session, no explain) — 7 keys
const RESOLVED_FOCUS_SCOPE: readonly string[] = [
  'cast', 'focus', 'intent', 'latencyMs', 'resolved', 'resolvedBy', 'scope',
];

// GEL-2: focus + scope + explain (no session) — 8 keys
const RESOLVED_FOCUS_SCOPE_EXPLAIN: readonly string[] = [
  ...RESOLVED_FOCUS_SCOPE, 'explanation',
];

// GEL-3: focus + scope + session + explain (maximal) — 9 keys
const RESOLVED_FOCUS_SCOPE_SESSION_EXPLAIN: readonly string[] = [
  ...RESOLVED_FOCUS_SCOPE, 'explanation', 'sessionContext',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;
function makeDlq(): string {
  return join(tmpdir(), `ch1tty-gel-${Date.now()}-${++_seq}.jsonl`);
}

const NEON_CFG: ServerConfig = {
  id: 'neon',
  name: 'Neon Database',
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

function makeFocusAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  return new Aggregator([NEON_CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: makeDlq(),
    focus: 'code',
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: {},
  });
}

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

async function castResolved(
  agg: Aggregator,
  extras: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    dryRun: true,
    ...extras,
  });
  assert.equal(result.isError, undefined, 'cast must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥ 1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(
    body['cast'],
    'resolved',
    `expected cast:resolved, got cast="${String(body['cast'])}"`,
  );
  return body;
}

// ── GEL-1: focus + scope (no session, no explain) → EXACTLY 7 keys ────────────

test('GEL-1: focus+scope (no session, no explain) → EXACTLY {cast,focus,intent,latencyMs,resolved,resolvedBy,scope}', async () => {
  const agg = makeFocusAgg();
  try {
    const body = await castResolved(agg, { scope: { servers: ['neon'] } });
    assertExactKeys(body, RESOLVED_FOCUS_SCOPE, 'GEL-1 focus+scope (no session, no explain)');
    assert.equal(body['focus'], 'code', 'GEL-1: focus must equal active profile name');
    assert.equal(typeof body['scope'], 'object', 'GEL-1: scope must be an object');
    assert.notEqual(body['scope'], null, 'GEL-1: scope must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GEL-2: focus + scope + explain (no session) → EXACTLY 8 keys ─────────────

test('GEL-2: focus+scope+explain (no session) → EXACTLY {cast,explanation,focus,intent,latencyMs,resolved,resolvedBy,scope}', async () => {
  const agg = makeFocusAgg();
  try {
    const body = await castResolved(agg, { scope: { servers: ['neon'] }, explain: true });
    assertExactKeys(body, RESOLVED_FOCUS_SCOPE_EXPLAIN, 'GEL-2 focus+scope+explain (no session)');
    assert.equal(body['focus'], 'code', 'GEL-2: focus must equal active profile name');
    assert.equal(typeof body['scope'], 'object', 'GEL-2: scope must be an object');
    assert.notEqual(body['scope'], null, 'GEL-2: scope must not be null');
    assert.equal(typeof body['explanation'], 'object', 'GEL-2: explanation must be an object');
    assert.notEqual(body['explanation'], null, 'GEL-2: explanation must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GEL-3: focus + scope + session + explain (maximal) → EXACTLY 9 keys ───────

test('GEL-3: focus+scope+session+explain (maximal) → EXACTLY 9 keys {cast,explanation,focus,intent,latencyMs,resolved,resolvedBy,scope,sessionContext}', async () => {
  const agg = makeFocusAgg();
  try {
    const body = await castResolved(agg, {
      scope: { servers: ['neon'] },
      sessionId: 'gel-session-3',
      explain: true,
    });
    assertExactKeys(body, RESOLVED_FOCUS_SCOPE_SESSION_EXPLAIN, 'GEL-3 focus+scope+session+explain (maximal)');
    assert.equal(body['focus'], 'code', 'GEL-3: focus must equal active profile name');
    assert.equal(typeof body['scope'], 'object', 'GEL-3: scope must be an object');
    assert.notEqual(body['scope'], null, 'GEL-3: scope must not be null');
    assert.equal(typeof body['explanation'], 'object', 'GEL-3: explanation must be an object');
    assert.notEqual(body['explanation'], null, 'GEL-3: explanation must not be null');
    assert.equal(typeof body['sessionContext'], 'object', 'GEL-3: sessionContext must be an object');
    assert.notEqual(body['sessionContext'], null, 'GEL-3: sessionContext must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GEL-4: focus active, no scope → `scope` ABSENT ───────────────────────────

test('GEL-4: focus active, no scope → scope key ABSENT', async () => {
  const agg = makeFocusAgg();
  try {
    const body = await castResolved(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'scope'),
      false,
      `GEL-4: scope must be absent when no scope param; got keys: ${JSON.stringify(Object.keys(body))}`,
    );
    assert.equal(body['focus'], 'code', 'GEL-4: focus must still be present when scope is absent');
  } finally {
    await agg.shutdown();
  }
});

// ── GEL-5: focus + scope, no explain → `explanation` ABSENT ──────────────────

test('GEL-5: focus+scope, no explain → explanation key ABSENT', async () => {
  const agg = makeFocusAgg();
  try {
    const body = await castResolved(agg, { scope: { servers: ['neon'] } });
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'explanation'),
      false,
      `GEL-5: explanation must be absent when explain not passed; got keys: ${JSON.stringify(Object.keys(body))}`,
    );
    assert.equal(body['focus'], 'code', 'GEL-5: focus must be present');
    assert.equal(typeof body['scope'], 'object', 'GEL-5: scope must be present');
  } finally {
    await agg.shutdown();
  }
});
