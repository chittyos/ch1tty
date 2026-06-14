/**
 * Workstream OO: sessionContext in cast: resolved responses.
 *
 * cast: resolved fires when dryRun:true is set and a tool is found — it returns
 * the resolved tool name + score without executing. Before OO, this was the only
 * cast response shape without sessionContext. With this change, when a sessionId
 * is active the response includes sessionContext: { recentTools, callCount,
 * activeSessionFocus? } reflecting pre-execution session state — completing
 * sessionContext coverage for all six cast response shapes.
 *
 * Covered:
 *   1. No sessionId → sessionContext absent in cast: resolved
 *   2. Fresh session, no prior calls → sessionContext present: recentTools: [], callCount: 0
 *   3. Prior tool calls → recentTools reflects them
 *   4. callCount reflects prior tool calls
 *   5. Sticky focus set before dryRun → activeSessionFocus present in sessionContext
 *   6. No sticky focus → activeSessionFocus absent from sessionContext
 *   7. scope annotation + sessionContext co-exist in resolved response
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-oo-${label}-${Date.now()}.jsonl`);
}

const FOCUS_PROFILES = {
  profiles: {
    code: { description: 'Code tools', categories: ['code' as const], servers: ['neon'], boost: 0.5 },
  },
};

const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite', category: 'code',
  endpoint: 'https://neon.test/mcp',
};

const NEON_TOOLS: ToolEntry[] = [
  { name: 'list_projects', description: 'List all Neon database projects', inputSchema: { type: 'object', properties: {} } },
  { name: 'run_sql', description: 'Execute SQL queries on Neon database', inputSchema: { type: 'object', properties: {} } },
];

// Intent that reliably resolves to list_projects (high keyword overlap)
const MATCH_INTENT = 'list neon database projects';

function makeNeonBackend(): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: NEON_TOOLS.length, toolCacheAge: 0 }),
    listTools: async () => NEON_TOOLS,
    callTool: async (): Promise<ToolCallResult> => ({ content: [{ type: 'text', text: 'neon-output' }] }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

function makeAgg(label: string): Aggregator {
  return new Aggregator([NEON_CFG], {
    focusProfiles: FOCUS_PROFILES,
    backendFactory: () => makeNeonBackend(),
    embedEnabled: false,
    ledgerDlqPath: dlqPath(label),
  });
}

function parseCast(result: ToolCallResult): Record<string, unknown> {
  const first = result.content[0];
  assert.equal(first?.type, 'text');
  return JSON.parse(first.text) as Record<string, unknown>;
}

// ── 1. No sessionId → sessionContext absent ───────────────────────────────────

test('cast: resolved — no sessionId → sessionContext absent', async () => {
  const agg = makeAgg('1-no-session');
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: MATCH_INTENT, dryRun: true });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'resolved', `expected resolved, got: ${cast.cast}`);
    assert.equal('sessionContext' in cast, false, 'sessionContext must be absent without sessionId');
  } finally {
    await agg.shutdown();
  }
});

// ── 2. Fresh session → sessionContext present: recentTools: [], callCount: 0 ──

test('cast: resolved — fresh sessionId → sessionContext present with empty state', async () => {
  const agg = makeAgg('2-fresh-session');
  try {
    const SESSION = 'oo-fresh-session';
    const result = await agg.callTool('ch1tty/cast', { intent: MATCH_INTENT, dryRun: true, sessionId: SESSION });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'resolved', `expected resolved, got: ${cast.cast}`);
    const sc = cast.sessionContext as { recentTools: string[]; callCount: number } | undefined;
    assert.ok(sc, 'sessionContext should be present when sessionId is active');
    assert.deepEqual(sc.recentTools, [], 'recentTools should be empty for a fresh session');
    assert.equal(sc.callCount, 0, 'callCount should be 0 for a fresh session');
  } finally {
    await agg.shutdown();
  }
});

// ── 3. Prior tool calls → recentTools reflects them ──────────────────────────

test('cast: resolved — prior execute calls → recentTools reflects them', async () => {
  const agg = makeAgg('3-recent-tools');
  try {
    const SESSION = 'oo-recent-tools';
    // Execute run_sql to establish tool history
    await agg.callTool('ch1tty/execute', { tool: 'neon/run_sql', sessionId: SESSION });
    const result = await agg.callTool('ch1tty/cast', { intent: MATCH_INTENT, dryRun: true, sessionId: SESSION });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'resolved', `expected resolved, got: ${cast.cast}`);
    const sc = cast.sessionContext as { recentTools: string[] } | undefined;
    assert.ok(sc, 'sessionContext should be present');
    assert.ok(sc.recentTools.includes('neon/run_sql'), 'recentTools should include the previously executed tool');
  } finally {
    await agg.shutdown();
  }
});

// ── 4. callCount reflects prior tool calls ────────────────────────────────────

test('cast: resolved — callCount reflects prior tool calls', async () => {
  const agg = makeAgg('4-call-count');
  try {
    const SESSION = 'oo-call-count';
    await agg.callTool('ch1tty/execute', { tool: 'neon/run_sql', sessionId: SESSION });
    await agg.callTool('ch1tty/execute', { tool: 'neon/run_sql', sessionId: SESSION });
    const result = await agg.callTool('ch1tty/cast', { intent: MATCH_INTENT, dryRun: true, sessionId: SESSION });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'resolved', `expected resolved, got: ${cast.cast}`);
    const sc = cast.sessionContext as { callCount: number } | undefined;
    assert.ok(sc, 'sessionContext should be present');
    assert.equal(sc.callCount, 2, 'callCount should reflect the 2 prior execute calls');
  } finally {
    await agg.shutdown();
  }
});

// ── 5. Sticky focus set → activeSessionFocus present ─────────────────────────

test('cast: resolved — sticky focus set → activeSessionFocus present in sessionContext', async () => {
  const agg = makeAgg('5-focus');
  try {
    const SESSION = 'oo-focus-session';
    // Set sticky focus via search without touching tool affinity
    await agg.callTool('ch1tty/search', { query: 'sql', focus: 'code', sessionId: SESSION });
    const result = await agg.callTool('ch1tty/cast', { intent: MATCH_INTENT, dryRun: true, sessionId: SESSION });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'resolved', `expected resolved, got: ${cast.cast}`);
    const sc = cast.sessionContext as { activeSessionFocus?: string } | undefined;
    assert.ok(sc, 'sessionContext should be present');
    assert.equal(sc.activeSessionFocus, 'code', 'activeSessionFocus should be "code" when sticky focus is set');
  } finally {
    await agg.shutdown();
  }
});

// ── 6. No sticky focus → activeSessionFocus absent ───────────────────────────

test('cast: resolved — no focus set → activeSessionFocus absent from sessionContext', async () => {
  const agg = makeAgg('6-no-focus');
  try {
    const SESSION = 'oo-nofocus-session';
    const result = await agg.callTool('ch1tty/cast', { intent: MATCH_INTENT, dryRun: true, sessionId: SESSION });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'resolved', `expected resolved, got: ${cast.cast}`);
    const sc = cast.sessionContext as Record<string, unknown> | undefined;
    assert.ok(sc, 'sessionContext should be present');
    assert.equal('activeSessionFocus' in sc, false, 'activeSessionFocus should be absent when no focus set');
  } finally {
    await agg.shutdown();
  }
});

// ── 7. scope annotation + sessionContext co-exist ─────────────────────────────

test('cast: resolved — scope annotation and sessionContext both present', async () => {
  const agg = makeAgg('7-scope');
  try {
    const SESSION = 'oo-scope-session';
    const result = await agg.callTool('ch1tty/cast', {
      intent: MATCH_INTENT,
      dryRun: true,
      scope: { servers: ['neon'] },
      sessionId: SESSION,
    });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'resolved', `expected resolved, got: ${cast.cast}`);
    const sc = cast.sessionContext as { recentTools: string[]; callCount: number } | undefined;
    assert.ok(sc, 'sessionContext should be present alongside scope annotation');
    assert.deepEqual(sc.recentTools, [], 'recentTools should be empty for a fresh session');
    assert.equal(sc.callCount, 0, 'callCount should be 0 for a fresh session');
    const scope = cast.scope as { servers?: string[] } | undefined;
    assert.ok(scope, 'scope annotation should also be present');
    assert.deepEqual(scope.servers, ['neon'], 'scope.servers should be populated');
  } finally {
    await agg.shutdown();
  }
});
