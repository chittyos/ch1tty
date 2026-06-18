/**
 * Workstream JJ: sessionContext in ch1tty/cast responses.
 *
 * When effectiveSessionId is active and the tool execution succeeds, cast: executed
 * and cast: chain_executed responses include sessionContext: { recentTools, callCount,
 * activeSessionFocus? } reflecting session state after execution. The sessionContext
 * is embedded in the cast metadata JSON (content[0]), not as a separate content item.
 *
 * cast: plan (confirm), cast: resolved (dryRun), cast: no_match, and cast: discovered
 * never include sessionContext — no tool execution occurred.
 *
 * Covered:
 *   1. No sessionId → no sessionContext in cast: executed
 *   2. sessionId → sessionContext present in cast: executed, recentTools includes resolved tool
 *   3. sessionContext.callCount reflects the executed call
 *   4. recentTools capped at 5 across multiple cast calls
 *   5. activeSessionFocus present when sticky focus is set
 *   6. activeSessionFocus absent when no focus is set
 *   7. cast: chain_executed → sessionContext present after all steps
 *   8. cast: executed isError → no sessionContext (execution failed)
 *   9. confirm: true (cast: plan) → no sessionContext
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-jjsc-${label}-${Date.now()}.jsonl`);
}

const NEON_CFG: ServerConfig = { id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.test/mcp' };
const STRIPE_CFG: ServerConfig = { id: 'stripe', name: 'Stripe Payments', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.test/mcp' };

function makeBackend(tools: ToolEntry[], fail = false): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: tools.length, toolCacheAge: 0 }),
    listTools: async () => tools,
    callTool: async (): Promise<ToolCallResult> =>
      fail
        ? { content: [{ type: 'text', text: 'backend-error' }], isError: true }
        : { content: [{ type: 'text', text: 'tool-output' }] },
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
  { name: 'create_payment', description: 'Create Stripe payment', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_products', description: 'List Stripe products', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_subscription', description: 'Create Stripe subscription', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_balance', description: 'Get Stripe balance', inputSchema: { type: 'object', properties: {} } },
];

const FOCUS_PROFILES = {
  profiles: {
    code: { description: 'Code tools', categories: ['code' as const], servers: ['neon'], boost: 0.5 },
  },
};

const BASE_CATALOG = {
  code: {
    combos: [
      {
        name: 'sql-then-list',
        chain: ['neon/run_sql', 'neon/list_projects'],
        accomplishes: 'Run SQL then list projects',
        verified: true,
      },
    ],
    prompts: [],
  },
};

function makeAgg(label: string, fail = false): Aggregator {
  const backends = new Map<string, Backend>([
    ['neon', makeBackend(NEON_TOOLS, fail)],
    ['stripe', makeBackend(STRIPE_TOOLS)],
  ]);
  return new Aggregator([NEON_CFG, STRIPE_CFG], {
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: BASE_CATALOG,
    backendFactory: (cfg) => backends.get(cfg.id) ?? makeBackend([]),
    embedEnabled: false,
    ledgerDlqPath: dlqPath(label),
  });
}

/** Parse the cast metadata JSON from content[0]. */
function parseCast(result: ToolCallResult): Record<string, unknown> {
  const first = result.content[0];
  assert.equal(first?.type, 'text');
  return JSON.parse(first.text) as Record<string, unknown>;
}

// ── 1. No sessionId → no sessionContext ──────────────────────────────────────

test('cast: executed — no sessionId → no sessionContext in response', async () => {
  const agg = makeAgg('1-no-session');
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list projects neon' });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'executed');
    assert.equal('sessionContext' in cast, false, 'sessionContext should be absent without sessionId');
  } finally {
    await agg.shutdown();
  }
});

// ── 2. sessionId → sessionContext present, recentTools includes resolved tool ─

test('cast: executed — sessionId → sessionContext present with resolved tool in recentTools', async () => {
  const agg = makeAgg('2-recent');
  try {
    const SESSION = 'jj-recent-session';
    const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', sessionId: SESSION });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'executed');
    const sc = cast.sessionContext as { recentTools: string[]; callCount: number } | undefined;
    assert.ok(sc, 'sessionContext should be present when sessionId is active');
    assert.ok(Array.isArray(sc.recentTools), 'recentTools should be an array');
    assert.ok(sc.recentTools.length > 0, 'recentTools should include the resolved tool');
  } finally {
    await agg.shutdown();
  }
});

// ── 3. callCount reflects the executed call ───────────────────────────────────

test('cast: executed — sessionContext.callCount increases with each cast call', async () => {
  const agg = makeAgg('3-count');
  try {
    const SESSION = 'jj-count-session';
    await agg.callTool('ch1tty/cast', { intent: 'list neon projects', sessionId: SESSION });
    await agg.callTool('ch1tty/cast', { intent: 'run sql on neon', sessionId: SESSION });
    const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects again', sessionId: SESSION });
    const cast = parseCast(result);
    const sc = cast.sessionContext as { callCount: number } | undefined;
    assert.ok(sc, 'sessionContext should be present');
    assert.ok(sc.callCount >= 3, `callCount should be at least 3 after three cast calls (got ${sc.callCount})`);
  } finally {
    await agg.shutdown();
  }
});

