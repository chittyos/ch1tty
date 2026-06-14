/**
 * GG: ch1tty/search serverName field in tool results.
 *
 * Each tool result now includes `serverName` (the human-readable backend name,
 * e.g. "Neon Database") alongside `server` (the id, e.g. "neon"). This lets
 * callers display readable backend names without a separate ch1tty/status call.
 *
 * Covered here:
 *   1. serverName present in tool results
 *   2. serverName equals the human-readable backend name, not the server id
 *   3. serverName differs from server id when they are distinct strings
 *   4. serverName present with keyword query filter
 *   5. serverName present with server id filter
 *   6. serverName present with category filter
 *   7. serverName present when focus is active (inFocus tools)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-gg-${label}-${Date.now()}.jsonl`);
}

// ── Fixture server configs ────────────────────────────────────────────────────

const NEON_CFG: ServerConfig = { id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://neon.test/mcp' };
const STRIPE_CFG: ServerConfig = { id: 'stripe', name: 'Stripe Billing', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.test/mcp' };
const PLAYWRIGHT_CFG: ServerConfig = { id: 'playwright', name: 'Browser Automation', type: 'remote', access: 'readwrite', category: 'desktop', endpoint: 'https://pw.test/mcp' };

// ── Fixture tools ─────────────────────────────────────────────────────────────

const NEON_TOOLS: ToolEntry[] = [
  { name: 'list_projects', description: 'List Neon database projects', inputSchema: { type: 'object', properties: {} } },
  { name: 'run_sql', description: 'Run SQL against Neon database', inputSchema: { type: 'object', properties: { sql: { type: 'string' } } } },
];
const STRIPE_TOOLS: ToolEntry[] = [
  { name: 'create_invoice', description: 'Create a Stripe billing invoice', inputSchema: { type: 'object', properties: {} } },
];
const PLAYWRIGHT_TOOLS: ToolEntry[] = [
  { name: 'screenshot', description: 'Capture a browser screenshot', inputSchema: { type: 'object', properties: {} } },
];

const TOOL_MAP: Record<string, ToolEntry[]> = {
  neon: NEON_TOOLS,
  stripe: STRIPE_TOOLS,
  playwright: PLAYWRIGHT_TOOLS,
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

function makeAgg(label: string, cfgs: ServerConfig[], focus?: string): Aggregator {
  return new Aggregator(cfgs, {
    backendFactory: (cfg) => makeBackend(TOOL_MAP[cfg.id] ?? []),
    embedEnabled: false,
    suggestionsCatalog: { profiles: {} },
    ledgerDlqPath: dlqPath(label),
    ...(focus ? { focus } : {}),
  });
}

function parseResult(raw: ToolCallResult): Record<string, unknown> {
  const text = raw.content.find((c) => c.type === 'text');
  assert.ok(text && 'text' in text, 'expected text content');
  return JSON.parse((text as { type: 'text'; text: string }).text);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GG-1: serverName present in tool results', async () => {
  const agg = makeAgg('t1', [NEON_CFG, STRIPE_CFG]);
  try {
    const raw = await agg.callTool('ch1tty/search', { query: 'sql' });
    const resp = parseResult(raw);
    const tools = resp.tools as Array<Record<string, unknown>>;
    assert.ok(tools.length > 0, 'expected at least one tool');
    for (const t of tools) {
      assert.ok('serverName' in t, `tool ${t.tool} missing serverName`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('GG-2: serverName equals human-readable backend name, not the server id', async () => {
  const agg = makeAgg('t2', [NEON_CFG]);
  try {
    const raw = await agg.callTool('ch1tty/search', { query: 'sql' });
    const resp = parseResult(raw);
    const tools = resp.tools as Array<Record<string, unknown>>;
    assert.ok(tools.length > 0, 'expected neon tools');
    const neonTool = tools.find((t) => (t.server as string) === 'neon');
    assert.ok(neonTool, 'neon tool not found');
    assert.equal(neonTool.serverName, 'Neon Database');
  } finally {
    await agg.shutdown();
  }
});

test('GG-3: serverName differs from server id when they are distinct strings', async () => {
  const agg = makeAgg('t3', [STRIPE_CFG]);
  try {
    const raw = await agg.callTool('ch1tty/search', { query: 'invoice' });
    const resp = parseResult(raw);
    const tools = resp.tools as Array<Record<string, unknown>>;
    assert.ok(tools.length > 0, 'expected stripe tools');
    const t = tools[0];
    assert.notEqual(t.serverName, t.server, 'serverName should differ from server id');
    assert.equal(t.server, 'stripe');
    assert.equal(t.serverName, 'Stripe Billing');
  } finally {
    await agg.shutdown();
  }
});

test('GG-4: serverName present with keyword query filter', async () => {
  const agg = makeAgg('t4', [NEON_CFG, PLAYWRIGHT_CFG]);
  try {
    const raw = await agg.callTool('ch1tty/search', { query: 'screenshot' });
    const resp = parseResult(raw);
    const tools = resp.tools as Array<Record<string, unknown>>;
    assert.ok(tools.length > 0, 'expected playwright tools');
    assert.equal(tools[0].serverName, 'Browser Automation');
  } finally {
    await agg.shutdown();
  }
});

test('GG-5: serverName present with server id filter', async () => {
  const agg = makeAgg('t5', [NEON_CFG, STRIPE_CFG, PLAYWRIGHT_CFG]);
  try {
    const raw = await agg.callTool('ch1tty/search', { server: 'neon' });
    const resp = parseResult(raw);
    const tools = resp.tools as Array<Record<string, unknown>>;
    assert.ok(tools.length > 0, 'expected neon tools');
    for (const t of tools) {
      assert.equal(t.serverName, 'Neon Database');
    }
  } finally {
    await agg.shutdown();
  }
});

test('GG-6: serverName present with category filter', async () => {
  const agg = makeAgg('t6', [NEON_CFG, PLAYWRIGHT_CFG]);
  try {
    const raw = await agg.callTool('ch1tty/search', { category: 'desktop' });
    const resp = parseResult(raw);
    const tools = resp.tools as Array<Record<string, unknown>>;
    assert.ok(tools.length > 0, 'expected desktop (playwright) tools');
    for (const t of tools) {
      assert.equal(t.serverName, 'Browser Automation');
    }
  } finally {
    await agg.shutdown();
  }
});

test('GG-7: serverName present when focus is active (inFocus tools)', async () => {
  const agg = makeAgg('t7', [NEON_CFG, STRIPE_CFG, PLAYWRIGHT_CFG], 'finance');
  try {
    // finance profile boosts ecosystem servers — neon + stripe are ecosystem
    const raw = await agg.callTool('ch1tty/search', { query: 'sql invoice' });
    const resp = parseResult(raw);
    const tools = resp.tools as Array<Record<string, unknown>>;
    assert.ok(tools.length > 0, 'expected tools with finance focus');
    for (const t of tools) {
      assert.ok('serverName' in t, `tool ${t.tool} missing serverName under focus`);
      assert.ok(typeof t.serverName === 'string' && t.serverName.length > 0, 'serverName must be non-empty string');
    }
  } finally {
    await agg.shutdown();
  }
});
