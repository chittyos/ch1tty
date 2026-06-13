/**
 * Workstream FF: sessionContext in ch1tty/search response.
 *
 * When effectiveSessionId is active, the search response includes
 * sessionContext: { recentTools, callCount, activeSessionFocus? }
 * giving clients a one-shot picture of session state alongside search results.
 *
 * Covered:
 *   1. No sessionId → no sessionContext field
 *   2. sessionId, zero calls → recentTools:[], callCount:0, no activeSessionFocus
 *   3. sessionId after tool calls → recentTools includes called tools
 *   4. recentTools capped at 5
 *   5. callCount reflects total calls (summed across all tools)
 *   6. activeSessionFocus present when sticky focus is set
 *   7. activeSessionFocus absent after focus cleared with focus:"none"
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-sc-${label}-${Date.now()}.jsonl`);
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
    callTool: async (): Promise<ToolCallResult> => ({ content: [{ type: 'text', text: 'ok' }] }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

const NEON_TOOLS: ToolEntry[] = [
  { name: 'list_projects', description: 'List all Neon database projects', inputSchema: { type: 'object', properties: {} } },
  { name: 'run_query', description: 'Run a SQL query on a Neon database', inputSchema: { type: 'object', properties: {} } },
];
const STRIPE_TOOLS: ToolEntry[] = [
  { name: 'list_customers', description: 'List Stripe billing customers', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_invoice', description: 'Create a new Stripe invoice', inputSchema: { type: 'object', properties: {} } },
];
const GITHUB_TOOLS: ToolEntry[] = [
  { name: 'list_pull_requests', description: 'List GitHub pull requests', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_issue', description: 'Create a GitHub issue', inputSchema: { type: 'object', properties: {} } },
];

const FOCUS_PROFILES = {
  profiles: {
    code: { description: 'Code tools', categories: ['code' as const], servers: ['github', 'neon'], boost: 0.5 },
  },
};

const CONFIGS = [NEON_CFG, STRIPE_CFG, GITHUB_CFG];

function makeAgg(label: string, focus?: string): Aggregator {
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
    ...(focus ? { focus } : {}),
  });
}

function parseText(result: { content: Array<{ type: string; text?: string }> }) {
  const item = result.content.find((c) => c.type === 'text');
  assert.ok(item?.text, 'Expected text content');
  return JSON.parse(item.text);
}

// ── 1. No sessionId → no sessionContext ───────────────────────────────────────

test('sessionContext absent when no sessionId', async () => {
  const agg = makeAgg('1-no-session');
  try {
    const result = await agg.callTool('ch1tty/search', { query: 'list' });
    const parsed = parseText(result);
    assert.equal('sessionContext' in parsed, false);
  } finally {
    await agg.shutdown();
  }
});

// ── 2. sessionId, zero calls → empty context ─────────────────────────────────

test('sessionContext with sessionId, zero calls → recentTools:[], callCount:0, no activeSessionFocus', async () => {
  const agg = makeAgg('2-empty');
  try {
    const SESSION = 'ff-empty-session';
    const result = await agg.callTool('ch1tty/search', { query: 'list', sessionId: SESSION });
    const parsed = parseText(result);
    assert.ok(parsed.sessionContext, 'sessionContext must be present');
    assert.deepEqual(parsed.sessionContext.recentTools, []);
    assert.equal(parsed.sessionContext.callCount, 0);
    assert.equal('activeSessionFocus' in parsed.sessionContext, false);
  } finally {
    await agg.shutdown();
  }
});

// ── 3. recentTools includes called tools ──────────────────────────────────────

test('sessionContext.recentTools includes tools called in session', async () => {
  const agg = makeAgg('3-recent');
  try {
    const SESSION = 'ff-recent-tools';
    await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', args: {}, sessionId: SESSION });
    const result = await agg.callTool('ch1tty/search', { query: 'database', sessionId: SESSION });
    const parsed = parseText(result);
    assert.ok(parsed.sessionContext.recentTools.includes('neon/list_projects'), 'recentTools should contain the called tool');
  } finally {
    await agg.shutdown();
  }
});

// ── 4. recentTools capped at 5 ────────────────────────────────────────────────

test('sessionContext.recentTools capped at 5', async () => {
  const agg = makeAgg('4-cap');
  try {
    const SESSION = 'ff-cap-session';
    // Call 6 distinct tools
    const tools = [
      'neon/list_projects', 'neon/run_query',
      'stripe/list_customers', 'stripe/create_invoice',
      'github/list_pull_requests', 'github/create_issue',
    ];
    for (const t of tools) {
      await agg.callTool('ch1tty/execute', { tool: t, args: {}, sessionId: SESSION });
    }
    const result = await agg.callTool('ch1tty/search', { query: 'list', sessionId: SESSION });
    const parsed = parseText(result);
    assert.ok(parsed.sessionContext.recentTools.length <= 5, `recentTools must be capped at 5 (got ${parsed.sessionContext.recentTools.length})`);
  } finally {
    await agg.shutdown();
  }
});

// ── 5. callCount reflects total calls ────────────────────────────────────────

test('sessionContext.callCount reflects total tool invocations across all tools', async () => {
  const agg = makeAgg('5-count');
  try {
    const SESSION = 'ff-count-session';
    await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', args: {}, sessionId: SESSION });
    await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', args: {}, sessionId: SESSION });
    await agg.callTool('ch1tty/execute', { tool: 'stripe/list_customers', args: {}, sessionId: SESSION });
    const result = await agg.callTool('ch1tty/search', { query: 'list', sessionId: SESSION });
    const parsed = parseText(result);
    assert.equal(parsed.sessionContext.callCount, 3);
  } finally {
    await agg.shutdown();
  }
});

// ── 6. activeSessionFocus present when sticky focus is set ───────────────────

test('sessionContext.activeSessionFocus present after sticky focus is set', async () => {
  const agg = makeAgg('6-focus');
  try {
    const SESSION = 'ff-focus-session';
    // Set sticky focus via explicit focus param on first search
    await agg.callTool('ch1tty/search', { query: 'list', focus: 'code', sessionId: SESSION });
    // Next search inherits sticky focus — sessionContext should report it
    const result = await agg.callTool('ch1tty/search', { query: 'database', sessionId: SESSION });
    const parsed = parseText(result);
    assert.equal(parsed.sessionContext.activeSessionFocus, 'code');
  } finally {
    await agg.shutdown();
  }
});

// ── 7. activeSessionFocus absent after focus:"none" ──────────────────────────

test('sessionContext.activeSessionFocus absent after focus cleared with focus:"none"', async () => {
  const agg = makeAgg('7-clear');
  try {
    const SESSION = 'ff-clear-session';
    await agg.callTool('ch1tty/search', { query: 'list', focus: 'code', sessionId: SESSION });
    await agg.callTool('ch1tty/search', { query: 'list', focus: 'none', sessionId: SESSION });
    const result = await agg.callTool('ch1tty/search', { query: 'database', sessionId: SESSION });
    const parsed = parseText(result);
    assert.ok(parsed.sessionContext, 'sessionContext still present even after focus cleared');
    assert.equal('activeSessionFocus' in parsed.sessionContext, false, 'no activeSessionFocus after focus cleared');
  } finally {
    await agg.shutdown();
  }
});
