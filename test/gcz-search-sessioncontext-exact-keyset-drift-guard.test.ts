/**
 * GCZ drift guard: freeze the EXACT KEY SET and VALUE TYPES of
 * `sessionContext` in ch1tty/search responses.
 *
 * Workstream FF (`search-session-context.test.ts`) confirms that sessionContext
 * APPEARS when a sessionId is active and contains the expected field VALUES
 * (recentTools, callCount, activeSessionFocus). It does NOT freeze:
 *
 *   - The EXACT key set of sessionContext — a future change that added a new
 *     field (e.g. `lastCallMs`, `entityId`, `brainContext`) would silently pass
 *     every FF assertion.
 *   - The VALUE TYPES of callCount (FF checks its value, not `Number.isInteger`
 *     or `Number.isFinite` — a float or Infinity would pass the === check in
 *     a trivial case but would break client logic).
 *   - The ELEMENT TYPES of recentTools (FF checks array inclusion and length;
 *     it doesn't assert each element is a namespaced "serverId/toolName" string).
 *   - That callCount advances after real calls (not stuck at the value before
 *     the session was warmed up).
 *
 * ── Frozen invariants ──────────────────────────────────────────────────────
 *
 *   GCZ-1  sessionContext WITHOUT activeSessionFocus has EXACTLY the keys
 *          {recentTools, callCount} — no other keys added or renamed.
 *
 *   GCZ-2  sessionContext WITH activeSessionFocus has EXACTLY the keys
 *          {recentTools, callCount, activeSessionFocus} — only this one extra
 *          key added by the sticky-focus path; nothing else.
 *
 *   GCZ-3  sessionContext.recentTools elements are each non-empty strings
 *          containing exactly one '/' (namespaced "serverId/toolName" format).
 *          A bare tool name, a null, or a non-string would pass FF silently.
 *
 *   GCZ-4  sessionContext.callCount is a finite non-negative integer
 *          (`Number.isInteger`, `Number.isFinite`, `>= 0`). A float or Infinity
 *          would pass FF's `assert.equal(callCount, 3)` for the exact cases
 *          tested but would break downstream callers.
 *
 *   GCZ-5  sessionContext.callCount is > 0 after at least one real execute
 *          call in the session — the counter is not stuck at zero after the
 *          session is warmed up and the coordinator records tool usage.
 *
 * Source: src-stdio/aggregator.ts — handleSearch, sessionContext construction
 *   (built from coordinator.getSessionContext(effectiveSessionId)).
 *
 * Frozen 2026-09-27.
 *
 * CLAUDE.md compliance:
 *   - Public MCP surface unchanged (5 meta-tools: search/execute/status/reload/cast).
 *   - buildCastExplanation metric freeze: not applicable (search, not cast explain).
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gcz-${Date.now()}-${++_seq}.jsonl`);
}

const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon DB', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true,
};
const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true,
};

const NEON_TOOLS: ToolEntry[] = [
  { name: 'list_projects', description: 'List all Neon database projects', inputSchema: { type: 'object', properties: {} } },
  { name: 'run_query',     description: 'Run a SQL query on Neon database', inputSchema: { type: 'object', properties: {} } },
];
const STRIPE_TOOLS: ToolEntry[] = [
  { name: 'list_payments',      description: 'List Stripe payments for billing', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_invoice',     description: 'Create a new Stripe invoice',       inputSchema: { type: 'object', properties: {} } },
];

const FOCUS_PROFILES = {
  profiles: {
    code: {
      description: 'Code-focused tools',
      categories: ['code' as const],
      servers: ['neon'],
      boost: 0.5,
    },
  },
};

function makeBackend(tools: ToolEntry[]): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: tools.length, toolCacheAge: 0 }),
    listTools: async () => tools,
    callTool: async (): Promise<ToolCallResult> => ({ content: [{ type: 'text', text: 'ok' }] }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

function makeAgg(): Aggregator {
  const backends = new Map<string, Backend>([
    ['neon',   makeBackend(NEON_TOOLS)],
    ['stripe', makeBackend(STRIPE_TOOLS)],
  ]);
  return new Aggregator(
    [NEON_CFG, STRIPE_CFG],
    {
      focusProfiles: FOCUS_PROFILES,
      backendFactory: (cfg) => backends.get(cfg.id) ?? makeBackend([]),
      embedEnabled: false,
      ledgerDlqPath: dlq(),
    },
  );
}

function parse(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const item = result.content.find((c) => c.type === 'text');
  assert.ok(item?.text, 'Expected text content item');
  return JSON.parse(item.text) as Record<string, unknown>;
}

// ── GCZ-1: exact key set WITHOUT activeSessionFocus ───────────────────────────

test('GCZ-1: sessionContext without activeSessionFocus has exactly {callCount, recentTools}', async () => {
  const agg = makeAgg();
  try {
    const SESSION = 'gcz-1-no-focus';
    // Execute one tool so recentTools is non-empty, but no sticky focus set.
    await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', args: {}, sessionId: SESSION });
    const result = await agg.callTool('ch1tty/search', { query: 'list', sessionId: SESSION });
    const parsed = parse(result);
    const sc = parsed.sessionContext as Record<string, unknown>;
    assert.ok(sc !== null && typeof sc === 'object', 'sessionContext must be a non-null object');
    const keys = Object.keys(sc).sort();
    assert.deepEqual(keys, ['callCount', 'recentTools'],
      `sessionContext must have exactly {callCount, recentTools} — got: ${JSON.stringify(keys)}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GCZ-2: exact key set WITH activeSessionFocus ──────────────────────────────

test('GCZ-2: sessionContext with activeSessionFocus has exactly {activeSessionFocus, callCount, recentTools}', async () => {
  const agg = makeAgg();
  try {
    const SESSION = 'gcz-2-focus';
    // First search sets sticky focus; second search inherits it.
    await agg.callTool('ch1tty/search', { query: 'database', focus: 'code', sessionId: SESSION });
    const result = await agg.callTool('ch1tty/search', { query: 'list', sessionId: SESSION });
    const parsed = parse(result);
    const sc = parsed.sessionContext as Record<string, unknown>;
    assert.ok(sc !== null && typeof sc === 'object', 'sessionContext must be a non-null object when sessionId active');
    const keys = Object.keys(sc).sort();
    assert.deepEqual(keys, ['activeSessionFocus', 'callCount', 'recentTools'],
      `sessionContext with active focus must have exactly {activeSessionFocus, callCount, recentTools} — got: ${JSON.stringify(keys)}`);
    assert.equal(typeof sc.activeSessionFocus, 'string', 'activeSessionFocus must be a string');
    assert.ok((sc.activeSessionFocus as string).length > 0, 'activeSessionFocus must be a non-empty string');
  } finally {
    await agg.shutdown();
  }
});

// ── GCZ-3: recentTools elements are namespaced strings ────────────────────────

test('GCZ-3: sessionContext.recentTools items each contain exactly one "/" (namespaced format)', async () => {
  const agg = makeAgg();
  try {
    const SESSION = 'gcz-3-namespace';
    await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', args: {}, sessionId: SESSION });
    await agg.callTool('ch1tty/execute', { tool: 'stripe/list_payments', args: {}, sessionId: SESSION });
    const result = await agg.callTool('ch1tty/search', { query: 'list', sessionId: SESSION });
    const parsed = parse(result);
    const sc = parsed.sessionContext as { recentTools: unknown };
    assert.ok(Array.isArray(sc.recentTools), 'recentTools must be an array');
    assert.ok(sc.recentTools.length > 0, 'recentTools must be non-empty after execute calls');
    for (const item of sc.recentTools as unknown[]) {
      assert.equal(typeof item, 'string', `Each recentTools element must be a string, got: ${typeof item}`);
      const slashCount = (item as string).split('/').length - 1;
      assert.equal(slashCount, 1,
        `recentTools item "${item}" must contain exactly one '/' (namespaced "serverId/toolName")`);
      assert.ok((item as string).length > 2,
        `recentTools item "${item}" must be a non-empty namespaced name`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GCZ-4: callCount is a finite non-negative integer ─────────────────────────

test('GCZ-4: sessionContext.callCount is a finite non-negative integer', async () => {
  const agg = makeAgg();
  try {
    const SESSION = 'gcz-4-count-type';
    // Zero calls: callCount must be 0, still an integer.
    const result0 = await agg.callTool('ch1tty/search', { query: 'list', sessionId: SESSION });
    const sc0 = (parse(result0).sessionContext as { callCount: unknown });
    assert.ok(Number.isInteger(sc0.callCount),
      `callCount after 0 calls must be an integer, got ${sc0.callCount}`);
    assert.ok(Number.isFinite(sc0.callCount as number),
      `callCount after 0 calls must be finite, got ${sc0.callCount}`);
    assert.ok((sc0.callCount as number) >= 0,
      `callCount after 0 calls must be >= 0, got ${sc0.callCount}`);

    // After 2 calls: callCount must still be a finite integer.
    await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', args: {}, sessionId: SESSION });
    await agg.callTool('ch1tty/execute', { tool: 'neon/run_query', args: {}, sessionId: SESSION });
    const result2 = await agg.callTool('ch1tty/search', { query: 'list', sessionId: SESSION });
    const sc2 = (parse(result2).sessionContext as { callCount: unknown });
    assert.ok(Number.isInteger(sc2.callCount),
      `callCount after 2 calls must be an integer, got ${sc2.callCount}`);
    assert.ok(Number.isFinite(sc2.callCount as number),
      `callCount after 2 calls must be finite, got ${sc2.callCount}`);
    assert.ok((sc2.callCount as number) >= 0,
      `callCount after 2 calls must be >= 0, got ${sc2.callCount}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GCZ-5: callCount advances after real execute calls ────────────────────────

test('GCZ-5: sessionContext.callCount is > 0 after at least one successful execute call', async () => {
  const agg = makeAgg();
  try {
    const SESSION = 'gcz-5-advances';
    // Confirm baseline is 0 before any calls.
    const before = await agg.callTool('ch1tty/search', { query: 'neon', sessionId: SESSION });
    const sc0 = (parse(before).sessionContext as { callCount: number });
    assert.equal(sc0.callCount, 0, 'callCount must start at 0 before any execute calls');

    // Execute one tool.
    await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', args: {}, sessionId: SESSION });

    // callCount must now be > 0 (coordinator recorded the invocation).
    const after = await agg.callTool('ch1tty/search', { query: 'neon', sessionId: SESSION });
    const sc1 = (parse(after).sessionContext as { callCount: number });
    assert.ok(sc1.callCount > 0,
      `callCount must be > 0 after one execute call, got ${sc1.callCount}`);
  } finally {
    await agg.shutdown();
  }
});
