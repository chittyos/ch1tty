/**
 * R: ch1tty/search inFocusOnly: true
 *
 * When inFocusOnly: true is passed to ch1tty/search and a focus profile is
 * active, only tools that are within the focus are returned (hard filter).
 * Out-of-focus tools are excluded entirely. When no focus is active, the
 * param is a no-op and all tools are returned as normal.
 *
 * Covered:
 *   1. inFocusOnly: true + focus active + query → only in-focus tools returned
 *   2. inFocusOnly: true without active focus → no-op (all tools returned)
 *   3. inFocusOnly: false + focus active → lens behavior (out-of-focus tools present)
 *   4. inFocusOnly: true + focus active → response JSON includes inFocusOnly: true
 *   5. inFocusOnly: true + focus → every tool in results has inFocus: true
 *   6. Server summary + inFocusOnly: true + focus → only in-focus servers listed
 *   7. inFocusOnly: true + focus + server filter → intersection: in-focus server returns tools, out-of-focus server returns empty
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-inFocusOnly-${label}-${Date.now()}.jsonl`);
}

// stripe: in finance focus (servers: ["stripe"]; category: ecosystem also matches)
const STRIPE_CFG: ServerConfig = {
  id: 'stripe',
  name: 'Stripe',
  type: 'remote',
  access: 'readwrite',
  category: 'ecosystem',
  endpoint: 'https://stripe.test/mcp',
};

const STRIPE_TOOLS: ToolEntry[] = [
  { name: 'list_invoices', description: 'List Stripe invoices for billing and finance reporting', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_charge', description: 'Create a new Stripe charge for payment processing',     inputSchema: { type: 'object', properties: {} } },
];

// context7: NOT in finance focus (not in servers list, category "search" not in finance categories)
const CONTEXT7_CFG: ServerConfig = {
  id: 'context7',
  name: 'Context7',
  type: 'remote',
  access: 'readwrite',
  category: 'search',
  endpoint: 'https://context7.test/mcp',
};

const CONTEXT7_TOOLS: ToolEntry[] = [
  { name: 'resolve-library-id', description: 'Resolve a library ID to its documentation',  inputSchema: { type: 'object', properties: {} } },
  { name: 'get-library-docs',   description: 'Retrieve library documentation by library ID', inputSchema: { type: 'object', properties: {} } },
];

function makeStaticBackend(tools: ToolEntry[]): Backend {
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

function makeAgg(focus?: string, label?: string): Aggregator {
  const dlq = dlqPath(label ?? 'test');
  const backends = new Map<string, Backend>([
    ['stripe',   makeStaticBackend(STRIPE_TOOLS)],
    ['context7', makeStaticBackend(CONTEXT7_TOOLS)],
  ]);
  return new Aggregator([STRIPE_CFG, CONTEXT7_CFG], {
    backendFactory: (cfg) => backends.get(cfg.id) ?? makeStaticBackend([]),
    embedEnabled: false,
    ledgerDlqPath: dlq,
    ...(focus ? { focus } : {}),
  });
}

// ── 1. inFocusOnly: true + focus + query → only in-focus tools ─────────────────

test('search inFocusOnly: true + finance focus + query → only stripe tools returned', async () => {
  const agg = makeAgg('finance', '1-filter');
  try {
    // Query matches tools from both servers ("list" matches list_invoices; "resolve" matches resolve-library-id)
    // With inFocusOnly active, only stripe (in-focus) tools should appear.
    const result = await agg.callTool('ch1tty/search', { query: 'list', inFocusOnly: true });
    assert.equal(result.isError, undefined);
    const data = JSON.parse(result.content[0].text as string);
    assert.ok(Array.isArray(data.tools), 'tools array present');
    for (const tool of data.tools) {
      assert.equal(tool.server, 'stripe', `all tools from in-focus server (got ${tool.server})`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── 2. inFocusOnly: true, no focus → no-op, all tools returned ────────────────

test('search inFocusOnly: true with no active focus → no-op, all tools present', async () => {
  const agg = makeAgg(undefined, '2-noop');
  try {
    const resultWithFlag = await agg.callTool('ch1tty/search', { query: 'list', inFocusOnly: true });
    const resultWithout  = await agg.callTool('ch1tty/search', { query: 'list' });
    const withFlag    = JSON.parse(resultWithFlag.content[0].text as string);
    const withoutFlag = JSON.parse(resultWithout.content[0].text as string);
    // Same set of tools — inFocusOnly is a no-op when no focus is active
    assert.deepEqual(
      withFlag.tools.map((t: { tool: string }) => t.tool).sort(),
      withoutFlag.tools.map((t: { tool: string }) => t.tool).sort(),
      'same tools with and without inFocusOnly when no focus is set',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── 3. inFocusOnly: false + focus → lens behavior (out-of-focus tools present) ─

test('search inFocusOnly: false + focus → out-of-focus tools still present', async () => {
  const agg = makeAgg('finance', '3-lens');
  try {
    // context7 is NOT in finance focus; with inFocusOnly:false it should still appear
    const result = await agg.callTool('ch1tty/search', { query: 'library', inFocusOnly: false });
    assert.equal(result.isError, undefined);
    const data = JSON.parse(result.content[0].text as string);
    const servers = (data.tools as Array<{ server: string }>).map((t) => t.server);
    assert.ok(servers.includes('context7'), 'context7 tools present when inFocusOnly is false');
  } finally {
    await agg.shutdown();
  }
});

// ── 4. inFocusOnly: true + focus → response includes inFocusOnly: true ────────

test('search inFocusOnly: true + focus active → response JSON has inFocusOnly: true', async () => {
  const agg = makeAgg('finance', '4-field');
  try {
    const result = await agg.callTool('ch1tty/search', { query: 'invoices', inFocusOnly: true });
    assert.equal(result.isError, undefined);
    const data = JSON.parse(result.content[0].text as string);
    assert.equal(data.inFocusOnly, true, 'inFocusOnly: true present in response');
  } finally {
    await agg.shutdown();
  }
});

// ── 5. inFocusOnly: true + focus → every returned tool has inFocus: true ──────

test('search inFocusOnly: true + focus → every tool in results has inFocus: true', async () => {
  const agg = makeAgg('finance', '5-allinFocus');
  try {
    const result = await agg.callTool('ch1tty/search', { query: 'billing payment finance', inFocusOnly: true });
    assert.equal(result.isError, undefined);
    const data = JSON.parse(result.content[0].text as string);
    assert.ok(data.tools.length > 0, 'at least one tool returned');
    for (const tool of data.tools) {
      assert.equal(tool.inFocus, true, `tool ${tool.tool} should have inFocus: true`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── 6. Server summary + inFocusOnly: true + focus → only in-focus servers ─────

test('search inFocusOnly: true + focus, no query → server summary lists only in-focus servers', async () => {
  const agg = makeAgg('finance', '6-summary');
  try {
    // No query/server/category → server summary path
    const result = await agg.callTool('ch1tty/search', { inFocusOnly: true });
    assert.equal(result.isError, undefined);
    const data = JSON.parse(result.content[0].text as string);
    assert.ok(Array.isArray(data.servers), 'servers array present in summary');
    assert.equal(data.inFocusOnly, true, 'inFocusOnly field in summary response');
    for (const s of data.servers) {
      assert.equal(s.inFocus, true, `server ${s.server} should be in-focus`);
    }
    // stripe is in-focus, context7 is not
    const serverIds = (data.servers as Array<{ server: string }>).map((s) => s.server);
    assert.ok(serverIds.includes('stripe'), 'stripe (in-focus) present in summary');
    assert.ok(!serverIds.includes('context7'), 'context7 (out-of-focus) excluded from summary');
  } finally {
    await agg.shutdown();
  }
});

// ── 7. inFocusOnly + focus + serverFilter → intersection ──────────────────────

test('search inFocusOnly: true + focus + server filter → in-focus server returns tools, out-of-focus returns empty', async () => {
  const agg = makeAgg('finance', '7-intersect');
  try {
    // stripe is in finance focus → its tools should appear
    const stripeResult = await agg.callTool('ch1tty/search', { server: 'stripe', inFocusOnly: true });
    assert.equal(stripeResult.isError, undefined);
    const stripeData = JSON.parse(stripeResult.content[0].text as string);
    assert.ok(stripeData.tools.length > 0, 'stripe tools returned when server is in-focus');
    assert.ok(
      stripeData.tools.every((t: { server: string }) => t.server === 'stripe'),
      'all tools from stripe',
    );

    // context7 is NOT in finance focus → no tools should appear
    const c7Result = await agg.callTool('ch1tty/search', { server: 'context7', inFocusOnly: true });
    assert.equal(c7Result.isError, undefined);
    const c7Data = JSON.parse(c7Result.content[0].text as string);
    assert.equal(c7Data.tools.length, 0, 'context7 (out-of-focus) returns no tools when inFocusOnly is true');
  } finally {
    await agg.shutdown();
  }
});
