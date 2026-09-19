/**
 * FD — ch1tty/search: keyword response envelope + tool item drift guard
 *
 * When a query is provided, ch1tty/search returns a keyword search response.
 * FB froze the explain sub-object; FC froze the server-summary path.
 * FD freezes the top-level keyword response envelope and the tools array item
 * shape so new fields cannot drift in silently on either layer.
 *
 * Covered:
 *   Suite 1 — Top-level always-present keys (3 tests)
 *     1. Exact base key set: ['latencyMs','matches','total','tools']
 *     2. No focus → focus/inFocusOnly/suggestions absent
 *     3. No minScore param → minScore absent; no offset param → offset absent
 *   Suite 2 — Top-level conditional keys (2 tests)
 *     4. Focus active → exact 5-key set (adds 'focus')
 *     5. inFocusOnly + focus → exact 6-key set (adds 'inFocusOnly')
 *   Suite 3 — Tool item shape (2 tests)
 *     6. Base tool item: exact ['category','description','inputSchema','score','server','serverName','tool']
 *     7. Focus: in-focus item adds 'inFocus'; out-of-focus item does NOT have 'inFocus'
 *   Suite 4 — Value types (5 tests)
 *     8.  matches and total are finite non-negative integers
 *     9.  latencyMs is finite non-negative number
 *    10.  tools is an array
 *    11.  score on each item is finite number >= 0
 *    12.  tool on each item contains '/' (namespaced)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig, ToolCallResult } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';
import type { FixtureToolDef } from './fixture-backend.js';

function dlq(): string {
  return join(tmpdir(), `ch1tty-fd-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
}

const BASE_ENVELOPE_KEYS: readonly string[] = ['latencyMs', 'matches', 'total', 'tools'];
const FOCUS_ENVELOPE_KEYS: readonly string[] = ['focus', 'latencyMs', 'matches', 'total', 'tools'];
const FOCUS_INFOCUSONLY_ENVELOPE_KEYS: readonly string[] = ['focus', 'inFocusOnly', 'latencyMs', 'matches', 'total', 'tools'];
const BASE_TOOL_ITEM_KEYS: readonly string[] = ['category', 'description', 'inputSchema', 'score', 'server', 'serverName', 'tool'];
const FOCUS_TOOL_ITEM_KEYS: readonly string[] = ['category', 'description', 'inFocus', 'inputSchema', 'score', 'server', 'serverName', 'tool'];

const simpleTool = (name: string, description: string): FixtureToolDef => ({
  name,
  description,
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text', text: 'ok' }] },
});

const ALPHA_TOOLS: FixtureToolDef[] = [
  simpleTool('list_databases', 'List all databases in the code project'),
  simpleTool('create_database', 'Create a new database for code development'),
];
const BETA_TOOLS: FixtureToolDef[] = [
  simpleTool('list_invoices', 'List invoices for billing and accounting'),
  simpleTool('process_payment', 'Process a payment for invoice billing'),
];

const ALPHA_CFG: ServerConfig = {
  id: 'alpha', name: 'Alpha', type: 'remote', access: 'readwrite', category: 'code',
  endpoint: 'https://alpha.test/mcp',
};
const BETA_CFG: ServerConfig = {
  id: 'beta', name: 'Beta', type: 'remote', access: 'readwrite', category: 'ecosystem',
  endpoint: 'https://beta.test/mcp',
};

const FOCUS_PROFILES = {
  profiles: {
    dev: { categories: ['code'] as string[], servers: ['alpha'] as string[], boost: 0.5 },
  },
};

function makeAggregator(withFocus = false): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('alpha', { tools: ALPHA_TOOLS });
  backend.defineServer('beta', { tools: BETA_TOOLS });
  return new Aggregator([ALPHA_CFG, BETA_CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    ...(withFocus ? { focus: 'dev', focusProfiles: FOCUS_PROFILES } : {}),
  });
}

function parseData(result: ToolCallResult): Record<string, unknown> {
  return JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as Record<string, unknown>;
}

// ── Suite 1: Top-level always-present keys ────────────────────────────────────

test('FD-1: keyword search → exact base envelope key set', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/search', { query: 'database' });
    assert.equal(result.isError, undefined);
    const data = parseData(result);
    const keys = Object.keys(data).sort();
    assert.deepEqual(keys, [...BASE_ENVELOPE_KEYS].sort(), 'exact base envelope key set');
  } finally {
    await agg.shutdown();
  }
});

test('FD-2: no focus → focus/inFocusOnly/suggestions absent', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/search', { query: 'database' });
    assert.equal(result.isError, undefined);
    const data = parseData(result);
    assert.equal(data.focus, undefined, 'no focus field');
    assert.equal(data.inFocusOnly, undefined, 'no inFocusOnly');
    assert.equal(data.suggestions, undefined, 'no suggestions');
  } finally {
    await agg.shutdown();
  }
});

test('FD-3: no minScore/offset params → minScore and offset absent', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/search', { query: 'database' });
    assert.equal(result.isError, undefined);
    const data = parseData(result);
    assert.equal(data.minScore, undefined, 'no minScore when param omitted');
    assert.equal(data.offset, undefined, 'no offset when param omitted');
  } finally {
    await agg.shutdown();
  }
});

// ── Suite 2: Top-level conditional keys ──────────────────────────────────────

test('FD-4: focus active → exact 5-key envelope (adds focus)', async () => {
  const agg = makeAggregator(true);
  try {
    const result = await agg.callTool('ch1tty/search', { query: 'database' });
    assert.equal(result.isError, undefined);
    const data = parseData(result);
    const keys = Object.keys(data).sort();
    assert.deepEqual(keys, [...FOCUS_ENVELOPE_KEYS].sort(), 'exact focus envelope key set');
  } finally {
    await agg.shutdown();
  }
});

test('FD-5: inFocusOnly + focus → exact 6-key envelope (adds inFocusOnly)', async () => {
  const agg = makeAggregator(true);
  try {
    const result = await agg.callTool('ch1tty/search', { query: 'database', inFocusOnly: true });
    assert.equal(result.isError, undefined);
    const data = parseData(result);
    const keys = Object.keys(data).sort();
    assert.deepEqual(keys, [...FOCUS_INFOCUSONLY_ENVELOPE_KEYS].sort(), 'exact inFocusOnly envelope key set');
  } finally {
    await agg.shutdown();
  }
});

// ── Suite 3: Tool item shape ──────────────────────────────────────────────────

test('FD-6: no focus → each tool item has exactly [category,description,inputSchema,score,server,serverName,tool]', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/search', { query: 'database' });
    assert.equal(result.isError, undefined);
    const data = parseData(result);
    const tools = data.tools as Record<string, unknown>[];
    assert.ok(tools.length > 0, 'at least one tool result');
    for (const item of tools) {
      const itemKeys = Object.keys(item).sort();
      assert.deepEqual(itemKeys, [...BASE_TOOL_ITEM_KEYS].sort(), `item keys for tool ${item.tool}`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('FD-7: focus active → in-focus item adds inFocus:true; out-of-focus item has no inFocus', async () => {
  const agg = makeAggregator(true);
  try {
    // 'list' matches both alpha/list_databases (in focus) and beta/list_invoices (out of focus)
    const result = await agg.callTool('ch1tty/search', { query: 'list' });
    assert.equal(result.isError, undefined);
    const data = parseData(result);
    const tools = data.tools as Record<string, unknown>[];
    assert.ok(tools.length > 0, 'at least one tool result');
    const inFocusItems = tools.filter((t) => t.inFocus === true);
    const outOfFocusItems = tools.filter((t) => t.inFocus === undefined);
    assert.ok(inFocusItems.length > 0, 'at least one in-focus item');
    assert.ok(outOfFocusItems.length > 0, 'at least one out-of-focus item (lens not gate)');
    for (const item of inFocusItems) {
      const itemKeys = Object.keys(item).sort();
      assert.deepEqual(itemKeys, [...FOCUS_TOOL_ITEM_KEYS].sort(), `in-focus item keys for tool ${item.tool}`);
    }
    for (const item of outOfFocusItems) {
      const itemKeys = Object.keys(item).sort();
      assert.deepEqual(itemKeys, [...BASE_TOOL_ITEM_KEYS].sort(), `out-of-focus item keys for tool ${item.tool}`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── Suite 4: Value types ──────────────────────────────────────────────────────

test('FD-8: matches and total are finite non-negative integers', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/search', { query: 'database' });
    assert.equal(result.isError, undefined);
    const data = parseData(result);
    const m = data.matches as number;
    const t = data.total as number;
    assert.ok(Number.isFinite(m) && Number.isInteger(m) && m >= 0, 'matches is finite non-negative integer');
    assert.ok(Number.isFinite(t) && Number.isInteger(t) && t >= 0, 'total is finite non-negative integer');
  } finally {
    await agg.shutdown();
  }
});

test('FD-9: latencyMs is finite non-negative number', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/search', { query: 'database' });
    assert.equal(result.isError, undefined);
    const data = parseData(result);
    const lms = data.latencyMs as number;
    assert.ok(Number.isFinite(lms), 'latencyMs is finite');
    assert.ok(lms >= 0, 'latencyMs >= 0');
  } finally {
    await agg.shutdown();
  }
});

test('FD-10: tools is an array', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/search', { query: 'database' });
    assert.equal(result.isError, undefined);
    const data = parseData(result);
    assert.ok(Array.isArray(data.tools), 'tools is an array');
  } finally {
    await agg.shutdown();
  }
});

test('FD-11: score on each tool item is finite number >= 0', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/search', { query: 'database' });
    assert.equal(result.isError, undefined);
    const tools = (parseData(result).tools as Record<string, unknown>[]);
    assert.ok(tools.length > 0, 'at least one tool result');
    for (const item of tools) {
      const s = item.score as number;
      assert.ok(Number.isFinite(s), `score is finite on ${item.tool}`);
      assert.ok(s >= 0, `score >= 0 on ${item.tool}`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('FD-12: tool on each item is namespaced (contains "/")', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/search', { query: 'database' });
    assert.equal(result.isError, undefined);
    const tools = (parseData(result).tools as Record<string, unknown>[]);
    assert.ok(tools.length > 0, 'at least one tool result');
    for (const item of tools) {
      assert.ok(typeof item.tool === 'string', `tool is string on ${item.tool}`);
      assert.ok((item.tool as string).includes('/'), `tool is namespaced on ${item.tool}`);
    }
  } finally {
    await agg.shutdown();
  }
});
