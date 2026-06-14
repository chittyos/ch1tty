/**
 * VV — ch1tty/search explain: filterContext in server/category-filter path
 *
 * When explain:true is set alongside server or category filter params, the
 * explanation now includes a filterContext field describing the active filter,
 * and the rationale mentions the pre-filtering. This completes explain coverage
 * for all three search paths: AND/partial-keyword (Q/SS), no-query server-summary
 * (TT), and server/category-filter (VV).
 *
 * Covered:
 *   1. server filter + explain:true → explanation.filterContext.server matches
 *   2. category filter + explain:true → explanation.filterContext.category matches
 *   3. Both server + category + explain:true → both in filterContext
 *   4. Filter active → rationale mentions "pre-filtered by"
 *   5. No filter → filterContext absent from explanation
 *   6. server filter + query → explanation has both filterContext and matchMode
 *   7. explain:false with filter → no explanation field
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-vv-${label}-${Date.now()}.jsonl`);
}

const WIDGETS_CFG: ServerConfig = {
  id: 'widgets', name: 'Widgets', type: 'remote', access: 'readwrite', category: 'ecosystem',
  endpoint: 'https://widgets.test/mcp',
};
const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite', category: 'ecosystem',
  endpoint: 'https://neon.test/mcp',
};
const FS_CFG: ServerConfig = {
  id: 'fs', name: 'Filesystem', type: 'remote', access: 'readwrite', category: 'desktop',
  endpoint: 'https://fs.test/mcp',
};

const WIDGETS_TOOLS: ToolEntry[] = [
  { name: 'list_widgets', description: 'List all widgets in the system', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_widget', description: 'Create a new widget', inputSchema: { type: 'object', properties: {} } },
];
const NEON_TOOLS: ToolEntry[] = [
  { name: 'run_sql', description: 'Execute SQL on Neon database', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_projects', description: 'List Neon projects', inputSchema: { type: 'object', properties: {} } },
];
const FS_TOOLS: ToolEntry[] = [
  { name: 'read_file', description: 'Read a file from the filesystem', inputSchema: { type: 'object', properties: {} } },
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
  const backendMap: Record<string, Backend> = {
    widgets: makeBackend(WIDGETS_TOOLS),
    neon: makeBackend(NEON_TOOLS),
    fs: makeBackend(FS_TOOLS),
  };
  const agg = new Aggregator([WIDGETS_CFG, NEON_CFG, FS_CFG], {
    backendFactory: (cfg) => backendMap[cfg.id] ?? makeBackend([]),
    ledgerDlqPath: dlqPath(label),
    embedEnabled: false,
  });
  return agg;
}

function parse(result: ToolCallResult): Record<string, unknown> {
  return JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as Record<string, unknown>;
}

// VV-1: server filter + explain:true → explanation.filterContext.server matches
test('VV-1: server filter + explain:true → explanation.filterContext.server', async () => {
  const agg = makeAgg('v1');
  try {
    const r = parse(await agg.callTool('ch1tty/search', { query: 'sql', server: 'neon', explain: true }, 'vv-session'));
    assert.ok(r.explanation, 'explanation should be present');
    const exp = r.explanation as Record<string, unknown>;
    assert.ok(exp.filterContext, 'filterContext should be present');
    const fc = exp.filterContext as Record<string, unknown>;
    assert.equal(fc.server, 'neon', 'filterContext.server should match the filter param');
  } finally { await agg.shutdown(); }
});

// VV-2: category filter + explain:true → explanation.filterContext.category matches
test('VV-2: category filter + explain:true → explanation.filterContext.category', async () => {
  const agg = makeAgg('v2');
  try {
    const r = parse(await agg.callTool('ch1tty/search', { query: 'file', category: 'desktop', explain: true }, 'vv-session'));
    assert.ok(r.explanation, 'explanation should be present');
    const exp = r.explanation as Record<string, unknown>;
    assert.ok(exp.filterContext, 'filterContext should be present');
    const fc = exp.filterContext as Record<string, unknown>;
    assert.equal(fc.category, 'desktop', 'filterContext.category should match the filter param');
    assert.equal(fc.server, undefined, 'server absent when only category is filtered');
  } finally { await agg.shutdown(); }
});

// VV-3: both server + category + explain:true → both in filterContext
test('VV-3: server + category filters → both present in filterContext', async () => {
  const agg = makeAgg('v3');
  try {
    const r = parse(await agg.callTool('ch1tty/search', { query: 'list', server: 'widgets', category: 'ecosystem', explain: true }, 'vv-session'));
    const exp = r.explanation as Record<string, unknown>;
    assert.ok(exp.filterContext, 'filterContext present');
    const fc = exp.filterContext as Record<string, unknown>;
    assert.equal(fc.server, 'widgets', 'filterContext.server present');
    assert.equal(fc.category, 'ecosystem', 'filterContext.category present');
  } finally { await agg.shutdown(); }
});

// VV-4: filter active → rationale mentions "pre-filtered by"
test('VV-4: server filter → rationale mentions "pre-filtered by"', async () => {
  const agg = makeAgg('v4');
  try {
    const r = parse(await agg.callTool('ch1tty/search', { query: 'sql', server: 'neon', explain: true }, 'vv-session'));
    const exp = r.explanation as Record<string, unknown>;
    assert.ok(typeof exp.rationale === 'string', 'rationale is a string');
    assert.ok((exp.rationale as string).includes('pre-filtered by'), 'rationale mentions pre-filtered by');
    assert.ok((exp.rationale as string).includes('server="neon"'), 'rationale names the server filter');
  } finally { await agg.shutdown(); }
});

// VV-5: no filter → filterContext absent from explanation
test('VV-5: no server/category filter → filterContext absent', async () => {
  const agg = makeAgg('v5');
  try {
    const r = parse(await agg.callTool('ch1tty/search', { query: 'sql', explain: true }, 'vv-session'));
    const exp = r.explanation as Record<string, unknown>;
    assert.equal(exp.filterContext, undefined, 'filterContext absent when no filter params set');
  } finally { await agg.shutdown(); }
});

// VV-6: server filter + query → explanation has both filterContext and matchMode
test('VV-6: server filter + query → explanation has filterContext and matchMode', async () => {
  const agg = makeAgg('v6');
  try {
    const r = parse(await agg.callTool('ch1tty/search', { query: 'list projects', server: 'neon', explain: true }, 'vv-session'));
    const exp = r.explanation as Record<string, unknown>;
    assert.ok(exp.filterContext, 'filterContext present');
    assert.ok(typeof exp.matchMode === 'string', 'matchMode present (and or partial)');
    assert.equal((exp.filterContext as Record<string, unknown>).server, 'neon');
  } finally { await agg.shutdown(); }
});

// VV-7: explain:false with filter → no explanation field
test('VV-7: explain:false with server filter → no explanation field', async () => {
  const agg = makeAgg('v7');
  try {
    const r = parse(await agg.callTool('ch1tty/search', { query: 'sql', server: 'neon', explain: false }, 'vv-session'));
    assert.equal(r.explanation, undefined, 'no explanation when explain:false even with filter');
    assert.ok(Array.isArray(r.tools), 'tools field still present');
  } finally { await agg.shutdown(); }
});
