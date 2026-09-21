/**
 * FC — ch1tty/search: server-summary explanation field drift guard
 *
 * When no query/server/category filter is provided, ch1tty/search returns a server
 * summary response. With explain:true, the response includes an explanation object
 * built by the inline server-summary path (NOT buildSearchExplanation). This file
 * freezes the exact key sets and value types so new fields cannot drift in silently.
 *
 * Covered:
 *   Suite 1 — Always-present explanation keys (3 tests)
 *     1. Exact base key set: ['method','rationale','totalServers','totalTools']
 *     2. No focus → focus/inFocusServers/inFocusOnly absent from explanation
 *     3. explain omitted → no explanation field
 *   Suite 2 — Focus conditional keys (2 tests)
 *     4. Focus active → exact 6-key set (adds 'focus'+'inFocusServers')
 *     5. inFocusOnly active → exact 7-key set (adds 'inFocusOnly')
 *   Suite 3 — Value types (5 tests)
 *     6. method === 'server_summary'
 *     7. totalServers is finite integer >= 0
 *     8. totalTools is finite integer >= 0
 *     9. rationale is non-empty string
 *    10. inFocusServers is finite integer >= 0 when focus active
 *   Suite 4 — Server item shape (2 tests)
 *    11. No focus: each server item has exactly ['category','name','server','tools']
 *    12. Focus active: each server item has exactly ['category','inFocus','name','server','tools']
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
  return join(tmpdir(), `ch1tty-fc-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
}

const BASE_EXPLAIN_KEYS: readonly string[] = ['method', 'rationale', 'totalServers', 'totalTools'];
const FOCUS_EXPLAIN_KEYS: readonly string[] = ['focus', 'inFocusServers', 'method', 'rationale', 'totalServers', 'totalTools'];
const FOCUS_INFOCUSONLY_EXPLAIN_KEYS: readonly string[] = ['focus', 'inFocusOnly', 'inFocusServers', 'method', 'rationale', 'totalServers', 'totalTools'];
const NO_FOCUS_SERVER_ITEM_KEYS: readonly string[] = ['category', 'name', 'server', 'tools'];
const FOCUS_SERVER_ITEM_KEYS: readonly string[] = ['category', 'inFocus', 'name', 'server', 'tools'];

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

// ── Suite 1: Always-present explanation keys ─────────────────────────────────

test('FC-1: no-query explain:true → exact base explanation key set', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/search', { explain: true });
    assert.equal(result.isError, undefined);
    const data = parseData(result);
    assert.ok(data.explanation, 'explanation field present');
    const keys = Object.keys(data.explanation as object).sort();
    assert.deepEqual(keys, [...BASE_EXPLAIN_KEYS].sort(), 'exact base key set');
  } finally {
    await agg.shutdown();
  }
});

test('FC-2: no focus active → focus/inFocusServers/inFocusOnly absent from explanation', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/search', { explain: true });
    assert.equal(result.isError, undefined);
    const exp = (parseData(result).explanation as Record<string, unknown>);
    assert.equal(exp.focus, undefined, 'no focus field');
    assert.equal(exp.inFocusServers, undefined, 'no inFocusServers');
    assert.equal(exp.inFocusOnly, undefined, 'no inFocusOnly');
  } finally {
    await agg.shutdown();
  }
});

test('FC-3: explain omitted → no explanation field in server-summary response', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/search', {});
    assert.equal(result.isError, undefined);
    const data = parseData(result);
    assert.equal(data.explanation, undefined, 'no explanation when explain omitted');
    assert.ok(Array.isArray(data.servers), 'servers field still present');
  } finally {
    await agg.shutdown();
  }
});

// ── Suite 2: Focus conditional keys ──────────────────────────────────────────

test('FC-4: focus active → exact 6-key explanation set (adds focus+inFocusServers)', async () => {
  const agg = makeAggregator(true);
  try {
    const result = await agg.callTool('ch1tty/search', { explain: true });
    assert.equal(result.isError, undefined);
    const data = parseData(result);
    assert.ok(data.explanation, 'explanation field present');
    const keys = Object.keys(data.explanation as object).sort();
    assert.deepEqual(keys, [...FOCUS_EXPLAIN_KEYS].sort(), 'exact focus key set');
  } finally {
    await agg.shutdown();
  }
});

test('FC-5: inFocusOnly active → exact 7-key explanation set (adds inFocusOnly)', async () => {
  const agg = makeAggregator(true);
  try {
    const result = await agg.callTool('ch1tty/search', { explain: true, inFocusOnly: true });
    assert.equal(result.isError, undefined);
    const data = parseData(result);
    assert.ok(data.explanation, 'explanation field present');
    const keys = Object.keys(data.explanation as object).sort();
    assert.deepEqual(keys, [...FOCUS_INFOCUSONLY_EXPLAIN_KEYS].sort(), 'exact inFocusOnly key set');
  } finally {
    await agg.shutdown();
  }
});

// ── Suite 3: Value types ──────────────────────────────────────────────────────

test('FC-6: method === "server_summary"', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/search', { explain: true });
    assert.equal(result.isError, undefined);
    const exp = (parseData(result).explanation as Record<string, unknown>);
    assert.equal(exp.method, 'server_summary', 'method is server_summary');
  } finally {
    await agg.shutdown();
  }
});

test('FC-7: totalServers is finite integer >= 0', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/search', { explain: true });
    assert.equal(result.isError, undefined);
    const exp = (parseData(result).explanation as Record<string, unknown>);
    const ts = exp.totalServers as number;
    assert.ok(Number.isFinite(ts), 'totalServers is finite');
    assert.ok(Number.isInteger(ts), 'totalServers is integer');
    assert.ok(ts >= 0, 'totalServers >= 0');
  } finally {
    await agg.shutdown();
  }
});

test('FC-8: totalTools is finite integer >= 0', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/search', { explain: true });
    assert.equal(result.isError, undefined);
    const exp = (parseData(result).explanation as Record<string, unknown>);
    const tt = exp.totalTools as number;
    assert.ok(Number.isFinite(tt), 'totalTools is finite');
    assert.ok(Number.isInteger(tt), 'totalTools is integer');
    assert.ok(tt >= 0, 'totalTools >= 0');
  } finally {
    await agg.shutdown();
  }
});

test('FC-9: rationale is non-empty string', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/search', { explain: true });
    assert.equal(result.isError, undefined);
    const exp = (parseData(result).explanation as Record<string, unknown>);
    assert.ok(typeof exp.rationale === 'string', 'rationale is a string');
    assert.ok((exp.rationale as string).length > 0, 'rationale is non-empty');
  } finally {
    await agg.shutdown();
  }
});

test('FC-10: inFocusServers is finite integer >= 0 when focus active', async () => {
  const agg = makeAggregator(true);
  try {
    const result = await agg.callTool('ch1tty/search', { explain: true });
    assert.equal(result.isError, undefined);
    const exp = (parseData(result).explanation as Record<string, unknown>);
    const ifs = exp.inFocusServers as number;
    assert.ok(Number.isFinite(ifs), 'inFocusServers is finite');
    assert.ok(Number.isInteger(ifs), 'inFocusServers is integer');
    assert.ok(ifs >= 0, 'inFocusServers >= 0');
  } finally {
    await agg.shutdown();
  }
});

// ── Suite 4: Server item shape ────────────────────────────────────────────────

test('FC-11: no focus → each server item has exactly [category,name,server,tools]', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/search', {});
    assert.equal(result.isError, undefined);
    const data = parseData(result);
    const servers = data.servers as Record<string, unknown>[];
    assert.ok(servers.length > 0, 'at least one server item');
    for (const item of servers) {
      const itemKeys = Object.keys(item).sort();
      assert.deepEqual(itemKeys, [...NO_FOCUS_SERVER_ITEM_KEYS].sort(), `item keys for server ${item.server}`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('FC-12: focus active → each server item has exactly [category,inFocus,name,server,tools]', async () => {
  const agg = makeAggregator(true);
  try {
    const result = await agg.callTool('ch1tty/search', {});
    assert.equal(result.isError, undefined);
    const data = parseData(result);
    const servers = data.servers as Record<string, unknown>[];
    assert.ok(servers.length > 0, 'at least one server item');
    for (const item of servers) {
      const itemKeys = Object.keys(item).sort();
      assert.deepEqual(itemKeys, [...FOCUS_SERVER_ITEM_KEYS].sort(), `item keys for server ${item.server}`);
      assert.ok(typeof item.inFocus === 'boolean', `inFocus is boolean on server ${item.server}`);
    }
  } finally {
    await agg.shutdown();
  }
});
