/**
 * Workstream U — analytics focus profile scenarios.
 *
 * Validates the analytics focus profile:
 *  - analytics/ tools are boosted in search ranking (lens, not gate)
 *  - cast resolves analytics intents to analytics/ tools
 *  - out-of-focus tools remain reachable when analytics focus is active
 *  - multi-step analytics workflows execute correctly via the fixture backend
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

const ANALYTICS_FOCUS_PROFILES = {
  profiles: {
    analytics: {
      description: 'Data analytics — query metrics, aggregate events, and export reports.',
      categories: ['ecosystem' as const],
      servers: ['analytics'],
      boost: 0.6,
    },
    code: {
      description: 'Software development',
      categories: ['code' as const],
      servers: ['github', 'neon'],
      boost: 0.5,
    },
  },
};

const FIXTURE_CONFIGS: ServerConfig[] = [
  { id: 'analytics', name: 'Analytics', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://fixture.analytics' },
  { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.neon' },
  { id: 'github', name: 'GitHub', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.github' },
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
    focusProfiles: ANALYTICS_FOCUS_PROFILES,
    focus,
    embedEnabled: false,
    backendFactory: (config) => {
      fixture.registerServer(config);
      return fixture;
    },
  });
  return { aggregator, fixture };
}

test('analytics focus: search "query metrics" ranks analytics/ tools first', async () => {
  const { aggregator } = buildAggregator('analytics');

  const result = await aggregator.callTool('ch1tty/search', { query: 'query metrics', limit: 10 });
  assert.equal(result.isError, undefined, 'search should not error');

  const parsed = parseSearch(result);
  const tools = parsed.tools ?? [];
  assert.ok(tools.length > 0, 'should return results');

  const analyticsIdx = tools.findIndex((r) => r.tool.startsWith('analytics/'));
  const otherIdx = tools.findIndex((r) => !r.tool.startsWith('analytics/'));

  assert.ok(analyticsIdx !== -1, 'analytics/ tools should appear in results');
  if (otherIdx !== -1) {
    assert.ok(analyticsIdx < otherIdx, 'analytics/ tools should rank above out-of-focus tools for metrics query');
  }
  assert.equal(parsed.focus, 'analytics', 'search response should report active focus');
});

test('analytics focus: search "export report" includes analytics/export_report', async () => {
  const { aggregator } = buildAggregator('analytics');

  const result = await aggregator.callTool('ch1tty/search', { query: 'export report', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t === 'analytics/export_report'), 'analytics/export_report must appear in results');
});

test('analytics focus: out-of-focus tools (neon) remain reachable via search', async () => {
  const { aggregator } = buildAggregator('analytics');

  const result = await aggregator.callTool('ch1tty/search', { query: 'database sql', limit: 20 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('neon/')), 'neon/ tools must remain reachable with analytics focus active');
});

test('analytics focus: no focus — analytics tools still accessible (lens not gate)', async () => {
  const { aggregator } = buildAggregator();

  const result = await aggregator.callTool('ch1tty/search', { query: 'analytics metrics events', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('analytics/')), 'analytics/ tools must be reachable without any focus');
});

test('analytics focus: execute query_metrics returns fixture metric points', async () => {
  const { aggregator, fixture } = buildAggregator('analytics');
  fixture.clearCallLog();

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'analytics/query_metrics',
    args: { metric: 'page_views', from: '2026-09-01T00:00:00Z', to: '2026-09-07T00:00:00Z' },
  });
  assert.equal(result.isError, undefined, 'execute should succeed');

  const parsed = JSON.parse(result.content[0].text as string) as { metric: string; points: Array<{ ts: string; value: number }>; total: number };
  assert.equal(parsed.metric, 'page_views', 'metric name should match');
  assert.ok(Array.isArray(parsed.points), 'should return points array');
  assert.ok(parsed.points.length > 0, 'fixture should return at least one data point');
  assert.ok(typeof parsed.total === 'number', 'should include total count');

  const calls = fixture.getCallLog();
  assert.ok(calls.some((c) => c.serverId === 'analytics' && c.tool === 'query_metrics'), 'analytics/query_metrics must be in call log');
});

test('analytics focus: multi-step — list events then aggregate by type', async () => {
  const { aggregator, fixture } = buildAggregator('analytics');
  const sessionId = 'analytics-scenario-001';
  fixture.clearCallLog();

  // Step 1: list events
  const listResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'analytics/list_events',
    args: { from: '2026-09-07T00:00:00Z', to: '2026-09-07T04:00:00Z', limit: 50 },
  }, sessionId);
  assert.equal(listResult.isError, undefined, 'list_events should succeed');
  const listParsed = JSON.parse(listResult.content[0].text as string) as { events: Array<{ id: string; type: string }> };
  assert.ok(Array.isArray(listParsed.events), 'should return events array');
  assert.ok(listParsed.events.length > 0, 'fixture should return at least one event');

  // Step 2: aggregate by type
  const aggResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'analytics/aggregate_events',
    args: { dimension: 'type', from: '2026-09-07T00:00:00Z', to: '2026-09-07T04:00:00Z' },
  }, sessionId);
  assert.equal(aggResult.isError, undefined, 'aggregate_events should succeed');
  const aggParsed = JSON.parse(aggResult.content[0].text as string) as { dimension: string; buckets: Array<{ key: string; count: number }> };
  assert.equal(aggParsed.dimension, 'type', 'dimension should match requested value');
  assert.ok(Array.isArray(aggParsed.buckets), 'should return buckets array');

  const calls = fixture.getCallLog();
  const toolNames = calls.map((c) => `${c.serverId}/${c.tool}`);
  assert.ok(toolNames.includes('analytics/list_events'), 'list_events must be in call log');
  assert.ok(toolNames.includes('analytics/aggregate_events'), 'aggregate_events must be in call log');
});

test('analytics focus: execute export_report returns report reference', async () => {
  const { aggregator } = buildAggregator('analytics');

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'analytics/export_report',
    args: { title: 'Q3 Analytics Export', from: '2026-07-01T00:00:00Z', to: '2026-09-30T23:59:59Z', format: 'json' },
  });
  assert.equal(result.isError, undefined, 'export_report should succeed');

  const parsed = JSON.parse(result.content[0].text as string) as { report_id: string; download_ref: string; rows: number };
  assert.ok(parsed.report_id, 'report should have an id');
  assert.ok(parsed.download_ref.startsWith('analytics://'), 'download_ref should use analytics:// scheme');
  assert.ok(typeof parsed.rows === 'number', 'should include a row count');
});

test('analytics focus: execute get_dashboard returns dashboard panels', async () => {
  const { aggregator } = buildAggregator('analytics');

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'analytics/get_dashboard',
    args: { name: 'main' },
  });
  assert.equal(result.isError, undefined, 'get_dashboard should succeed');

  const parsed = JSON.parse(result.content[0].text as string) as { name: string; panels: Array<{ id: string; metric: string }> };
  assert.equal(parsed.name, 'main', 'dashboard name should match request');
  assert.ok(Array.isArray(parsed.panels), 'should return panels array');
  assert.ok(parsed.panels.length > 0, 'dashboard should have at least one panel');
});

test('analytics focus: status reports active focus as analytics', async () => {
  const { aggregator } = buildAggregator('analytics');

  const result = await aggregator.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined);

  const status = JSON.parse(result.content[0].text as string) as { focus?: { active?: string } };
  assert.equal(status.focus?.active, 'analytics', 'status must report analytics as active focus');
});

test('analytics focus: cast "query metrics" with confirm resolves to analytics/ tool', async () => {
  const { aggregator } = buildAggregator('analytics');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'query time-series metrics for page views',
    confirm: true,
  });
  assert.equal(result.isError, undefined, 'cast should not error');

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string; score: number } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.ok(resolved.tool.startsWith('analytics/'), `cast should resolve to analytics/, got: ${resolved.tool}`);
  assert.equal(cast.focus, 'analytics', 'cast response should report active focus');
});

test('analytics focus: cast "aggregate events" resolves to analytics/aggregate_events', async () => {
  const { aggregator } = buildAggregator('analytics');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'aggregate tracked events by type to find frequency patterns',
    confirm: true,
  });
  assert.equal(result.isError, undefined);

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string; score: number } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.equal(
    resolved.tool,
    'analytics/aggregate_events',
    `should resolve to analytics/aggregate_events, got: ${resolved.tool}`,
  );
});

test('analytics focus: per-call focus=analytics overrides no default focus', async () => {
  const { aggregator } = buildAggregator();

  const result = await aggregator.callTool('ch1tty/search', { query: 'metrics events', limit: 10, focus: 'analytics' });
  assert.equal(result.isError, undefined, 'per-call focus should not error');

  const parsed = parseSearch(result);
  assert.equal(parsed.focus, 'analytics', 'search response should report analytics focus set via per-call param');

  const tools = parsed.tools ?? [];
  const analyticsIdx = tools.findIndex((r) => r.tool.startsWith('analytics/'));
  assert.ok(analyticsIdx !== -1, 'analytics/ tools should appear when per-call focus=analytics is set');
});
