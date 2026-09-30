/**
 * GCN: ch1tty/search tools[] entry `score` field conditional drift guard.
 *
 * The aggregator only populates `score` on each tools[] entry when a keyword
 * query is present (relevanceMap.size > 0, aggregator.ts:837). When filtering
 * by category or server alone — no query — relevanceMap stays empty and
 * `score` must be absent.
 *
 * Existing tests (search-filters.test.ts) define `score?: number` in their
 * result type but assert nothing about presence or absence. This guard freezes:
 *
 *   GCN-1  Query given → score is present on every returned tool entry
 *   GCN-2  Query given → score is a finite number in [0, 1.3] for every entry
 *   GCN-3  Category-only filter (no query) → score is absent on every entry
 *   GCN-4  Server-only filter (no query) → score is absent on every entry
 *   GCN-5  Query + category filter combined → score is present on every entry
 *
 * Frozen 2026-09-27.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NEON_TOOLS: ToolEntry[] = [
  { name: 'list_projects', description: 'List Neon database projects', inputSchema: { type: 'object', properties: {} } },
  { name: 'run_sql',       description: 'Execute a SQL query against Neon', inputSchema: { type: 'object', properties: { sql: { type: 'string' } } } },
];
const TASKS_TOOLS: ToolEntry[] = [
  { name: 'list_tasks',  description: 'List all tasks in the task tracker', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_task', description: 'Create a new task entry',            inputSchema: { type: 'object', properties: { title: { type: 'string' } } } },
];

const NEON_CFG: ServerConfig  = { id: 'neon',  name: 'Neon DB', type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.test/mcp' };
const TASKS_CFG: ServerConfig = { id: 'tasks', name: 'Tasks',   type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://tasks.test/mcp' };

function makeStaticBackend(toolMap: Record<string, ToolEntry[]>): Backend {
  return {
    registerServer: () => {},
    isRegistered: (id) => id in toolMap,
    getStatus: (id): BackendStatus => ({
      connected: id in toolMap,
      toolCount: toolMap[id]?.length ?? 0,
      toolCacheAge: 0,
    }),
    listTools: async (serverId) => toolMap[serverId] ?? [],
    callTool: async (): Promise<ToolCallResult> => ({ content: [{ type: 'text', text: 'ok' }] }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

function makeAgg(): Aggregator {
  const backend = makeStaticBackend({ neon: NEON_TOOLS, tasks: TASKS_TOOLS });
  return new Aggregator([NEON_CFG, TASKS_CFG], { backendFactory: () => backend, embedEnabled: false });
}

type SearchEntry = { tool: string; server: string; score?: number; [key: string]: unknown };

function parseTools(result: ToolCallResult): SearchEntry[] {
  const data = JSON.parse(result.content[0].text as string) as { tools: SearchEntry[] };
  return data.tools;
}

// ── GCN-1: Query given → score present on every entry ─────────────────────────

test('GCN-1: query given → every tools[] entry has a score key', async () => {
  const agg = makeAgg();
  try {
    const result = await agg.callTool('ch1tty/search', { query: 'list' });
    const tools = parseTools(result);
    assert.ok(tools.length > 0, 'expected at least one result for query "list"');
    for (const t of tools) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(t, 'score'),
        `tool ${t.tool} is missing score key when query is present`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GCN-2: Query given → score is a finite number in [0, 1.3] ─────────────────

test('GCN-2: query given → every score is a finite number in [0, 1.3]', async () => {
  const agg = makeAgg();
  try {
    const result = await agg.callTool('ch1tty/search', { query: 'sql database neon' });
    const tools = parseTools(result);
    assert.ok(tools.length > 0, 'expected results for query "sql database neon"');
    for (const t of tools) {
      const s = t.score;
      assert.equal(typeof s, 'number', `score on ${t.tool} must be a number`);
      assert.ok(Number.isFinite(s as number), `score on ${t.tool} must be finite`);
      assert.ok((s as number) >= 0, `score on ${t.tool} must be >= 0`);
      assert.ok((s as number) <= 1.3, `score on ${t.tool} must be <= 1.3`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GCN-3: Category-only filter, no query → score absent ──────────────────────

test('GCN-3: category-only filter (no query) → score absent on every entry', async () => {
  const agg = makeAgg();
  try {
    const result = await agg.callTool('ch1tty/search', { category: 'code' });
    const tools = parseTools(result);
    assert.ok(tools.length > 0, 'expected neon tools for category=code');
    for (const t of tools) {
      assert.ok(
        !Object.prototype.hasOwnProperty.call(t, 'score'),
        `tool ${t.tool} must NOT have score when no query is given`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GCN-4: Server-only filter, no query → score absent ────────────────────────

test('GCN-4: server-only filter (no query) → score absent on every entry', async () => {
  const agg = makeAgg();
  try {
    const result = await agg.callTool('ch1tty/search', { server: 'tasks' });
    const tools = parseTools(result);
    assert.ok(tools.length > 0, 'expected tasks tools for server=tasks');
    for (const t of tools) {
      assert.ok(
        !Object.prototype.hasOwnProperty.call(t, 'score'),
        `tool ${t.tool} must NOT have score when no query is given`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GCN-5: Query + category filter → score present ────────────────────────────

test('GCN-5: query + category filter combined → score present on every entry', async () => {
  const agg = makeAgg();
  try {
    const result = await agg.callTool('ch1tty/search', { query: 'task', category: 'ecosystem' });
    const tools = parseTools(result);
    assert.ok(tools.length > 0, 'expected results for query=task category=ecosystem');
    for (const t of tools) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(t, 'score'),
        `tool ${t.tool} is missing score key when query+category are both given`,
      );
      const s = t.score;
      assert.equal(typeof s, 'number', `score on ${t.tool} must be a number`);
      assert.ok(Number.isFinite(s as number), `score on ${t.tool} must be finite`);
    }
  } finally {
    await agg.shutdown();
  }
});
