/**
 * GDD drift guard: freeze the EXACT KEY SETS of the sessionContext sub-object
 * in ch1tty/execute and ch1tty/execute+dryRun responses.
 *
 * EC (ec-execute-response-shape-drift.test.ts) checks sessionContext keys via
 * a PERMITTED superset guard:
 *
 *   PERMITTED = ['recentTools', 'callCount', 'activeSessionFocus']
 *
 * A superset check catches EXTRA keys not in the PERMITTED list but silently
 * allows KEY REMOVAL. If `recentTools` were renamed to `tools`, or `callCount`
 * to `count`, the EC test would still pass — no key outside PERMITTED appears,
 * so the filter returns [].
 *
 * GDD closes that gap with exact key set assertions (both required-present AND
 * extra-absent) for the sessionContext sub-object across four code paths:
 *
 *   GDD-1  execute+session (no focus) sessionContext exact keys = {recentTools, callCount}
 *          — activeSessionFocus must be ABSENT as a key (not just falsy)
 *
 *   GDD-2  execute+session (focus active) sessionContext exact keys =
 *          {recentTools, callCount, activeSessionFocus}
 *          — all three keys must be PRESENT, no extra keys beyond these three
 *
 *   GDD-3  execute+session (no focus) sessionContext does NOT contain the key
 *          'activeSessionFocus' (key absence, not value check)
 *
 *   GDD-4  dryRun+session (no focus) sessionContext exact keys = {recentTools, callCount}
 *
 *   GDD-5  dryRun+session (focus active) sessionContext exact keys =
 *          {recentTools, callCount, activeSessionFocus}
 *
 * How sticky focus is set for GDD-2 and GDD-5:
 *   We call ch1tty/search with focus:'code' + sessionId before the execute call.
 *   resolveActiveFocus() always persists a non-empty, non-'none' per-call focus
 *   as the sticky focus for the session (coordinator.setSessionFocus), regardless
 *   of whether a matching profile exists. The execute handler then reads it back
 *   via coordinator.getSessionFocus() and includes it in sessionContext.
 *
 * Source: src-stdio/aggregator.ts — handleExecute appended metadata path and
 * dryRun path:
 *   const activeSessionFocus = this.coordinator.getSessionFocus(execSessionId);
 *   const sessionContext = { recentTools, callCount,
 *     ...(activeSessionFocus ? { activeSessionFocus } : {}) };
 *
 * Frozen 2026-09-27.
 *
 * CLAUDE.md compliance:
 *   - Public MCP surface unchanged (5 meta-tools: search/execute/status/reload/cast).
 *   - buildCastExplanation metric freeze: not applicable (execute path, not cast explain).
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig, ToolCallResult } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

let _seq = 0;

/**
 * Deep-clone neon fixture so content arrays aren't shared across test instances.
 * FIXTURE_SERVERS.neon contains shared objects; callTool pushes onto content in-place,
 * so without a clone, multiple Aggregator instances in the same process share state.
 */
function freshNeonDef() {
  return {
    tools: FIXTURE_SERVERS.neon.tools.map((t) => ({
      ...t,
      response:
        t.response === 'error'
          ? ('error' as const)
          : { ...t.response, content: t.response.content.map((c) => ({ ...c })) },
    })),
  };
}

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', freshNeonDef());
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  const dlq = join(tmpdir(), `ch1tty-gdd-${Date.now()}-${++_seq}.jsonl`);
  return new Aggregator(
    [
      {
        id: 'neon',
        name: 'Neon',
        type: 'remote',
        access: 'readwrite',
        category: 'code',
        endpoint: 'https://neon.tech/mcp',
        lazy: true,
      } as ServerConfig,
      {
        id: 'stripe',
        name: 'Stripe',
        type: 'remote',
        access: 'readwrite',
        category: 'ecosystem',
        endpoint: 'https://stripe.com/mcp',
        lazy: true,
      } as ServerConfig,
    ],
    { backendFactory: () => backend, embedEnabled: false, ledgerDlqPath: dlq },
  );
}

/** Execute a tool and return the appended session metadata JSON object. */
async function execAndGetMeta(
  agg: Aggregator,
  tool: string,
  sessionId: string,
): Promise<Record<string, unknown>> {
  const result = (await agg.callTool('ch1tty/execute', { tool, sessionId })) as ToolCallResult;
  assert.ok(!result.isError, `execute must not return isError for ${tool}`);
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 2, 'execute+session must have at least 2 content items');
  const metaItem = content[content.length - 1];
  assert.equal(metaItem.type, 'text', 'metadata item must be type:text');
  return JSON.parse(metaItem.text!) as Record<string, unknown>;
}

