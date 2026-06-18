/**
 * Workstream QQ: sessionContext in ch1tty/execute dryRun responses.
 *
 * ch1tty/execute with dryRun:true returns { status:"dry_run", server, tool, args }
 * without executing. Before QQ, this was the only execute path without sessionContext.
 * With this change, when a sessionId is active the dry_run JSON includes
 * sessionContext: { recentTools, callCount, activeSessionFocus? } reflecting the
 * pre-execution session state — completing sessionContext parity between normal
 * execute (II) and dry-run execute (QQ).
 *
 * Note: dryRun makes ZERO backend calls, so the dry_run call itself is NOT recorded
 * in the coordinator — sessionContext reflects only prior tool calls.
 *
 * Covered:
 *   1. No sessionId → sessionContext absent in dry_run response
 *   2. Fresh sessionId → sessionContext present: recentTools: [], callCount: 0
 *   3. Prior execute calls → recentTools reflects them in dry_run response
 *   4. callCount reflects prior tool calls (not the dry_run call itself)
 *   5. Sticky focus set via search before dryRun → activeSessionFocus present
 *   6. No sticky focus → activeSessionFocus absent from sessionContext
 *   7. dryRun makes zero backend calls even when sessionContext is populated
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-qq-${label}-${Date.now()}.jsonl`);
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

let callCount = 0;

function makeNeonBackend(): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: NEON_TOOLS.length, toolCacheAge: 0 }),
    listTools: async () => NEON_TOOLS,
    callTool: async (): Promise<ToolCallResult> => {
      callCount++;
      return { content: [{ type: 'text', text: 'neon-output' }] };
    },
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

function parseDryRun(result: ToolCallResult): Record<string, unknown> {
  assert.equal(result.isError, false);
  const first = result.content[0];
  assert.equal(first?.type, 'text');
  const parsed = JSON.parse(first.text) as Record<string, unknown>;
  assert.equal(parsed.status, 'dry_run', `expected dry_run status, got: ${parsed.status}`);
  return parsed;
}

// ── 1. No sessionId → sessionContext absent ───────────────────────────────────

test('execute: dry_run — no sessionId → sessionContext absent', async () => {
  const agg = makeAgg('1-no-session');
  try {
    const result = await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', dryRun: true });
    const dr = parseDryRun(result);
    assert.equal('sessionContext' in dr, false, 'sessionContext must be absent without sessionId');
  } finally {
    await agg.shutdown();
  }
});

// ── 2. Fresh sessionId → sessionContext present: recentTools: [], callCount: 0 ──

test('execute: dry_run — fresh sessionId → sessionContext present with empty state', async () => {
  const agg = makeAgg('2-fresh-session');
  try {
    const SESSION = 'qq-fresh-session';
    const result = await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', dryRun: true, sessionId: SESSION });
    const dr = parseDryRun(result);
    const sc = dr.sessionContext as { recentTools: string[]; callCount: number } | undefined;
    assert.ok(sc, 'sessionContext should be present when sessionId is active');
    assert.deepEqual(sc.recentTools, [], 'recentTools should be empty for a fresh session');
    assert.equal(sc.callCount, 0, 'callCount should be 0 for a fresh session');
  } finally {
    await agg.shutdown();
  }
});

// ── 3. Prior tool calls → recentTools reflects them ──────────────────────────

test('execute: dry_run — prior execute calls → recentTools reflects them', async () => {
  const agg = makeAgg('3-recent-tools');
  try {
    const SESSION = 'qq-recent-tools';
    await agg.callTool('ch1tty/execute', { tool: 'neon/run_sql', sessionId: SESSION });
    const result = await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', dryRun: true, sessionId: SESSION });
    const dr = parseDryRun(result);
    const sc = dr.sessionContext as { recentTools: string[] } | undefined;
    assert.ok(sc, 'sessionContext should be present');
    assert.ok(sc.recentTools.includes('neon/run_sql'), 'recentTools should include the previously executed tool');
  } finally {
    await agg.shutdown();
  }
});

// ── 4. callCount reflects prior calls (not the dry_run itself) ───────────────

test('execute: dry_run — callCount reflects prior tool calls, not the dry_run itself', async () => {
  const agg = makeAgg('4-call-count');
  try {
    const SESSION = 'qq-call-count';
    await agg.callTool('ch1tty/execute', { tool: 'neon/run_sql', sessionId: SESSION });
    await agg.callTool('ch1tty/execute', { tool: 'neon/run_sql', sessionId: SESSION });
    // dryRun must NOT add to callCount
    const result = await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', dryRun: true, sessionId: SESSION });
    const dr = parseDryRun(result);
    const sc = dr.sessionContext as { callCount: number } | undefined;
    assert.ok(sc, 'sessionContext should be present');
    assert.equal(sc.callCount, 2, 'callCount should be 2 (only the 2 real calls, not the dry_run)');
  } finally {
    await agg.shutdown();
  }
});

// ── 5. Sticky focus → activeSessionFocus present ─────────────────────────────

test('execute: dry_run — sticky focus set via search → activeSessionFocus in sessionContext', async () => {
  const agg = makeAgg('5-sticky-focus');
  try {
    const SESSION = 'qq-sticky-focus';
    // Set session-sticky focus via search
    await agg.callTool('ch1tty/search', { query: 'database', focus: 'code', sessionId: SESSION });
    const result = await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', dryRun: true, sessionId: SESSION });
    const dr = parseDryRun(result);
    const sc = dr.sessionContext as { activeSessionFocus?: string } | undefined;
    assert.ok(sc, 'sessionContext should be present');
    assert.equal(sc.activeSessionFocus, 'code', 'activeSessionFocus should be "code" from sticky focus');
  } finally {
    await agg.shutdown();
  }
});

// ── 6. No sticky focus → activeSessionFocus absent ───────────────────────────

test('execute: dry_run — no sticky focus → activeSessionFocus absent from sessionContext', async () => {
  const agg = makeAgg('6-no-focus');
  try {
    const SESSION = 'qq-no-focus';
    const result = await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', dryRun: true, sessionId: SESSION });
    const dr = parseDryRun(result);
    const sc = dr.sessionContext as Record<string, unknown> | undefined;
    assert.ok(sc, 'sessionContext should be present');
    assert.equal('activeSessionFocus' in sc, false, 'activeSessionFocus should be absent when no focus is set');
  } finally {
    await agg.shutdown();
  }
});

// ── 7. dryRun makes zero backend calls even when sessionContext is populated ──

test('execute: dry_run — zero backend calls even with sessionId + prior history', async () => {
  const agg = makeAgg('7-zero-calls');
  callCount = 0;
  try {
    const SESSION = 'qq-zero-calls';
    // Establish one real call to populate session context
    await agg.callTool('ch1tty/execute', { tool: 'neon/run_sql', sessionId: SESSION });
    const beforeDryRun = callCount; // should be 1
    // dryRun must NOT add another backend call
    const result = await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', dryRun: true, sessionId: SESSION });
    const dr = parseDryRun(result);
    assert.equal(callCount, beforeDryRun, 'dryRun must make zero additional backend calls');
    // sessionContext is still populated from the prior real call
    const sc = dr.sessionContext as { recentTools: string[] } | undefined;
    assert.ok(sc, 'sessionContext should be present');
    assert.ok(sc.recentTools.includes('neon/run_sql'), 'recentTools populated from prior real call');
  } finally {
    await agg.shutdown();
  }
});
