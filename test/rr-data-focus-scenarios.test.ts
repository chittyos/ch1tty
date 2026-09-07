/**
 * Workstream R — data focus profile scenarios.
 *
 * Validates the data focus profile with neon and storage as wired backends:
 *  - neon/ and storage/ tools are boosted in search ranking (lens, not gate)
 *  - cast resolves data/storage intents to neon/ and storage/ tools
 *  - out-of-focus tools remain reachable when data focus is active
 *  - neon/run_sql and storage/list_objects execute correctly via fixture backend
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

const DATA_FOCUS_PROFILES = {
  profiles: {
    data: {
      description: 'Database, storage, and filesystem tooling — Neon SQL queries, schema inspection, R2 object storage, and local filesystem operations',
      categories: ['ecosystem' as const],
      servers: ['neon', 'storage', 'fs'],
      boost: 0.6,
    },
    code: {
      description: 'Software development',
      categories: ['code' as const],
      servers: ['github', 'cloudflare'],
      boost: 0.5,
    },
  },
};

const FIXTURE_CONFIGS: ServerConfig[] = [
  { id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://fixture.neon' },
  { id: 'storage', name: 'Storage', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://fixture.storage' },
  { id: 'fs', name: 'Filesystem', type: 'local', access: 'readwrite', category: 'desktop', command: 'node', args: ['./fixture-fs'] },
  { id: 'github', name: 'GitHub', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.github' },
  { id: 'cloudflare', name: 'Cloudflare', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.cloudflare' },
];

type SearchResult = { tools?: Array<{ tool: string; score?: number; inFocus?: boolean }>; focus?: string };
type CastResult = Record<string, unknown>;

function parseSearch(result: { content: Array<{ type: string; text?: string }> }): SearchResult {
  return JSON.parse(result.content[0]?.text ?? '{}') as SearchResult;
}

function parseCast(result: { content: Array<{ type: string; text?: string }> }): CastResult {
  return JSON.parse(result.content[0]?.text ?? '{}') as CastResult;
}

function buildAggregator(focus?: string): { aggregator: Aggregator; fixture: FixtureBackend } {
  const fixture = new FixtureBackend();
  for (const [id, def] of Object.entries(FIXTURE_SERVERS)) {
    fixture.defineServer(id, def);
  }
  const aggregator = new Aggregator(FIXTURE_CONFIGS, {
    focusProfiles: DATA_FOCUS_PROFILES,
    focus,
    embedEnabled: false,
    backendFactory: (config) => {
      fixture.registerServer(config);
      return fixture;
    },
  });
  return { aggregator, fixture };
}

test('data focus: search "sql database query" ranks neon/ tools first', async () => {
  const { aggregator } = buildAggregator('data');

  const result = await aggregator.callTool('ch1tty/search', { query: 'sql database query', limit: 10 });
  assert.equal(result.isError, undefined, 'search should not error');

  const parsed = parseSearch(result);
  const tools = parsed.tools ?? [];
  assert.ok(tools.length > 0, 'should return results');

  const neonIdx = tools.findIndex((r) => r.tool.startsWith('neon/'));
  const outIdx = tools.findIndex((r) => !['neon/', 'storage/'].some((p) => r.tool.startsWith(p)));

  assert.ok(neonIdx !== -1, 'neon/ tools should appear in results for sql query');
  if (outIdx !== -1) {
    assert.ok(neonIdx < outIdx, 'neon/ tools should rank above out-of-focus tools for sql query');
  }
  assert.equal(parsed.focus, 'data', 'search response should report active focus');
});

test('data focus: search "object storage bucket" includes storage/ tools', async () => {
  const { aggregator } = buildAggregator('data');

  const result = await aggregator.callTool('ch1tty/search', { query: 'object storage bucket', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('storage/')), 'storage/ tools must appear for storage query');
});

test('data focus: out-of-focus tools (github) remain reachable via search', async () => {
  const { aggregator } = buildAggregator('data');

  const result = await aggregator.callTool('ch1tty/search', { query: 'github pull request code review', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('github/')), 'github/ tools must remain reachable when data focus is active');
});

test('data focus: no focus — neon tools still accessible (lens not gate)', async () => {
  const { aggregator } = buildAggregator(); // no focus

  const result = await aggregator.callTool('ch1tty/search', { query: 'neon database sql project', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('neon/')), 'neon/ tools must be reachable without any focus');
});

test('data focus: execute neon/list_projects returns fixture project list', async () => {
  const { aggregator, fixture } = buildAggregator('data');
  fixture.clearCallLog();

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'neon/list_projects',
    args: {},
  });
  assert.equal(result.isError, undefined, 'execute should succeed');

  const projects = JSON.parse(result.content[0].text as string) as Array<{ id: string; name: string }>;
  assert.ok(Array.isArray(projects), 'should return an array of projects');
  assert.ok(projects.length > 0, 'fixture should return at least one project');
  assert.ok(projects.some((p) => p.name.includes('ch1tty')), 'fixture projects should include ch1tty project');

  const calls = fixture.getCallLog();
  assert.ok(calls.some((c) => c.serverId === 'neon' && c.tool === 'list_projects'), 'neon/list_projects must be in call log');
});

test('data focus: execute storage/list_objects returns fixture object list', async () => {
  const { aggregator, fixture } = buildAggregator('data');
  fixture.clearCallLog();

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'storage/list_objects',
    args: { bucket: 'ch1tty-exports' },
  });
  assert.equal(result.isError, undefined, 'execute should succeed');

  const listing = JSON.parse(result.content[0].text as string) as { objects: Array<{ key: string; size: number }>; truncated: boolean };
  assert.ok(Array.isArray(listing.objects), 'should return an objects array');
  assert.ok(listing.objects.length > 0, 'fixture should return at least one object');

  const calls = fixture.getCallLog();
  assert.ok(calls.some((c) => c.serverId === 'storage' && c.tool === 'list_objects'), 'storage/list_objects must be in call log');
});

test('data focus: execute storage/put_object returns confirmation', async () => {
  const { aggregator, fixture } = buildAggregator('data');
  fixture.clearCallLog();

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'storage/put_object',
    args: { bucket: 'ch1tty-exports', key: 'exports/new-export.json', body: '[{"id":"e1"}]' },
  });
  assert.equal(result.isError, undefined, 'execute should succeed');

  const resp = JSON.parse(result.content[0].text as string) as { ok: boolean; key: string };
  assert.equal(resp.ok, true, 'put_object should return ok: true');

  const calls = fixture.getCallLog();
  assert.ok(calls.some((c) => c.serverId === 'storage' && c.tool === 'put_object'), 'storage/put_object must be in call log');
});

test('data focus: multi-step — query neon then export result to storage', async () => {
  const { aggregator, fixture } = buildAggregator('data');
  const sessionId = 'data-scenario-001';
  fixture.clearCallLog();

  // Step 1: run a SQL query against neon
  const queryResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'neon/run_sql',
    args: { project_id: 'proj-abc123', sql: 'SELECT COUNT(*) FROM sessions' },
  }, sessionId);
  assert.equal(queryResult.isError, undefined, 'neon/run_sql should succeed');
  const queryData = JSON.parse(queryResult.content[0].text as string) as { rows: Array<{ count: string }>; rowCount: number };
  assert.ok(queryData.rows.length > 0, 'should return rows');

  // Step 2: store the result in R2 storage
  const storeResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'storage/put_object',
    args: {
      bucket: 'ch1tty-exports',
      key: 'exports/session-count.json',
      body: JSON.stringify({ count: queryData.rows[0]!.count, exported_at: '2026-09-07T00:00:00Z' }),
    },
  }, sessionId);
  assert.equal(storeResult.isError, undefined, 'storage/put_object should succeed');
  const stored = JSON.parse(storeResult.content[0].text as string) as { ok: boolean };
  assert.equal(stored.ok, true, 'stored object should report ok');

  // Both calls must appear in the log
  const calls = fixture.getCallLog();
  const callKeys = calls.map((c) => `${c.serverId}/${c.tool}`);
  assert.ok(callKeys.includes('neon/run_sql'), 'neon/run_sql must be in call log');
  assert.ok(callKeys.includes('storage/put_object'), 'storage/put_object must be in call log');
});

test('data focus: status reports active focus as data', async () => {
  const { aggregator } = buildAggregator('data');

  const result = await aggregator.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined);

  const status = JSON.parse(result.content[0].text as string) as { focus?: { active?: string } };
  assert.equal(status.focus?.active, 'data', 'status must report data as active focus');
});

test('data focus: cast "run a SQL query on neon" resolves to neon/ tool', async () => {
  const { aggregator } = buildAggregator('data');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'run a SQL query on the neon database',
    confirm: true,
  });
  assert.equal(result.isError, undefined, 'cast should not error');

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string; score: number } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.ok(
    resolved.tool.startsWith('neon/'),
    `cast should resolve to a neon/ tool, got: ${resolved.tool}`,
  );
  assert.equal(cast.focus, 'data', 'cast response should report active focus');
});

test('data focus: cast "list objects in storage bucket" resolves to storage/list_objects', async () => {
  const { aggregator } = buildAggregator('data');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'list objects in the storage bucket',
    confirm: true,
  });
  assert.equal(result.isError, undefined);

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.ok(
    resolved.tool.startsWith('storage/'),
    `should resolve to a storage/ tool, got: ${resolved.tool}`,
  );
});

test('data focus: search "list neon projects" finds neon/list_projects', async () => {
  const { aggregator } = buildAggregator('data');

  const result = await aggregator.callTool('ch1tty/search', { query: 'list neon projects', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t === 'neon/list_projects'), 'neon/list_projects must appear in results');
});
