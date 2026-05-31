/**
 * EE: ch1tty/search per-call filter params — server, category, limit.
 *
 * These are the *call-time* args on ch1tty/search (aggregator.ts:369–401),
 * distinct from the constructor-level accessFilter/categoryFilter options
 * tested in access-category-filter.test.ts.
 *
 * Covered here:
 *   1. category arg filters by ServerConfig.category (not tool-level category)
 *   2. server arg filters by serverId
 *   3. Combined server + category (both must match; mismatch → empty)
 *   4. Combined query + category (intersection)
 *   5. Combined query + server (intersection)
 *   6. limit arg clips result set
 *   7. limit larger than results returns everything
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
const PLAYWRIGHT_TOOLS: ToolEntry[] = [
  { name: 'screenshot', description: 'Capture a screenshot of the browser page', inputSchema: { type: 'object', properties: {} } },
  { name: 'navigate',   description: 'Navigate the browser to a URL',             inputSchema: { type: 'object', properties: { url: { type: 'string' } } } },
  { name: 'click',      description: 'Click a page element',                      inputSchema: { type: 'object', properties: { selector: { type: 'string' } } } },
];

const NEON_CFG: ServerConfig       = { id: 'neon',       name: 'Neon DB',    type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.test/mcp' };
const TASKS_CFG: ServerConfig      = { id: 'tasks',      name: 'Tasks',      type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://tasks.test/mcp' };
const PLAYWRIGHT_CFG: ServerConfig = { id: 'playwright', name: 'Playwright', type: 'remote', access: 'readwrite', category: 'desktop',   endpoint: 'https://pw.test/mcp' };

function makeStaticBackend(
  toolMap: Record<string, ToolEntry[]>,
): Backend {
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
  const backend = makeStaticBackend({
    neon:       NEON_TOOLS,
    tasks:      TASKS_TOOLS,
    playwright: PLAYWRIGHT_TOOLS,
  });
  return new Aggregator([NEON_CFG, TASKS_CFG, PLAYWRIGHT_CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
  });
}

type SearchResult = { tool: string; server: string; category: string; score?: number };
type SearchData   = { matches: number; total: number; tools: SearchResult[]; mode?: string };

function parseSearch(result: ToolCallResult): SearchData {
  return JSON.parse(result.content[0].text as string) as SearchData;
}

// ── 1. category='code' returns only neon tools ────────────────────────────────

test('search category=code: returns only code-category (neon) tools', async () => {
  const agg = makeAgg();
  try {
    const r = await agg.callTool('ch1tty/search', { category: 'code', query: 'list' });
    const d = parseSearch(r);

    assert.ok(d.tools.length > 0, 'should have results');
    assert.ok(
      d.tools.every((t) => t.server === 'neon'),
      `all tools must be from neon; got: ${d.tools.map((t) => t.server).join(', ')}`,
    );
    assert.ok(
      d.tools.every((t) => t.category === 'code'),
      'all tools must have category=code',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── 2. category='ecosystem' returns only tasks tools ──────────────────────────

test('search category=ecosystem: returns only ecosystem-category (tasks) tools', async () => {
  const agg = makeAgg();
  try {
    const r = await agg.callTool('ch1tty/search', { category: 'ecosystem', query: 'task' });
    const d = parseSearch(r);

    assert.ok(d.tools.length > 0, 'should have results');
    assert.ok(
      d.tools.every((t) => t.server === 'tasks'),
      `all tools must be from tasks; got: ${d.tools.map((t) => t.server).join(', ')}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── 3. category='desktop' returns only playwright tools ───────────────────────

test('search category=desktop (no query): returns all playwright tools', async () => {
  const agg = makeAgg();
  try {
    // category filter without query: goes through tool-list path (not server summary)
    const r = await agg.callTool('ch1tty/search', { category: 'desktop' });
    const d = parseSearch(r);

    assert.ok(d.tools, 'response must include tools array');
    assert.ok(d.tools.length > 0, 'playwright has 3 tools, must have results');
    assert.ok(
      d.tools.every((t) => t.server === 'playwright'),
      `all tools must be playwright; got: ${d.tools.map((t) => t.server).join(', ')}`,
    );
    assert.equal(d.tools.length, PLAYWRIGHT_TOOLS.length, 'must list all playwright tools');
  } finally {
    await agg.shutdown();
  }
});

// ── 4. category=nonexistent returns no tools ──────────────────────────────────

test('search category=nonexistent: returns empty tools array', async () => {
  const agg = makeAgg();
  try {
    const r = await agg.callTool('ch1tty/search', { category: 'finance', query: 'budget' });
    const d = parseSearch(r);

    assert.equal(d.tools.length, 0, 'unknown category returns no tools');
    assert.equal(d.matches, 0);
  } finally {
    await agg.shutdown();
  }
});

// ── 5. server='neon' (no query) returns all neon tools ────────────────────────

test('search server=neon (no query): returns all neon tools, none from tasks/playwright', async () => {
  const agg = makeAgg();
  try {
    const r = await agg.callTool('ch1tty/search', { server: 'neon' });
    const d = parseSearch(r);

    assert.ok(d.tools.length > 0, 'must have neon tools');
    assert.equal(d.tools.length, NEON_TOOLS.length, 'should return all neon tools');
    assert.ok(
      d.tools.every((t) => t.server === 'neon'),
      `all results must be from neon; got: ${d.tools.map((t) => t.server).join(', ')}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── 6. server=nonexistent returns no tools ────────────────────────────────────

test('search server=nonexistent: returns empty tools array', async () => {
  const agg = makeAgg();
  try {
    const r = await agg.callTool('ch1tty/search', { server: 'github', query: 'pull request' });
    const d = parseSearch(r);

    assert.equal(d.tools.length, 0, 'unknown server returns no tools');
  } finally {
    await agg.shutdown();
  }
});

// ── 7. server + query: intersection narrows results ───────────────────────────

test('search server=neon + query="sql": returns only run_sql from neon', async () => {
  const agg = makeAgg();
  try {
    const r = await agg.callTool('ch1tty/search', { server: 'neon', query: 'sql' });
    const d = parseSearch(r);

    assert.ok(d.tools.length > 0, 'should match run_sql');
    assert.ok(
      d.tools.every((t) => t.server === 'neon'),
      'server filter must exclude non-neon tools',
    );
    assert.ok(
      d.tools.some((t) => t.tool === 'neon/run_sql'),
      'run_sql must appear in results',
    );
    // Tasks tools must not appear even though "sql" might not match them anyway
    assert.ok(
      !d.tools.some((t) => t.server === 'tasks'),
      'tasks tools must be excluded by server filter',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── 8. category + query: intersection ─────────────────────────────────────────

test('search category=code + query="list": returns only list-matching code tools', async () => {
  const agg = makeAgg();
  try {
    const r = await agg.callTool('ch1tty/search', { category: 'code', query: 'list' });
    const d = parseSearch(r);

    assert.ok(d.tools.length > 0, 'should have results');
    assert.ok(
      d.tools.every((t) => t.category === 'code'),
      'category filter must exclude ecosystem/desktop tools',
    );
    // tasks/list_tasks must NOT appear (ecosystem, not code)
    assert.ok(
      !d.tools.some((t) => t.server === 'tasks'),
      'tasks tools must be excluded by category=code filter',
    );
    // neon/list_projects must appear
    assert.ok(
      d.tools.some((t) => t.tool === 'neon/list_projects'),
      'neon/list_projects must be in results',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── 9. server + category mismatch → no tools ─────────────────────────────────

test('search server=neon + category=ecosystem: mismatch returns empty results', async () => {
  const agg = makeAgg();
  try {
    // neon is category 'code', not 'ecosystem' → intersection is empty
    const r = await agg.callTool('ch1tty/search', { server: 'neon', category: 'ecosystem' });
    const d = parseSearch(r);

    assert.equal(d.tools.length, 0, 'server/category mismatch must return no tools');
  } finally {
    await agg.shutdown();
  }
});

// ── 10. limit clips result set ────────────────────────────────────────────────

test('search limit=1: returns exactly 1 result when multiple tools match', async () => {
  const agg = makeAgg();
  try {
    // playwright has 3 tools; "browser" appears in screenshot/navigate/click descriptions
    // With category=desktop + limit=1, should get exactly 1 tool back
    const r = await agg.callTool('ch1tty/search', { category: 'desktop', limit: 1 });
    const d = parseSearch(r);

    assert.equal(d.tools.length, 1, 'limit=1 must return exactly 1 result');
    assert.equal(d.total, PLAYWRIGHT_TOOLS.length, 'total must reflect all matches before limit');
    assert.equal(d.matches, 1, 'matches reflects sliced count');
  } finally {
    await agg.shutdown();
  }
});

// ── 11. limit larger than result set returns everything ───────────────────────

test('search limit=100: returns all matching tools when fewer than limit match', async () => {
  const agg = makeAgg();
  try {
    const r = await agg.callTool('ch1tty/search', { category: 'desktop', limit: 100 });
    const d = parseSearch(r);

    assert.equal(d.tools.length, PLAYWRIGHT_TOOLS.length,
      'all playwright tools returned when limit > result count');
  } finally {
    await agg.shutdown();
  }
});

// ── 12. limit=2 with query narrows correctly ──────────────────────────────────

test('search limit=2 with query: at most 2 results returned', async () => {
  const agg = makeAgg();
  try {
    // "neon" keyword matches all 5 neon tools; limit=2 clips to 2
    const r = await agg.callTool('ch1tty/search', { query: 'neon', limit: 2 });
    const d = parseSearch(r);

    assert.ok(d.tools.length <= 2, `limit=2 must cap at 2; got ${d.tools.length}`);
    assert.ok(d.total >= d.tools.length, 'total must be >= sliced count');
  } finally {
    await agg.shutdown();
  }
});
