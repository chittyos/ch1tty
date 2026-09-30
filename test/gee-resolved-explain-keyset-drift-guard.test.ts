/**
 * GEE drift guard: freeze cast:resolved (dryRun) exact top-level key set
 * when explain:true is passed — no-focus and focus paths.
 *
 * GEC froze the resolved top-level key set WITHOUT explain (no catalog combo).
 * GCH-4 froze resolved WITH focus + session + explain.
 * The remaining gap: no test freezes the EXACT key set for cast:resolved
 * when explain:true is set on the NO-FOCUS path, and no test guards the
 * symmetric ABSENCE of `explanation` on the dryRun/resolved path.
 *
 * Actual resolved body construction (aggregator.ts ~line 1564):
 *   { cast: 'resolved', resolvedBy, intent, latencyMs,
 *     ...(focusName   ? { focus }       : {}),
 *     ...(scopeAnnot  ? { scope }       : {}),
 *     ...(explanation ? { explanation } : {}),
 *     resolved: { tool, score },
 *     ...(catalogCombo     ? { catalogCombo }     : {}),
 *     ...(resolvedCtx      ? { sessionContext }   : {}),
 *   }
 *
 * GEE freezes:
 *
 *   GEE-1: resolved, no-focus, no-session, explain:true → EXACTLY
 *          {cast, explanation, intent, latencyMs, resolved, resolvedBy} — 6 keys
 *          (GEC-1 base + explanation; confirms explanation is injected and no
 *           other key appears alongside it when explain:true is passed)
 *
 *   GEE-2: resolved, no-focus, with-session, explain:true → EXACTLY
 *          GEE-1 + sessionContext — 7 keys
 *          (GEC-2 + explanation; confirms both explanation AND sessionContext
 *           appear together with no extra keys)
 *
 *   GEE-3: resolved, focus:code, no-session, explain:true → EXACTLY
 *          {cast, explanation, focus, intent, latencyMs, resolved, resolvedBy} — 7 keys
 *          (GCH-1 + explanation; the no-session focus+explain combination that
 *           GCH-4 doesn't cover — GCH-4 requires focus+session+explain)
 *
 *   GEE-4: resolved, no-focus, no-session, NO explain → `explanation` is ABSENT
 *          (symmetric with GV-3 for cast:executed; guards against a regression
 *           that always injects explanation regardless of the explain param)
 *
 *   GEE-5: explanation sub-object from cast:resolved has a string `method` key
 *          (value-type guard for the most stable field in the explanation object;
 *           catches a regression that injects a non-object or empty object)
 *
 * GEE-1/2/4 use a simple inline Backend (no FixtureBackend) — same pattern as
 * GEC. GEE-3 uses FixtureBackend + focus profiles to trigger the focus path.
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level resolved
 *     key set presence/absence of `explanation`, not the sub-object fields)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Frozen exact key sets ─────────────────────────────────────────────────────

// GEE-1: no focus, no session, explain:true
const RESOLVED_EXPLAIN_BASE: readonly string[] = [
  'cast', 'explanation', 'intent', 'latencyMs', 'resolved', 'resolvedBy',
];

// GEE-2: no focus, with session, explain:true
const RESOLVED_EXPLAIN_SESSION: readonly string[] = [
  ...RESOLVED_EXPLAIN_BASE, 'sessionContext',
];

// GEE-3: focus:code, no session, explain:true
const RESOLVED_FOCUS_EXPLAIN: readonly string[] = [
  'cast', 'explanation', 'focus', 'intent', 'latencyMs', 'resolved', 'resolvedBy',
];

// ── Inline Backend helpers (for no-focus tests) ───────────────────────────────

let _seq = 0;
function makeDlq(): string {
  return join(tmpdir(), `ch1tty-gee-${Date.now()}-${++_seq}.jsonl`);
}

const NEON_CFG: ServerConfig = {
  id: 'neon',
  name: 'Neon Database',
  type: 'remote',
  access: 'readwrite',
  category: 'code',
  endpoint: 'https://neon.test/mcp',
};

const NEON_TOOLS: ToolEntry[] = [
  {
    name: 'list_projects',
    description: 'List Neon projects',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'run_sql',
    description: 'Run SQL query on Neon',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  },
];

function makeBackend(): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: NEON_TOOLS.length, toolCacheAge: 0 }),
    listTools: async () => NEON_TOOLS,
    callTool: async (): Promise<ToolCallResult> => ({
      content: [{ type: 'text', text: 'tool-output' }],
    }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

function makeSimpleAgg(): Aggregator {
  return new Aggregator([NEON_CFG], {
    backendFactory: () => makeBackend(),
    embedEnabled: false,
    ledgerDlqPath: makeDlq(),
  } as Parameters<typeof Aggregator.prototype.callTool>[1]);
}

// ── FixtureBackend helper (for focus path) ────────────────────────────────────

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

function makeFocusAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  return new Aggregator([NEON_CONFIG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: makeDlq(),
    focus: 'code',
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: {},
  });
}

// ── Shared helpers ────────────────────────────────────────────────────────────

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

// ── GEE-1: no-focus, no-session, explain:true → EXACTLY {cast, explanation, intent, latencyMs, resolved, resolvedBy} ──

test('GEE-1: cast:resolved (dryRun) no-focus no-session explain:true → EXACTLY {cast,explanation,intent,latencyMs,resolved,resolvedBy}', async () => {
  const agg = makeSimpleAgg();
  try {
    const body = await castResolved(agg, { explain: true });
    assertExactKeys(body, RESOLVED_EXPLAIN_BASE, 'GEE-1 resolved+explain (no focus, no session)');
    assert.equal(typeof body['explanation'], 'object', 'GEE-1: explanation must be an object');
    assert.notEqual(body['explanation'], null, 'GEE-1: explanation must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GEE-2: no-focus, with-session, explain:true → EXACTLY GEE-1 + sessionContext ──

test('GEE-2: cast:resolved (dryRun) no-focus with-session explain:true → EXACTLY {cast,explanation,intent,latencyMs,resolved,resolvedBy,sessionContext}', async () => {
  const agg = makeSimpleAgg();
  try {
    const body = await castResolved(agg, { explain: true, sessionId: 'gee-session-2' });
    assertExactKeys(body, RESOLVED_EXPLAIN_SESSION, 'GEE-2 resolved+explain+session (no focus)');
    assert.equal(typeof body['explanation'], 'object', 'GEE-2: explanation must be an object');
    assert.notEqual(body['explanation'], null, 'GEE-2: explanation must not be null');
    assert.equal(typeof body['sessionContext'], 'object', 'GEE-2: sessionContext must be an object');
    assert.notEqual(body['sessionContext'], null, 'GEE-2: sessionContext must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GEE-3: focus:code, no-session, explain:true → EXACTLY {cast, explanation, focus, intent, latencyMs, resolved, resolvedBy} ──

test('GEE-3: cast:resolved (dryRun) focus:code no-session explain:true → EXACTLY {cast,explanation,focus,intent,latencyMs,resolved,resolvedBy}', async () => {
  const agg = makeFocusAgg();
  try {
    const body = await castResolved(agg, { explain: true });
    assertExactKeys(body, RESOLVED_FOCUS_EXPLAIN, 'GEE-3 resolved+focus+explain (no session)');
    assert.equal(body['focus'], 'code', 'GEE-3: focus value must equal active profile name');
    assert.equal(typeof body['explanation'], 'object', 'GEE-3: explanation must be an object');
    assert.notEqual(body['explanation'], null, 'GEE-3: explanation must not be null');
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'sessionContext'),
      false,
      'GEE-3: sessionContext must be absent when no sessionId is provided',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEE-4: resolved, no-focus, no-session, NO explain → `explanation` ABSENT ──

test('GEE-4: cast:resolved (dryRun) no-focus no-session without explain → explanation key ABSENT', async () => {
  const agg = makeSimpleAgg();
  try {
    const body = await castResolved(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'explanation'),
      false,
      `GEE-4: explanation must be absent when explain param is not set; got keys: ${JSON.stringify(Object.keys(body))}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEE-5: explanation sub-object has string `method` key ─────────────────────

test('GEE-5: explanation sub-object from cast:resolved has a string method key', async () => {
  const agg = makeSimpleAgg();
  try {
    const body = await castResolved(agg, { explain: true });
    const explanation = body['explanation'] as Record<string, unknown>;
    assert.ok(
      explanation !== null && typeof explanation === 'object' && !Array.isArray(explanation),
      'GEE-5: explanation must be a non-null, non-array object',
    );
    assert.equal(
      typeof explanation['method'],
      'string',
      `GEE-5: explanation.method must be a string; got ${typeof explanation['method']}`,
    );
    assert.ok(
      (explanation['method'] as string).length > 0,
      'GEE-5: explanation.method must be a non-empty string',
    );
  } finally {
    await agg.shutdown();
  }
});
