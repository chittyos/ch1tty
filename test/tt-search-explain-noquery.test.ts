/**
 * TT — ch1tty/search explain: true in no-query (server-summary) path
 *
 * When explain: true is set but no query is provided, the server-summary response now
 * includes an explanation field with method:'server_summary', totalServers, totalTools,
 * optional focus info, and a rationale string.
 *
 * Covered:
 *   1. explain:true, no query → explanation.method === 'server_summary'
 *   2. explanation.totalServers and totalTools correct
 *   3. No focus active → explanation.focus and inFocusServers absent
 *   4. Focus active → explanation.focus and inFocusServers present
 *   5. inFocusOnly:true + focus → explanation.inFocusOnly:true
 *   6. explanation.rationale is a non-empty string mentioning "server summary"
 *   7. explain:false → no explanation field in server-summary response
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-tt-${label}-${Date.now()}.jsonl`);
}

const FOCUS_PROFILES = {
  profiles: {
    finance: { description: 'Finance tools', categories: ['finance' as const], servers: ['finance-svc'], boost: 0.5 },
    code: { description: 'Code tools', categories: ['code' as const], servers: ['widgets'], boost: 0.5 },
  },
};

const WIDGETS_CFG: ServerConfig = {
  id: 'widgets', name: 'Widgets', type: 'remote', access: 'readwrite', category: 'ecosystem',
  endpoint: 'https://widgets.test/mcp',
};
const FINANCE_CFG: ServerConfig = {
  id: 'finance-svc', name: 'Finance Service', type: 'remote', access: 'readwrite', category: 'finance',
  endpoint: 'https://finance.test/mcp',
};

const WIDGETS_TOOLS: ToolEntry[] = [
  { name: 'list_widgets', description: 'List all widgets', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_widget', description: 'Create a widget', inputSchema: { type: 'object', properties: {} } },
];
const FINANCE_TOOLS: ToolEntry[] = [
  { name: 'get_balance', description: 'Get account balance', inputSchema: { type: 'object', properties: {} } },
];

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

function makeAgg(label: string) {
  const widgetsBackend = makeBackend(WIDGETS_TOOLS);
  const financeBackend = makeBackend(FINANCE_TOOLS);
  const configs = [WIDGETS_CFG, FINANCE_CFG];
  const backendMap: Record<string, Backend> = {
    widgets: widgetsBackend,
    'finance-svc': financeBackend,
  };
  const agg = new Aggregator(configs, {
    backendFactory: (cfg) => backendMap[cfg.id] ?? widgetsBackend,
    ledgerDlqPath: dlqPath(label),
    focusProfiles: FOCUS_PROFILES,
    embedEnabled: false,
  });
  return agg;
}

function parse(result: ToolCallResult): Record<string, unknown> {
  return JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as Record<string, unknown>;
}

// TT-1: explain:true, no query → explanation.method === 'server_summary'
test('TT-1: explain:true, no query → explanation.method === "server_summary"', async () => {
  const agg = makeAgg('t1');
  try {
    const r = parse(await agg.callTool('ch1tty/search', { explain: true }, 'tt-session'));
    assert.ok(r.explanation, 'explanation field should be present');
    assert.equal((r.explanation as Record<string, unknown>).method, 'server_summary');
  } finally { await agg.shutdown(); }
});

// TT-2: explanation.totalServers and totalTools correct
test('TT-2: explanation.totalServers and totalTools correct', async () => {
  const agg = makeAgg('t2');
  try {
    const r = parse(await agg.callTool('ch1tty/search', { explain: true }, 'tt-session'));
    const exp = r.explanation as Record<string, unknown>;
    assert.equal(exp.totalServers, 2, 'totalServers: 2 active configs');
    assert.equal(exp.totalTools, 3, 'totalTools: 3 across both backends');
  } finally { await agg.shutdown(); }
});

// TT-3: no focus → explanation.focus and inFocusServers absent
test('TT-3: no focus active → focus and inFocusServers absent from explanation', async () => {
  const agg = makeAgg('t3');
  try {
    const r = parse(await agg.callTool('ch1tty/search', { explain: true }, 'tt-session'));
    const exp = r.explanation as Record<string, unknown>;
    assert.equal(exp.focus, undefined, 'no focus field when no focus active');
    assert.equal(exp.inFocusServers, undefined, 'no inFocusServers when no focus');
  } finally { await agg.shutdown(); }
});

// TT-4: focus active → explanation.focus and inFocusServers present
test('TT-4: focus active → explanation.focus and inFocusServers present', async () => {
  const agg = makeAgg('t4');
  try {
    const r = parse(await agg.callTool('ch1tty/search', { explain: true, focus: 'finance' }, 'tt-session'));
    const exp = r.explanation as Record<string, unknown>;
    assert.equal(exp.focus, 'finance', 'focus in explanation');
    assert.ok(typeof exp.inFocusServers === 'number', 'inFocusServers is a number');
    assert.equal(exp.inFocusServers, 1, 'only finance-svc is in finance focus');
  } finally { await agg.shutdown(); }
});

// TT-5: inFocusOnly:true + focus → explanation.inFocusOnly:true
test('TT-5: inFocusOnly:true + focus → explanation.inFocusOnly:true', async () => {
  const agg = makeAgg('t5');
  try {
    const r = parse(await agg.callTool('ch1tty/search', { explain: true, focus: 'finance', inFocusOnly: true }, 'tt-session'));
    const exp = r.explanation as Record<string, unknown>;
    assert.equal(exp.inFocusOnly, true, 'inFocusOnly in explanation when active');
    assert.equal(exp.focus, 'finance', 'focus also present');
  } finally { await agg.shutdown(); }
});

// TT-6: explanation.rationale is a non-empty string mentioning "server summary"
test('TT-6: explanation.rationale mentions "server summary"', async () => {
  const agg = makeAgg('t6');
  try {
    const r = parse(await agg.callTool('ch1tty/search', { explain: true }, 'tt-session'));
    const exp = r.explanation as Record<string, unknown>;
    assert.ok(typeof exp.rationale === 'string', 'rationale is a string');
    assert.ok((exp.rationale as string).length > 0, 'rationale non-empty');
    assert.ok((exp.rationale as string).toLowerCase().includes('server summary'), 'rationale mentions server summary');
  } finally { await agg.shutdown(); }
});

// TT-7: explain:false → no explanation field in server-summary response
test('TT-7: explain:false → no explanation field in server-summary response', async () => {
  const agg = makeAgg('t7');
  try {
    const r = parse(await agg.callTool('ch1tty/search', { explain: false }, 'tt-session'));
    assert.equal(r.explanation, undefined, 'no explanation when explain:false');
    assert.ok(Array.isArray(r.servers), 'servers field still present');
  } finally { await agg.shutdown(); }
});
