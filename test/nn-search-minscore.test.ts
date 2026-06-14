/**
 * Workstream NN: ch1tty/search minScore filter.
 *
 * When minScore: number is passed to ch1tty/search, only tools with a
 * relevance score >= minScore are returned. Requires a query — when no
 * query is present, relevance scores are not computed and the param is
 * a no-op. total reflects the post-filter count (pre-pagination).
 *
 * Covered:
 *   1. minScore: 0.5 + partial-match query → high-score tool returned, low-score excluded
 *   2. minScore: 0 + same query → all matching tools returned (no-op)
 *   3. minScore omitted + same query → all matching tools returned (no-op)
 *   4. minScore without query → no-op (scores not computed; server summary returned unchanged)
 *   5. total reflects post-minScore filtered count
 *   6. minScore field appears in response JSON only when > 0
 *   7. minScore: 1.1 (above any achievable score) → 0 results for AND-match query
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-nn-${label}-${Date.now()}.jsonl`);
}

// neon: two tools with different relevance profiles.
// For the 3-term query "sql list execute":
//   run_sql   — haystack has "sql" + "execute" → 2/3 → score 0.67 (partial fallback)
//   list_tables — haystack has "list" only     → 1/3 → score 0.33 (partial fallback)
// Neither tool matches ALL 3 terms, so partial (OR) fallback fires.
const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite', category: 'code',
  endpoint: 'https://neon.test/mcp',
};
const NEON_TOOLS: ToolEntry[] = [
  { name: 'run_sql',     description: 'Execute raw SQL on the database', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_tables', description: 'List all database tables',        inputSchema: { type: 'object', properties: {} } },
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

function makeAgg(label: string): Aggregator {
  return new Aggregator([NEON_CFG], {
    backendFactory: () => makeBackend(NEON_TOOLS),
    embedEnabled: false,
    ledgerDlqPath: dlqPath(label),
  });
}

function parseBody(r: ToolCallResult): Record<string, unknown> {
  assert.equal(r.isError, undefined);
  return JSON.parse((r.content[0] as { text: string }).text) as Record<string, unknown>;
}

// ── 1. minScore: 0.5 filters low-relevance tools ─────────────────────────────
// Query "sql list execute" → partial fallback; run_sql scores 0.67, list_tables 0.33.
// With minScore: 0.5, only run_sql passes.
test('NN-1: minScore: 0.5 returns only high-score tools from partial-match query', async () => {
  const agg = makeAgg('1');
  try {
    const r = await agg.callTool('ch1tty/search', { query: 'sql list execute', minScore: 0.5 });
    const body = parseBody(r);
    const tools = body.tools as Array<{ tool: string; score: number }>;
    assert.equal(tools.length, 1, 'only 1 tool should pass the minScore threshold');
    assert.equal(tools[0].tool, 'neon/run_sql');
    assert.ok((tools[0].score ?? 0) >= 0.5, `expected score >= 0.5, got ${tools[0].score}`);
  } finally { await agg.shutdown(); }
});

// ── 2. minScore: 0 → no-op ───────────────────────────────────────────────────
test('NN-2: minScore: 0 is a no-op — all partial-match tools returned', async () => {
  const agg = makeAgg('2');
  try {
    const r = await agg.callTool('ch1tty/search', { query: 'sql list execute', minScore: 0 });
    const body = parseBody(r);
    const tools = body.tools as Array<{ tool: string }>;
    assert.equal(tools.length, 2, 'both tools should be returned when minScore is 0');
  } finally { await agg.shutdown(); }
});

// ── 3. minScore omitted → no-op ──────────────────────────────────────────────
test('NN-3: minScore omitted — all partial-match tools returned', async () => {
  const agg = makeAgg('3');
  try {
    const r = await agg.callTool('ch1tty/search', { query: 'sql list execute' });
    const body = parseBody(r);
    const tools = body.tools as Array<{ tool: string }>;
    assert.equal(tools.length, 2, 'both tools should be returned when minScore is omitted');
  } finally { await agg.shutdown(); }
});

// ── 4. minScore without query → no-op ────────────────────────────────────────
// No query → server-summary path is returned. Relevance scores are never computed
// so minScore has nothing to apply against — the summary is returned unaffected.
test('NN-4: minScore without query is a no-op — server summary returned', async () => {
  const agg = makeAgg('4');
  try {
    const r = await agg.callTool('ch1tty/search', { minScore: 0.9 });
    const body = parseBody(r);
    assert.ok(Array.isArray(body.servers), 'expected server summary when no query is provided');
    assert.equal((body.servers as unknown[]).length, 1, 'neon server should appear in summary');
  } finally { await agg.shutdown(); }
});

// ── 5. total reflects post-minScore count ────────────────────────────────────
test('NN-5: total reflects post-minScore filtered count', async () => {
  const agg = makeAgg('5');
  try {
    const rFiltered = await agg.callTool('ch1tty/search', { query: 'sql list execute', minScore: 0.5 });
    const bodyFiltered = parseBody(rFiltered);
    assert.equal(bodyFiltered.total, 1, 'total should be 1 after minScore filter');

    const rAll = await agg.callTool('ch1tty/search', { query: 'sql list execute' });
    const bodyAll = parseBody(rAll);
    assert.equal(bodyAll.total, 2, 'total should be 2 without minScore filter');
  } finally { await agg.shutdown(); }
});

// ── 6. minScore field in response only when > 0 ──────────────────────────────
test('NN-6: minScore field appears in response only when set > 0', async () => {
  const agg = makeAgg('6');
  try {
    const rWith = await agg.callTool('ch1tty/search', { query: 'sql list execute', minScore: 0.5 });
    assert.equal(parseBody(rWith).minScore, 0.5, 'minScore should appear in response when set');

    const rWithout = await agg.callTool('ch1tty/search', { query: 'sql list execute' });
    assert.equal(parseBody(rWithout).minScore, undefined, 'minScore absent when omitted');

    const rZero = await agg.callTool('ch1tty/search', { query: 'sql list execute', minScore: 0 });
    assert.equal(parseBody(rZero).minScore, undefined, 'minScore absent when 0');
  } finally { await agg.shutdown(); }
});

// ── 7. minScore above max achievable score → 0 results ───────────────────────
// Query "sql execute" (2-term AND match) → run_sql scores 1.0 exactly.
// minScore: 1.1 exceeds 1.0 — all tools excluded.
test('NN-7: minScore above max achievable score → 0 results', async () => {
  const agg = makeAgg('7');
  try {
    const r = await agg.callTool('ch1tty/search', { query: 'sql execute', minScore: 1.1 });
    const body = parseBody(r);
    const tools = body.tools as Array<{ tool: string }>;
    assert.equal(tools.length, 0, 'all tools should be excluded by strict minScore');
    assert.equal(body.total, 0);
    assert.equal(body.minScore, 1.1, 'minScore echoed in response');
  } finally { await agg.shutdown(); }
});