// ── 4. recentTools capped at 5 ────────────────────────────────────────────────

test('cast: executed — sessionContext.recentTools capped at 5', async () => {
  const agg = makeAgg('4-cap');
  try {
    const SESSION = 'jj-cap-session';
    const intents = [
      'list stripe customers',
      'create stripe invoice',
      'list neon projects',
      'run sql neon',
      'stripe payment create',
      'stripe list products',
    ];
    let result!: ToolCallResult;
    for (const intent of intents) {
      result = await agg.callTool('ch1tty/cast', { intent, sessionId: SESSION });
    }
    const cast = parseCast(result);
    const sc = cast.sessionContext as { recentTools: string[] } | undefined;
    assert.ok(sc, 'sessionContext must be present');
    assert.ok(sc.recentTools.length <= 5, `recentTools should be capped at 5 (got ${sc.recentTools.length})`);
  } finally {
    await agg.shutdown();
  }
});

// ── 5. activeSessionFocus present after sticky focus is set ──────────────────

test('cast: executed — sessionContext.activeSessionFocus present after sticky focus set', async () => {
  const agg = makeAgg('5-focus');
  try {
    const SESSION = 'jj-focus-session';
    // Set sticky focus via search
    await agg.callTool('ch1tty/search', { query: 'sql', focus: 'code', sessionId: SESSION });
    const result = await agg.callTool('ch1tty/cast', { intent: 'list projects neon', sessionId: SESSION });
    const cast = parseCast(result);
    const sc = cast.sessionContext as { activeSessionFocus?: string } | undefined;
    assert.ok(sc, 'sessionContext must be present');
    assert.equal(sc.activeSessionFocus, 'code', 'activeSessionFocus should be "code"');
  } finally {
    await agg.shutdown();
  }
});

// ── 6. activeSessionFocus absent when no focus set ───────────────────────────

test('cast: executed — sessionContext.activeSessionFocus absent when no focus has been set', async () => {
  const agg = makeAgg('6-no-focus');
  try {
    const SESSION = 'jj-nofocus-session';
    const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', sessionId: SESSION });
    const cast = parseCast(result);
    const sc = cast.sessionContext as Record<string, unknown> | undefined;
    assert.ok(sc, 'sessionContext must be present');
    assert.equal('activeSessionFocus' in sc, false, 'activeSessionFocus should be absent when no focus set');
  } finally {
    await agg.shutdown();
  }
});

// ── 7. chain_executed → sessionContext present after all steps ────────────────

test('cast: chain_executed — sessionContext present after all chain steps', async () => {
  const agg = makeAgg('7-chain');
  try {
    const SESSION = 'jj-chain-session';
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'run sql neon',
      focus: 'code',
      chain: true,
      sessionId: SESSION,
    });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'chain_executed', 'should be chain_executed when combo matches and chain:true');
    const sc = cast.sessionContext as { recentTools: string[]; callCount: number } | undefined;
    assert.ok(sc, 'sessionContext should be present in chain_executed');
    assert.ok(sc.callCount >= 2, `callCount should be >= 2 after 2-step chain (got ${sc.callCount})`);
  } finally {
    await agg.shutdown();
  }
});

// ── 8. executed with backend error → no sessionContext ───────────────────────

test('cast: executed — backend error → no sessionContext (isError response)', async () => {
  const agg = makeAgg('8-error', true);
  try {
    const SESSION = 'jj-error-session';
    const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', sessionId: SESSION });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'executed', 'cast type should still be executed');
    assert.equal('sessionContext' in cast, false, 'sessionContext must be absent when tool execution failed');
  } finally {
    await agg.shutdown();
  }
});

// ── 9. confirm: true (cast: plan) → sessionContext present (KK: plan now includes pre-execution state) ──

test('cast: plan (confirm:true) → sessionContext present showing pre-execution session state', async () => {
  const agg = makeAgg('9-plan');
  try {
    const SESSION = 'jj-plan-session';
    const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', confirm: true, sessionId: SESSION });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'plan', 'should be cast: plan with confirm:true');
    const sc = cast.sessionContext as { recentTools: string[]; callCount: number } | undefined;
    assert.ok(sc, 'sessionContext should be present in cast: plan when sessionId is active (KK)');
    assert.deepEqual(sc.recentTools, [], 'recentTools should be empty for a fresh session with no prior calls');
    assert.equal(sc.callCount, 0, 'callCount should be 0 for a fresh session with no prior calls');
  } finally {
    await agg.shutdown();
  }
});