/** Parse the dry-run JSON body from a dryRun execute result. */
function parseDryRun(result: ToolCallResult): Record<string, unknown> {
  assert.ok(!result.isError, 'dryRun must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'dryRun must have at least 1 content item');
  assert.equal(content[0].type, 'text', 'dryRun content[0] must be type:text');
  return JSON.parse(content[0].text!) as Record<string, unknown>;
}

/** Set the sticky focus for sessionId by calling ch1tty/search with a focus param. */
async function setSessionFocus(agg: Aggregator, sessionId: string, focus: string): Promise<void> {
  await agg.callTool('ch1tty/search', { query: 'project', sessionId, focus });
}

// ── Exact key set helper ───────────────────────────────────────────────────────

function assertExactKeys(
  obj: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const EXACT = new Set(expected);
  const actualKeys = new Set(Object.keys(obj));
  const missing = [...EXACT].filter((k) => !actualKeys.has(k));
  const extra = [...actualKeys].filter((k) => !EXACT.has(k));
  assert.deepEqual(
    missing,
    [],
    `${label}: missing required keys: ${missing.join(', ')}`,
  );
  assert.deepEqual(
    extra,
    [],
    `${label}: unexpected extra keys: ${extra.join(', ')}`,
  );
}

// ── GDD-1: execute+session (no focus) — sessionContext exact keys ──────────────

test('GDD-1: execute+session (no focus) sessionContext exact keys = {recentTools, callCount}', async () => {
  const agg = makeAgg();
  try {
    const sessionId = `gdd-1-${Date.now()}`;
    const meta = await execAndGetMeta(agg, 'neon/list_projects', sessionId);
    const sc = meta.sessionContext as Record<string, unknown>;
    assert.ok(sc && typeof sc === 'object' && !Array.isArray(sc), 'GDD-1: sessionContext must be an object');
    assertExactKeys(sc, ['recentTools', 'callCount'], 'GDD-1: sessionContext (no focus)');
  } finally {
    await agg.shutdown();
  }
});

// ── GDD-2: execute+session (focus active) — sessionContext exact keys ──────────

test('GDD-2: execute+session (focus active) sessionContext exact keys = {recentTools, callCount, activeSessionFocus}', async () => {
  const agg = makeAgg();
  try {
    const sessionId = `gdd-2-${Date.now()}`;
    // Set sticky focus via search with a focus param.
    await setSessionFocus(agg, sessionId, 'code');
    // Execute with same session — coordinator already has sticky focus 'code'.
    const meta = await execAndGetMeta(agg, 'neon/list_projects', sessionId);
    const sc = meta.sessionContext as Record<string, unknown>;
    assert.ok(sc && typeof sc === 'object' && !Array.isArray(sc), 'GDD-2: sessionContext must be an object');
    assertExactKeys(sc, ['recentTools', 'callCount', 'activeSessionFocus'], 'GDD-2: sessionContext (focus active)');
  } finally {
    await agg.shutdown();
  }
});

// ── GDD-3: execute+session (no focus) — activeSessionFocus key is ABSENT ───────

test('GDD-3: execute+session (no focus) sessionContext does not have activeSessionFocus key', async () => {
  const agg = makeAgg();
  try {
    const sessionId = `gdd-3-${Date.now()}`;
    const meta = await execAndGetMeta(agg, 'neon/list_projects', sessionId);
    const sc = meta.sessionContext as Record<string, unknown>;
    assert.ok(sc && typeof sc === 'object', 'GDD-3: sessionContext must be an object');
    assert.ok(
      !('activeSessionFocus' in sc),
      `GDD-3: sessionContext must NOT have 'activeSessionFocus' key when no focus is active; ` +
        `got keys: ${Object.keys(sc).join(', ')}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDD-4: dryRun+session (no focus) — sessionContext exact keys ───────────────

test('GDD-4: dryRun+session (no focus) sessionContext exact keys = {recentTools, callCount}', async () => {
  const agg = makeAgg();
  try {
    const sessionId = `gdd-4-${Date.now()}`;
    // First call registers session in the coordinator so dryRun includes sessionContext.
    await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', sessionId });
    // dryRun call with same session (no focus set).
    const result = (await agg.callTool('ch1tty/execute', {
      tool: 'neon/list_projects',
      sessionId,
      dryRun: true,
    })) as ToolCallResult;
    const dr = parseDryRun(result);
    assert.ok('sessionContext' in dr, 'GDD-4: dryRun with active session must include sessionContext');
    const sc = dr.sessionContext as Record<string, unknown>;
    assert.ok(sc && typeof sc === 'object' && !Array.isArray(sc), 'GDD-4: sessionContext must be an object');
    assertExactKeys(sc, ['recentTools', 'callCount'], 'GDD-4: dryRun sessionContext (no focus)');
  } finally {
    await agg.shutdown();
  }
});

// ── GDD-5: dryRun+session (focus active) — sessionContext exact keys ───────────

test('GDD-5: dryRun+session (focus active) sessionContext exact keys = {recentTools, callCount, activeSessionFocus}', async () => {
  const agg = makeAgg();
  try {
    const sessionId = `gdd-5-${Date.now()}`;
    // Set sticky focus via search with a focus param.
    await setSessionFocus(agg, sessionId, 'design');
    // First execute to register at least one tool call in the coordinator.
    await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', sessionId });
    // dryRun with focus set — sessionContext should include activeSessionFocus.
    const result = (await agg.callTool('ch1tty/execute', {
      tool: 'neon/list_projects',
      sessionId,
      dryRun: true,
    })) as ToolCallResult;
    const dr = parseDryRun(result);
    assert.ok('sessionContext' in dr, 'GDD-5: dryRun with focus+session must include sessionContext');
    const sc = dr.sessionContext as Record<string, unknown>;
    assert.ok(sc && typeof sc === 'object' && !Array.isArray(sc), 'GDD-5: sessionContext must be an object');
    assertExactKeys(sc, ['recentTools', 'callCount', 'activeSessionFocus'], 'GDD-5: dryRun sessionContext (focus active)');
  } finally {
    await agg.shutdown();
  }
});
