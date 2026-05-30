/**
 * Tests for the Aggregator's accessFilter and categoryFilter options.
 *
 * CH1TTY_ACCESS and CH1TTY_CATEGORY env vars (wired in src/index.ts) drive
 * these options, letting operators narrow the active backend set at process
 * startup. Both filters are applied in activeConfigs() — they're invisible to
 * MCP clients but affect which servers appear in status and search results.
 */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

const FILTER_DLQ = join(tmpdir(), `ch1tty-filter-test-${process.pid}.dlq.jsonl`);
after(() => { rmSync(FILTER_DLQ, { force: true }); });

// Four servers with distinct access × category combinations so each filter
// case can be tested in isolation.
const CONFIGS: ServerConfig[] = [
  { id: 'code-server',    name: 'Code RW',    type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://f.code' },
  { id: 'search-server',  name: 'Search R',   type: 'remote', access: 'read',      category: 'search',    endpoint: 'https://f.search' },
  { id: 'desktop-server', name: 'Desktop RW', type: 'remote', access: 'readwrite', category: 'desktop',   endpoint: 'https://f.desktop' },
  { id: 'docs-server',    name: 'Docs W',     type: 'remote', access: 'write',     category: 'documents', endpoint: 'https://f.docs' },
];

function buildFixture(): FixtureBackend {
  const fb = new FixtureBackend();
  const tool = (name: string, desc: string) => ({
    name,
    description: desc,
    inputSchema: {},
    response: { content: [{ type: 'text' as const, text: 'ok' }] },
  });
  fb.defineServer('code-server',    { tools: [tool('run_query',       'Execute a database query')] });
  fb.defineServer('search-server',  { tools: [tool('web_search',      'Search the web for information')] });
  fb.defineServer('desktop-server', { tools: [tool('take_screenshot', 'Take a screenshot of the page')] });
  fb.defineServer('docs-server',    { tools: [tool('create_doc',      'Create a new document')] });
  return fb;
}

function buildAgg(opts?: { accessFilter?: ServerConfig['access']; categoryFilter?: ServerConfig['category'] }): Aggregator {
  const fb = buildFixture();
  return new Aggregator(CONFIGS, {
    ledgerDlqPath: FILTER_DLQ,
    accessFilter: opts?.accessFilter,
    categoryFilter: opts?.categoryFilter,
    backendFactory: () => fb,
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
  });
}

type StatusShape = {
  totalServers: number;
  servers: Array<{ id: string }>;
};

type SearchSummaryShape = {
  servers: Array<{ server: string; category: string }>;
  totalTools: number;
};

type SearchResultShape = {
  matches: number;
  total: number;
  tools: Array<{ tool: string; server: string }>;
};

async function getStatus(agg: Aggregator): Promise<StatusShape> {
  const r = await agg.callTool('ch1tty/status');
  return JSON.parse((r.content[0] as { text: string }).text) as StatusShape;
}

async function getServerSummary(agg: Aggregator): Promise<SearchSummaryShape> {
  // No args → ch1tty/search returns a server summary (not individual tools).
  const r = await agg.callTool('ch1tty/search', {});
  return JSON.parse((r.content[0] as { text: string }).text) as SearchSummaryShape;
}

async function searchTools(agg: Aggregator, query: string): Promise<SearchResultShape> {
  const r = await agg.callTool('ch1tty/search', { query });
  return JSON.parse((r.content[0] as { text: string }).text) as SearchResultShape;
}

// ── No filter ────────────────────────────────────────────────────────────────

test('no filter: all four servers active in status', async () => {
  const agg = buildAgg();
  try {
    const status = await getStatus(agg);
    assert.equal(status.totalServers, 4);
    const ids = status.servers.map((s) => s.id).sort();
    assert.deepEqual(ids, ['code-server', 'desktop-server', 'docs-server', 'search-server']);
  } finally {
    await agg.shutdown();
  }
});

test('no filter: server summary lists all four servers', async () => {
  const agg = buildAgg();
  try {
    const summary = await getServerSummary(agg);
    assert.equal(summary.servers.length, 4);
    assert.equal(summary.totalTools, 4);
  } finally {
    await agg.shutdown();
  }
});

// ── accessFilter ─────────────────────────────────────────────────────────────

test('accessFilter=read: only search-server active', async () => {
  const agg = buildAgg({ accessFilter: 'read' });
  try {
    const status = await getStatus(agg);
    assert.equal(status.totalServers, 1, 'only search-server has access=read');
    assert.equal(status.servers[0].id, 'search-server');
  } finally {
    await agg.shutdown();
  }
});

test('accessFilter=write: only docs-server active', async () => {
  const agg = buildAgg({ accessFilter: 'write' });
  try {
    const status = await getStatus(agg);
    assert.equal(status.totalServers, 1, 'only docs-server has access=write');
    assert.equal(status.servers[0].id, 'docs-server');
  } finally {
    await agg.shutdown();
  }
});

test('accessFilter=readwrite: code-server and desktop-server active', async () => {
  const agg = buildAgg({ accessFilter: 'readwrite' });
  try {
    const status = await getStatus(agg);
    assert.equal(status.totalServers, 2, 'code-server and desktop-server have access=readwrite');
    const ids = status.servers.map((s) => s.id).sort();
    assert.deepEqual(ids, ['code-server', 'desktop-server']);
  } finally {
    await agg.shutdown();
  }
});

// ── categoryFilter ───────────────────────────────────────────────────────────

test('categoryFilter=code: only code-server active', async () => {
  const agg = buildAgg({ categoryFilter: 'code' });
  try {
    const status = await getStatus(agg);
    assert.equal(status.totalServers, 1, 'only code-server has category=code');
    assert.equal(status.servers[0].id, 'code-server');
  } finally {
    await agg.shutdown();
  }
});

test('categoryFilter=search: only search-server active', async () => {
  const agg = buildAgg({ categoryFilter: 'search' });
  try {
    const status = await getStatus(agg);
    assert.equal(status.totalServers, 1, 'only search-server has category=search');
    assert.equal(status.servers[0].id, 'search-server');
  } finally {
    await agg.shutdown();
  }
});

test('categoryFilter=desktop: only desktop-server active', async () => {
  const agg = buildAgg({ categoryFilter: 'desktop' });
  try {
    const status = await getStatus(agg);
    assert.equal(status.totalServers, 1, 'only desktop-server has category=desktop');
    assert.equal(status.servers[0].id, 'desktop-server');
  } finally {
    await agg.shutdown();
  }
});

test('categoryFilter=documents: only docs-server active', async () => {
  const agg = buildAgg({ categoryFilter: 'documents' });
  try {
    const status = await getStatus(agg);
    assert.equal(status.totalServers, 1, 'only docs-server has category=documents');
    assert.equal(status.servers[0].id, 'docs-server');
  } finally {
    await agg.shutdown();
  }
});

// ── Combined filter (intersection) ───────────────────────────────────────────

test('accessFilter=readwrite + categoryFilter=code: only code-server (intersection)', async () => {
  const agg = buildAgg({ accessFilter: 'readwrite', categoryFilter: 'code' });
  try {
    const status = await getStatus(agg);
    assert.equal(status.totalServers, 1, 'intersection: readwrite AND code = only code-server');
    assert.equal(status.servers[0].id, 'code-server');
  } finally {
    await agg.shutdown();
  }
});

test('accessFilter=read + categoryFilter=code: empty (no read+code server)', async () => {
  // search-server is read but category=search; code-server is code but access=readwrite.
  // No server satisfies read AND code.
  const agg = buildAgg({ accessFilter: 'read', categoryFilter: 'code' });
  try {
    const status = await getStatus(agg);
    assert.equal(status.totalServers, 0, 'no server satisfies read AND code simultaneously');
  } finally {
    await agg.shutdown();
  }
});

// ── Search respects active backend set ───────────────────────────────────────

test('search tools respects accessFilter: only read-server tools returned', async () => {
  const agg = buildAgg({ accessFilter: 'read' });
  try {
    // search-server has 'web_search'; other servers are filtered out
    const result = await searchTools(agg, 'search web');
    assert.ok(result.tools.length > 0, 'at least one tool returned');
    const serverIds = result.tools.map((t) => t.server);
    assert.ok(
      serverIds.every((id) => id === 'search-server'),
      `all tools must come from search-server, got: ${serverIds.join(', ')}`,
    );
    const toolNames = result.tools.map((t) => t.tool);
    assert.ok(!toolNames.includes('code-server/run_query'), 'filtered-out code-server tools must not appear');
  } finally {
    await agg.shutdown();
  }
});

test('search server summary respects accessFilter: only active servers listed', async () => {
  const agg = buildAgg({ accessFilter: 'readwrite' });
  try {
    const summary = await getServerSummary(agg);
    const serverIds = summary.servers.map((s) => s.server).sort();
    assert.deepEqual(serverIds, ['code-server', 'desktop-server'],
      'summary must list only readwrite servers');
    assert.ok(
      !summary.servers.some((s) => s.server === 'search-server'),
      'search-server (read) must not appear in readwrite-filtered summary',
    );
    assert.ok(
      !summary.servers.some((s) => s.server === 'docs-server'),
      'docs-server (write) must not appear in readwrite-filtered summary',
    );
  } finally {
    await agg.shutdown();
  }
});

test('search tools respects categoryFilter: only desktop tools returned', async () => {
  const agg = buildAgg({ categoryFilter: 'desktop' });
  try {
    const result = await searchTools(agg, 'screenshot');
    assert.ok(result.tools.length > 0, 'at least one tool returned');
    const serverIds = result.tools.map((t) => t.server);
    assert.ok(
      serverIds.every((id) => id === 'desktop-server'),
      `all results must be from desktop-server, got: ${serverIds.join(', ')}`,
    );
  } finally {
    await agg.shutdown();
  }
});
