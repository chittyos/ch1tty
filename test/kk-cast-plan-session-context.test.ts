/**
 * Workstream KK: sessionContext in ch1tty/cast: plan responses.
 *
 * When effectiveSessionId is active, cast: plan (confirm: true) now includes
 * sessionContext: { recentTools: string[], callCount: number, activeSessionFocus?: string }
 * reflecting pre-execution session state at the time of the plan call.
 *
 * This lets clients deciding whether to confirm see current session context
 * (prior tool calls, sticky focus) without a separate ch1tty/status round-trip.
 *
 * cast: resolved (dryRun) and cast: no_match remain unchanged — no sessionContext.
 *
 * Covered:
 *   1. No sessionId → no sessionContext in cast: plan
 *   2. sessionId fresh session → sessionContext present with recentTools:[] callCount:0
 *   3. Prior tool calls → sessionContext.recentTools includes those tools
 *   4. sessionContext.callCount reflects total prior calls
 *   5. activeSessionFocus present when sticky focus is set before confirm call
 *   6. activeSessionFocus absent when no focus set
 *   7. dryRun:true → no sessionContext (resolved path unchanged)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-kk-${label}-${Date.now()}.jsonl`);
}

const NEON_CFG: ServerConfig = { id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.test/mcp' };
const STRIPE_CFG: ServerConfig = { id: 'stripe', name: 'Stripe Payments', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.test/mcp' };

function makeBackend(tools: ToolEntry[]): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: tools.length, toolCacheAge: 0 }),
    listTools: async () => tools,
    callTool: async (): Promise<ToolCallResult> => ({ content: [{ type: 'text', text: 'tool-output' }] }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

const NEON_TOOLS: ToolEntry[] = [
  { name: 'list_projects', description: 'List Neon projects', inputSchema: { type: 'object', properties: {} } },
  { name: 'run_sql', description: 'Run SQL on Neon', inputSchema: { type: 'object', properties: {} } },
];
const STRIPE_TOOLS: ToolEntry[] = [
  { name: 'list_customers', description: 'List Stripe customers', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_invoice', description: 'Create Stripe invoice', inputSchema: { type: 'object', properties: {} } },
];

const FOCUS_PROFILES = {
  profiles: {
    code: { description: 'Code tools', categories: ['code' as const], servers: ['neon'], boost: 0.5 },
  },
};

function makeAgg(label: string): Aggregator {
  const backends = new Map<string, Backend>([
    ['neon', makeBackend(NEON_TOOLS)],
    ['stripe', makeBackend(STRIPE_TOOLS)],
  ]);
  return new Aggregator([NEON_CFG, STRIPE_CFG], {
    focusProfiles: FOCUS_PROFILES,
    backendFactory: (cfg) => backends.get(cfg.id) ?? makeBackend([]),
    embedEnabled: false,
    ledgerDlqPath: dlqPath(label),
  });
}

function parseCast(result: ToolCallResult): Record<string, unknown> {
  const first = result.content[0];
  assert.equal(first?.type, 'text');
  return JSON.parse(first.text) as Record<string, unknown>;
}

// ── 1. No sessionId → no sessionContext in cast: plan ────────────────────────

test('cast: plan — no sessionId → no sessionContext in response', async () => {
  const agg = makeAgg('1-no-session');
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', confirm: true });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'plan');
    assert.equal('sessionContext' in cast, false, 'sessionContext should be absent without sessionId');
  } finally {
    await agg.shutdown();
  }
});

// ── 2. Fresh session → sessionContext present with empty recentTools ──────────

test('cast: plan — fresh sessionId → sessionContext present with recentTools:[] callCount:0', async () => {
  const agg = makeAgg('2-fresh');
  try {
    const SESSION = 'kk-fresh-session';
    const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', confirm: true, sessionId: SESSION });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'plan');
    const sc = cast.sessionContext as { recentTools: string[]; callCount: number } | undefined;
    assert.ok(sc, 'sessionContext should be present when sessionId is active');
    assert.deepEqual(sc.recentTools, [], 'recentTools should be empty for a fresh session');
    assert.equal(sc.callCount, 0, 'callCount should be 0 for a fresh session');
  } finally {
    await agg.shutdown();
  }
});

// ── 3. Prior tool calls → recentTools reflects them ──────────────────────────

test('cast: plan — sessionContext.recentTools includes tools called before confirm', async () => {
  const agg = makeAgg('3-recent');
  try {
    const SESSION = 'kk-recent-session';
    // Execute two tools before the confirm call
    await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', sessionId: SESSION });
    await agg.callTool('ch1tty/execute', { tool: 'stripe/list_customers', sessionId: SESSION });
    const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', confirm: true, sessionId: SESSION });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'plan');
    const sc = cast.sessionContext as { recentTools: string[] } | undefined;
    assert.ok(sc, 'sessionContext must be present');
    assert.ok(sc.recentTools.includes('neon/list_projects'), 'recentTools should include neon/list_projects');
    assert.ok(sc.recentTools.includes('stripe/list_customers'), 'recentTools should include stripe/list_customers');
  } finally {
    await agg.shutdown();
  }
});

// ── 4. callCount reflects total prior calls ───────────────────────────────────

test('cast: plan — sessionContext.callCount reflects total tool calls before confirm', async () => {
  const agg = makeAgg('4-count');
  try {
    const SESSION = 'kk-count-session';
    await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', sessionId: SESSION });
    await agg.callTool('ch1tty/execute', { tool: 'neon/run_sql', sessionId: SESSION });
    await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', sessionId: SESSION });
    const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', confirm: true, sessionId: SESSION });
    const cast = parseCast(result);
    const sc = cast.sessionContext as { callCount: number } | undefined;
    assert.ok(sc, 'sessionContext must be present');
    assert.ok(sc.callCount >= 3, `callCount should be at least 3 after 3 prior calls (got ${sc.callCount})`);
  } finally {
    await agg.shutdown();
  }
});

// ── 5. activeSessionFocus present when sticky focus is set before confirm ─────

test('cast: plan — activeSessionFocus present when sticky focus was set in this session', async () => {
  const agg = makeAgg('5-focus');
  try {
    const SESSION = 'kk-focus-session';
    // Set sticky focus via search
    await agg.callTool('ch1tty/search', { query: 'sql', focus: 'code', sessionId: SESSION });
    const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', confirm: true, sessionId: SESSION });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'plan');
    const sc = cast.sessionContext as { activeSessionFocus?: string } | undefined;
    assert.ok(sc, 'sessionContext must be present');
    assert.equal(sc.activeSessionFocus, 'code', 'activeSessionFocus should be "code"');
  } finally {
    await agg.shutdown();
  }
});

// ── 6. activeSessionFocus absent when no focus set ───────────────────────────

test('cast: plan — activeSessionFocus absent when no focus has been set in this session', async () => {
  const agg = makeAgg('6-no-focus');
  try {
    const SESSION = 'kk-nofocus-session';
    const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', confirm: true, sessionId: SESSION });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'plan');
    const sc = cast.sessionContext as Record<string, unknown> | undefined;
    assert.ok(sc, 'sessionContext must be present');
    assert.equal('activeSessionFocus' in sc, false, 'activeSessionFocus should be absent when no focus set');
  } finally {
    await agg.shutdown();
  }
});

// ── 7. dryRun:true → no sessionContext (resolved path unchanged) ──────────────

test('cast: resolved (dryRun:true) → no sessionContext (resolved path unchanged by KK)', async () => {
  const agg = makeAgg('7-dryrun');
  try {
    const SESSION = 'kk-dryrun-session';
    const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', dryRun: true, sessionId: SESSION });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'resolved', 'should be cast: resolved with dryRun:true');
    assert.equal('sessionContext' in cast, false, 'sessionContext must be absent in cast: resolved (dryRun path unchanged)');
  } finally {
    await agg.shutdown();
  }
});
