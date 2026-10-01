/**
 * GEK drift guard: freeze cast:resolved (dryRun) exact top-level key set
 * when scope is active — four combinations.
 *
 * GEC froze resolved top-level key set WITHOUT scope (base + focus + session
 * combinations). GEE froze resolved WITH explain (no scope). No test freezes
 * the EXACT key set when scope is provided alongside the resolved path. A
 * regression that:
 *   (a) silently drops `scope` from resolved when it resolves (keeping it only
 *       for no_match), or
 *   (b) injects an unexpected extra key alongside `scope` in the resolved body,
 * would pass GEC and GEE silently.
 *
 * Actual cast:resolved body (aggregator.ts ~line 1564):
 *   { cast: 'resolved', resolvedBy, intent, latencyMs,
 *     ...(focusName   ? { focus }       : {}),
 *     ...(scopeAnnot  ? { scope }       : {}),
 *     ...(explanation ? { explanation } : {}),
 *     resolved: { tool, score },
 *     ...(catalogCombo     ? { catalogCombo }     : {}),
 *     ...(resolvedCtx      ? { sessionContext }   : {}),
 *   }
 *
 * Probed 2026-09-30:
 *   scope(servers), no session, no explain    → 6 keys
 *   scope + session, no explain               → 7 keys
 *   scope + explain, no session               → 7 keys
 *   scope + session + explain (maximal)       → 8 keys
 *
 * GEK freezes:
 *
 *   GEK-1: resolved + scope(servers), no session, no explain → EXACTLY 6 keys
 *          {cast, intent, latencyMs, resolved, resolvedBy, scope}
 *          (GEC-1 base + scope; confirms scope appears in resolved body)
 *
 *   GEK-2: resolved + scope + session, no explain → EXACTLY 7 keys
 *          GEK-1 + sessionContext
 *          (GEC-2 + scope; confirms both scope and sessionContext co-exist)
 *
 *   GEK-3: resolved + scope + explain, no session → EXACTLY 7 keys
 *          GEK-1 + explanation
 *          (GEE-1 + scope; confirms scope and explanation co-exist)
 *
 *   GEK-4: resolved + scope + session + explain (maximal) → EXACTLY 8 keys
 *          GEK-1 + explanation + sessionContext
 *          (All three conditionals active simultaneously; guards against any
 *           one blocking another or leaking an extra key under combined load.)
 *
 *   GEK-5: resolved WITHOUT scope → `scope` ABSENT — symmetric absence guard.
 *          (Guards against a regression that always injects scope regardless
 *           of whether it was provided.)
 *
 * Uses inline Backend (no FixtureBackend) — same pattern as GEC/GEE. No focus
 * needed (scope annotation is independent of focus).
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level resolved
 *     key set presence/absence of scope, not explain sub-object fields)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

// ── Frozen exact key sets ─────────────────────────────────────────────────────

// GEK-1: scope only (no session, no explain)
const RESOLVED_SCOPE_BASE: readonly string[] = [
  'cast', 'intent', 'latencyMs', 'resolved', 'resolvedBy', 'scope',
];

// GEK-2: scope + session
const RESOLVED_SCOPE_SESSION: readonly string[] = [
  ...RESOLVED_SCOPE_BASE, 'sessionContext',
];

// GEK-3: scope + explain
const RESOLVED_SCOPE_EXPLAIN: readonly string[] = [
  ...RESOLVED_SCOPE_BASE, 'explanation',
];

// GEK-4: scope + session + explain (maximal)
const RESOLVED_SCOPE_SESSION_EXPLAIN: readonly string[] = [
  ...RESOLVED_SCOPE_BASE, 'explanation', 'sessionContext',
];

// ── Inline Backend helpers ────────────────────────────────────────────────────

let _seq = 0;
function makeDlq(): string {
  return join(tmpdir(), `ch1tty-gek-${Date.now()}-${++_seq}.jsonl`);
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

function makeAgg(): Aggregator {
  return new Aggregator([NEON_CFG], {
    backendFactory: () => makeBackend(),
    embedEnabled: false,
    ledgerDlqPath: makeDlq(),
  } as Parameters<typeof Aggregator.prototype.callTool>[1]);
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

// ── GEK-1: scope only, no session, no explain ─────────────────────────────────

test('GEK-1: cast:resolved (dryRun) + scope → EXACTLY {cast,intent,latencyMs,resolved,resolvedBy,scope}', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg, { scope: { servers: ['neon'] } });
    assertExactKeys(body, RESOLVED_SCOPE_BASE, 'GEK-1 resolved+scope (no session, no explain)');
    assert.equal(typeof body['scope'], 'object', 'GEK-1: scope must be an object');
    assert.notEqual(body['scope'], null, 'GEK-1: scope must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GEK-2: scope + session ─────────────────────────────────────────────────────

test('GEK-2: cast:resolved (dryRun) + scope + session → EXACTLY {cast,intent,latencyMs,resolved,resolvedBy,scope,sessionContext}', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg, { scope: { servers: ['neon'] }, sessionId: 'gek-session-2' });
    assertExactKeys(body, RESOLVED_SCOPE_SESSION, 'GEK-2 resolved+scope+session (no explain)');
    assert.equal(typeof body['scope'], 'object', 'GEK-2: scope must be an object');
    assert.notEqual(body['scope'], null, 'GEK-2: scope must not be null');
    assert.equal(typeof body['sessionContext'], 'object', 'GEK-2: sessionContext must be an object');
    assert.notEqual(body['sessionContext'], null, 'GEK-2: sessionContext must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GEK-3: scope + explain ─────────────────────────────────────────────────────

test('GEK-3: cast:resolved (dryRun) + scope + explain → EXACTLY {cast,explanation,intent,latencyMs,resolved,resolvedBy,scope}', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg, { scope: { servers: ['neon'] }, explain: true });
    assertExactKeys(body, RESOLVED_SCOPE_EXPLAIN, 'GEK-3 resolved+scope+explain (no session)');
    assert.equal(typeof body['scope'], 'object', 'GEK-3: scope must be an object');
    assert.notEqual(body['scope'], null, 'GEK-3: scope must not be null');
    assert.equal(typeof body['explanation'], 'object', 'GEK-3: explanation must be an object');
    assert.notEqual(body['explanation'], null, 'GEK-3: explanation must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GEK-4: scope + session + explain (maximal) ────────────────────────────────

test('GEK-4: cast:resolved (dryRun) + scope + session + explain → EXACTLY {cast,explanation,intent,latencyMs,resolved,resolvedBy,scope,sessionContext}', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg, {
      scope: { servers: ['neon'] },
      sessionId: 'gek-session-4',
      explain: true,
    });
    assertExactKeys(body, RESOLVED_SCOPE_SESSION_EXPLAIN, 'GEK-4 resolved+scope+session+explain (maximal)');
    assert.equal(typeof body['scope'], 'object', 'GEK-4: scope must be an object');
    assert.notEqual(body['scope'], null, 'GEK-4: scope must not be null');
    assert.equal(typeof body['explanation'], 'object', 'GEK-4: explanation must be an object');
    assert.notEqual(body['explanation'], null, 'GEK-4: explanation must not be null');
    assert.equal(typeof body['sessionContext'], 'object', 'GEK-4: sessionContext must be an object');
    assert.notEqual(body['sessionContext'], null, 'GEK-4: sessionContext must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GEK-5: resolved WITHOUT scope → `scope` ABSENT ───────────────────────────

test('GEK-5: cast:resolved (dryRun) WITHOUT scope → scope key ABSENT', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'scope'),
      false,
      `GEK-5: scope must be absent when no scope param is provided; got keys: ${JSON.stringify(Object.keys(body))}`,
    );
  } finally {
    await agg.shutdown();
  }
});
