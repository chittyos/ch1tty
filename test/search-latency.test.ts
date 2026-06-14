/**
 * Workstream RRRR: latencyMs in ch1tty/search responses.
 *
 * All ch1tty/search response shapes now include `latencyMs: number` —
 * wall-clock elapsed time in ms from the start of handleSearch to the
 * response JSON being serialised. Covers both the query/filter path and
 * the no-query server-summary path.
 *
 * Covered:
 *   1. Query path — latencyMs present and is a non-negative integer
 *   2. latencyMs is >= 0 (timer fires before any async work completes)
 *   3. No-query (server-summary) path — latencyMs present
 *   4. Server-filter path — latencyMs present
 *   5. Category-filter path — latencyMs present
 *   6. sessionId path — latencyMs present alongside sessionContext
 *   7. explain: true path — latencyMs present alongside explanation
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-lat-${label}-${Date.now()}.jsonl`);
}

const NEON_CFG: ServerConfig = { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.test/mcp' };
const STRIPE_CFG: ServerConfig = { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.test/mcp' };

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
  { name: 'list_projects', description: 'List Neon projects', inputSchema: { type: 'object', properties: {} } },
  { name: 'run_query', description: 'Run SQL on Neon', inputSchema: { type: 'object', properties: {} } },
];
const STRIPE_TOOLS: ToolEntry[] = [
  { name: 'list_customers', description: 'List Stripe customers', inputSchema: { type: 'object', properties: {} } },
];

const FOCUS_PROFILES = {
  profiles: {
    code: { description: 'Code tools', categories: ['code' as const], servers: ['neon'], boost: 0.5 },
  },
};

const CONFIGS = [NEON_CFG, STRIPE_CFG];

function makeAgg(label: string): Aggregator {
  const backends = new Map<string, Backend>([
    ['neon', makeBackend(NEON_TOOLS)],
    ['stripe', makeBackend(STRIPE_TOOLS)],
  ]);
  return new Aggregator(CONFIGS, {
    focusProfiles: FOCUS_PROFILES,
    backendFactory: (cfg) => backends.get(cfg.id) ?? makeBackend([]),
    embedEnabled: false,
    ledgerDlqPath: dlqPath(label),
  });
}

function parseText(result: { content: Array<{ type: string; text?: string }> }) {
  const item = result.content.find((c) => c.type === 'text');
  assert.ok(item?.text, 'Expected text content');
  return JSON.parse(item.text);
}

// ── 1. Query path — latencyMs present ────────────────────────────────────────

test('search query path includes latencyMs', async () => {
  const agg = makeAgg('1-query');
  try {
    const result = await agg.callTool('ch1tty/search', { query: 'list' });
    const parsed = parseText(result);
    assert.ok('latencyMs' in parsed, 'latencyMs must be present in query result');
    assert.equal(typeof parsed.latencyMs, 'number', 'latencyMs must be a number');
  } finally {
    await agg.shutdown();
  }
});

// ── 2. latencyMs is non-negative ──────────────────────────────────────────────

test('search latencyMs is >= 0', async () => {
  const agg = makeAgg('2-nonneg');
  try {
    const result = await agg.callTool('ch1tty/search', { query: 'neon' });
    const parsed = parseText(result);
    assert.ok(parsed.latencyMs >= 0, `latencyMs must be non-negative, got ${parsed.latencyMs}`);
  } finally {
    await agg.shutdown();
  }
});

// ── 3. No-query (server-summary) path — latencyMs present ─────────────────────

test('search server-summary (no query) path includes latencyMs', async () => {
  const agg = makeAgg('3-summary');
  try {
    const result = await agg.callTool('ch1tty/search', {});
    const parsed = parseText(result);
    assert.ok('latencyMs' in parsed, 'latencyMs must be present in server-summary response');
    assert.equal(typeof parsed.latencyMs, 'number');
    assert.ok(parsed.latencyMs >= 0);
  } finally {
    await agg.shutdown();
  }
});

// ── 4. Server-filter path — latencyMs present ────────────────────────────────

test('search server-filter path includes latencyMs', async () => {
  const agg = makeAgg('4-serverfilter');
  try {
    const result = await agg.callTool('ch1tty/search', { server: 'neon' });
    const parsed = parseText(result);
    assert.ok('latencyMs' in parsed, 'latencyMs must be present in server-filtered response');
    assert.equal(typeof parsed.latencyMs, 'number');
  } finally {
    await agg.shutdown();
  }
});

// ── 5. Category-filter path — latencyMs present ──────────────────────────────

test('search category-filter path includes latencyMs', async () => {
  const agg = makeAgg('5-catfilter');
  try {
    const result = await agg.callTool('ch1tty/search', { category: 'code' });
    const parsed = parseText(result);
    assert.ok('latencyMs' in parsed, 'latencyMs must be present in category-filtered response');
    assert.equal(typeof parsed.latencyMs, 'number');
  } finally {
    await agg.shutdown();
  }
});

// ── 6. sessionId path — latencyMs alongside sessionContext ────────────────────

test('search with sessionId includes both latencyMs and sessionContext', async () => {
  const agg = makeAgg('6-session');
  try {
    const result = await agg.callTool('ch1tty/search', { query: 'project', sessionId: 'rrrr-session-1' });
    const parsed = parseText(result);
    assert.ok('latencyMs' in parsed, 'latencyMs must be present with sessionId');
    assert.ok('sessionContext' in parsed, 'sessionContext must also be present');
    assert.equal(typeof parsed.latencyMs, 'number');
    assert.ok(parsed.latencyMs >= 0);
  } finally {
    await agg.shutdown();
  }
});

// ── 7. explain: true path — latencyMs alongside explanation ───────────────────

test('search with explain: true includes both latencyMs and explanation', async () => {
  const agg = makeAgg('7-explain');
  try {
    const result = await agg.callTool('ch1tty/search', { query: 'query', explain: true });
    const parsed = parseText(result);
    assert.ok('latencyMs' in parsed, 'latencyMs must be present with explain:true');
    assert.ok('explanation' in parsed, 'explanation must also be present');
    assert.equal(typeof parsed.latencyMs, 'number');
    assert.ok(parsed.latencyMs >= 0);
  } finally {
    await agg.shutdown();
  }
});
