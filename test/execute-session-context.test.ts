/**
 * Workstream II: sessionContext in ch1tty/execute response.
 *
 * When effectiveSessionId is active and the tool call succeeds, a second content
 * item containing sessionContext: { recentTools, callCount, activeSessionFocus? }
 * is appended to the response. This mirrors the FF pattern for ch1tty/search.
 *
 * The first content item (content[0]) is always the raw tool output — unchanged.
 * The sessionContext item (content[1]) is additive; callers that don't need it
 * simply ignore it.
 *
 * Covered:
 *   1. No sessionId → no sessionContext item appended
 *   2. sessionId, zero prior calls → sessionContext present, recentTools includes the just-executed tool
 *   3. sessionContext.callCount includes the current call
 *   4. recentTools capped at 5 across multiple calls
 *   5. activeSessionFocus present when sticky focus is set
 *   6. activeSessionFocus absent when no focus is set
 *   7. dryRun: true → sessionContext present (pre-execution state; dry_run call not recorded)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-iisc-${label}-${Date.now()}.jsonl`);
}

const NEON_CFG: ServerConfig = { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.test/mcp' };
const STRIPE_CFG: ServerConfig = { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.test/mcp' };
const GITHUB_CFG: ServerConfig = { id: 'github', name: 'GitHub', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://github.test/mcp' };

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
const GITHUB_TOOLS: ToolEntry[] = [
  { name: 'list_prs', description: 'List GitHub PRs', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_issue', description: 'Create GitHub issue', inputSchema: { type: 'object', properties: {} } },
];

const FOCUS_PROFILES = {
  profiles: {
    code: { description: 'Code tools', categories: ['code' as const], servers: ['github', 'neon'], boost: 0.5 },
  },
};

const CONFIGS = [NEON_CFG, STRIPE_CFG, GITHUB_CFG];

function makeAgg(label: string): Aggregator {
  const backends = new Map<string, Backend>([
    ['neon', makeBackend(NEON_TOOLS)],
    ['stripe', makeBackend(STRIPE_TOOLS)],
    ['github', makeBackend(GITHUB_TOOLS)],
  ]);
  return new Aggregator(CONFIGS, {
    focusProfiles: FOCUS_PROFILES,
    backendFactory: (cfg) => backends.get(cfg.id) ?? makeBackend([]),
    embedEnabled: false,
    ledgerDlqPath: dlqPath(label),
  });
}

/** Find the sessionContext item from the execute response content. */
function findSessionContext(result: ToolCallResult): { recentTools: string[]; callCount: number; activeSessionFocus?: string } | undefined {
  for (const item of result.content) {
    if (item.type !== 'text') continue;
    try {
      const parsed = JSON.parse(item.text);
      if (parsed.sessionContext) return parsed.sessionContext as { recentTools: string[]; callCount: number; activeSessionFocus?: string };
    } catch {
      // not JSON or no sessionContext key
    }
  }
  return undefined;
}

// ── 1. No sessionId → no sessionContext ──────────────────────────────────────

test('execute: no sessionId → no sessionContext appended', async () => {
  const agg = makeAgg('1-no-session');
  try {
    const result = await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', args: {} });
    assert.equal(findSessionContext(result), undefined, 'sessionContext should be absent without sessionId');
    assert.equal(result.content.length, 1, 'only one content item (raw tool output)');
  } finally {
    await agg.shutdown();
  }
});

// ── 2. sessionId → sessionContext present, recentTools includes current call ──

test('execute: sessionId → sessionContext includes the just-executed tool in recentTools', async () => {
  const agg = makeAgg('2-recent');
  try {
    const SESSION = 'ii-recent-session';
    const result = await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', args: {}, sessionId: SESSION });
    const sc = findSessionContext(result);
    assert.ok(sc, 'sessionContext should be present when sessionId is active');
    assert.ok(sc.recentTools.includes('neon/list_projects'), 'just-executed tool must appear in recentTools');
  } finally {
    await agg.shutdown();
  }
});

// ── 3. callCount includes the current call ────────────────────────────────────

test('execute: sessionContext.callCount reflects all calls including the current one', async () => {
  const agg = makeAgg('3-count');
  try {
    const SESSION = 'ii-count-session';
    await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', args: {}, sessionId: SESSION });
    await agg.callTool('ch1tty/execute', { tool: 'neon/run_sql', args: {}, sessionId: SESSION });
    const result = await agg.callTool('ch1tty/execute', { tool: 'stripe/list_customers', args: {}, sessionId: SESSION });
    const sc = findSessionContext(result);
    assert.ok(sc, 'sessionContext should be present');
    assert.equal(sc.callCount, 3, 'callCount should be 3 after three execute calls');
  } finally {
    await agg.shutdown();
  }
});

// ── 4. recentTools capped at 5 ────────────────────────────────────────────────

test('execute: sessionContext.recentTools capped at 5 even with more distinct tools called', async () => {
  const agg = makeAgg('4-cap');
  try {
    const SESSION = 'ii-cap-session';
    const tools = [
      'neon/list_projects', 'neon/run_sql',
      'stripe/list_customers', 'stripe/create_invoice',
      'github/list_prs', 'github/create_issue',
    ];
    let result!: ToolCallResult;
    for (const t of tools) {
      result = await agg.callTool('ch1tty/execute', { tool: t, args: {}, sessionId: SESSION });
    }
    const sc = findSessionContext(result);
    assert.ok(sc, 'sessionContext must be present');
    assert.ok(sc.recentTools.length <= 5, `recentTools capped at 5 (got ${sc.recentTools.length})`);
  } finally {
    await agg.shutdown();
  }
});

// ── 5. activeSessionFocus present when sticky focus is set ───────────────────

test('execute: sessionContext.activeSessionFocus present after sticky focus is set via search', async () => {
  const agg = makeAgg('5-focus');
  try {
    const SESSION = 'ii-focus-session';
    // Set sticky focus via search
    await agg.callTool('ch1tty/search', { query: 'sql', focus: 'code', sessionId: SESSION });
    const result = await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', args: {}, sessionId: SESSION });
    const sc = findSessionContext(result);
    assert.ok(sc, 'sessionContext must be present');
    assert.equal(sc.activeSessionFocus, 'code', 'activeSessionFocus should reflect the sticky focus set via search');
  } finally {
    await agg.shutdown();
  }
});

// ── 6. activeSessionFocus absent when no focus set ───────────────────────────

test('execute: sessionContext.activeSessionFocus absent when no focus has been set', async () => {
  const agg = makeAgg('6-no-focus');
  try {
    const SESSION = 'ii-nofocus-session';
    const result = await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', args: {}, sessionId: SESSION });
    const sc = findSessionContext(result);
    assert.ok(sc, 'sessionContext must be present');
    assert.equal('activeSessionFocus' in sc, false, 'activeSessionFocus should be absent when no focus set');
  } finally {
    await agg.shutdown();
  }
});

// ── 7. dryRun: true → sessionContext present (reflects pre-execution state) ───
// QQ: dryRun now includes sessionContext embedded in the dry_run JSON.
// The dry_run call itself is NOT recorded in the coordinator — callCount stays 0.

test('execute: dryRun:true → sessionContext present; dry_run call not recorded in callCount', async () => {
  const agg = makeAgg('7-dryrun');
  try {
    const SESSION = 'ii-dryrun-session';
    const result = await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', args: {}, sessionId: SESSION, dryRun: true });
    const sc = findSessionContext(result);
    assert.ok(sc, 'sessionContext should be present in dry_run response when sessionId is active (QQ)');
    assert.equal(sc.callCount, 0, 'dry_run call must NOT be recorded — callCount stays 0');
    assert.deepEqual(sc.recentTools, [], 'recentTools should be empty for a fresh session');
  } finally {
    await agg.shutdown();
  }
});
