/**
 * Workstream V — monitoring focus profile scenarios.
 *
 * Validates the monitoring focus profile:
 *  - monitoring/ tools are boosted in search ranking (lens, not gate)
 *  - cast resolves observability intents to monitoring/ tools
 *  - out-of-focus tools remain reachable when monitoring focus is active
 *  - multi-step health/alert workflows execute correctly via the fixture backend
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });

const MONITORING_FOCUS_PROFILES = {
  profiles: {
    monitoring: {
      description: 'Service health, alerting, and observability',
      categories: [],
      servers: ['monitoring', 'health'],
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

const MONITORING_FIXTURE_SERVER = {
  tools: [
    {
      name: 'check_health',
      description: 'Check health of all registered services and return status for each endpoint',
      inputSchema: { type: 'object', properties: { service_ids: { type: 'array', items: { type: 'string' } } } },
      response: text(JSON.stringify({
        services: [
          { id: 'chittyos', status: 'ok', latency_ms: 42, checked_at: '2026-09-07T04:00:00Z' },
          { id: 'ledger', status: 'ok', latency_ms: 18, checked_at: '2026-09-07T04:00:00Z' },
          { id: 'tasks', status: 'degraded', latency_ms: 980, checked_at: '2026-09-07T04:00:00Z' },
        ],
        summary: { total: 3, ok: 2, degraded: 1, down: 0 },
      })),
    },
    {
      name: 'list_alerts',
      description: 'List currently active alert notifications across services',
      inputSchema: { type: 'object', properties: { severity: { type: 'string', enum: ['critical', 'warning', 'info'] } } },
      response: text(JSON.stringify({
        alerts: [
          { id: 'alert-1', service: 'tasks', severity: 'warning', message: 'p99 latency above threshold', fired_at: '2026-09-07T03:58:00Z' },
        ],
        count: 1,
      })),
    },
    {
      name: 'get_uptime_metrics',
      description: 'Get uptime percentage and availability metrics for a service over a time window',
      inputSchema: {
        type: 'object',
        properties: {
          service_id: { type: 'string' },
          window_hours: { type: 'number' },
        },
        required: ['service_id'],
      },
      response: text(JSON.stringify({
        service_id: 'chittyos',
        window_hours: 24,
        uptime_pct: 99.97,
        outages: [],
        checked_intervals: 1440,
      })),
    },
    {
      name: 'list_alert_rules',
      description: 'List all configured alert rules with their conditions and current state',
      inputSchema: { type: 'object', properties: { service_id: { type: 'string' } } },
      response: text(JSON.stringify({
        rules: [
          { id: 'rule-latency', condition: 'p99_ms > 500', state: 'firing', service: 'tasks' },
          { id: 'rule-error-rate', condition: 'error_rate > 0.01', state: 'ok', service: 'chittyos' },
        ],
      })),
    },
    {
      name: 'probe_endpoint',
      description: 'Probe an HTTP endpoint for availability and measure response latency',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          expected_status: { type: 'number' },
        },
        required: ['url'],
      },
      response: text(JSON.stringify({
        url: 'https://ch1tty.chitty.cc/health',
        status: 200,
        latency_ms: 35,
        ok: true,
        probed_at: '2026-09-07T04:00:00Z',
      })),
    },
  ],
};

const FIXTURE_CONFIGS: ServerConfig[] = [
  { id: 'monitoring', name: 'Monitoring', type: 'remote', access: 'read', category: 'ecosystem', endpoint: 'https://fixture.monitoring' },
  { id: 'health', name: 'Health', type: 'remote', access: 'read', category: 'ecosystem', endpoint: 'https://fixture.health' },
  { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.neon' },
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'read', category: 'ecosystem', endpoint: 'https://fixture.stripe' },
  { id: 'notion', name: 'Notion', type: 'remote', access: 'readwrite', category: 'documents', endpoint: 'https://fixture.notion' },
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
  fixture.defineServer('monitoring', MONITORING_FIXTURE_SERVER);
  fixture.defineServer('health', MONITORING_FIXTURE_SERVER);
  const aggregator = new Aggregator(FIXTURE_CONFIGS, {
    focusProfiles: MONITORING_FOCUS_PROFILES,
    focus,
    embedEnabled: false,
    backendFactory: (config) => {
      fixture.registerServer(config);
      return fixture;
    },
  });
  return { aggregator, fixture };
}

test('monitoring focus: search "health check" ranks monitoring/ tools first', async () => {
  const { aggregator } = buildAggregator('monitoring');

  const result = await aggregator.callTool('ch1tty/search', { query: 'health check', limit: 10 });
  assert.equal(result.isError, undefined, 'search should not error');

  const parsed = parseSearch(result);
  const tools = parsed.tools ?? [];
  assert.ok(tools.length > 0, 'should return results');

  const monitoringIdx = tools.findIndex((r) => r.tool.startsWith('monitoring/'));
  const otherIdx = tools.findIndex((r) => !r.tool.startsWith('monitoring/') && !r.tool.startsWith('health/'));

  assert.ok(monitoringIdx !== -1, 'monitoring/ tools should appear in results');
  if (otherIdx !== -1) {
    assert.ok(monitoringIdx < otherIdx, 'monitoring/ tools should rank above out-of-focus tools for health query');
  }
  assert.equal(parsed.focus, 'monitoring', 'search response should report active focus');
});

test('monitoring focus: search "alerts" includes monitoring/list_alerts', async () => {
  const { aggregator } = buildAggregator('monitoring');

  const result = await aggregator.callTool('ch1tty/search', { query: 'alerts', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t === 'monitoring/list_alerts'), 'monitoring/list_alerts must appear in results');
});

test('monitoring focus: search "uptime" includes monitoring/get_uptime_metrics', async () => {
  const { aggregator } = buildAggregator('monitoring');

  const result = await aggregator.callTool('ch1tty/search', { query: 'uptime metrics', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t === 'monitoring/get_uptime_metrics'), 'monitoring/get_uptime_metrics must appear in results');
});

test('monitoring focus: out-of-focus tools (neon) remain reachable via search', async () => {
  const { aggregator } = buildAggregator('monitoring');

  const result = await aggregator.callTool('ch1tty/search', { query: 'database sql', limit: 20 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('neon/')), 'neon/ tools must remain reachable with monitoring focus active');
});

test('monitoring focus: no focus — monitoring tools still accessible (lens not gate)', async () => {
  const { aggregator } = buildAggregator(); // no focus

  const result = await aggregator.callTool('ch1tty/search', { query: 'health check service', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('monitoring/')), 'monitoring/ tools must be reachable without any focus');
});

test('monitoring focus: execute check_health returns service status', async () => {
  const { aggregator, fixture } = buildAggregator('monitoring');
  fixture.clearCallLog();

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'monitoring/check_health',
    args: {},
  });
  assert.equal(result.isError, undefined, 'check_health should succeed');

  const status = JSON.parse(result.content[0].text as string) as { services: Array<{ id: string; status: string }>; summary: { total: number } };
  assert.ok(Array.isArray(status.services), 'should return services array');
  assert.ok(status.services.length > 0, 'fixture should return at least one service');
  assert.ok(typeof status.summary.total === 'number', 'should include summary.total');

  const calls = fixture.getCallLog();
  assert.ok(calls.some((c) => c.serverId === 'monitoring' && c.tool === 'check_health'), 'check_health must be in call log');
});

test('monitoring focus: execute list_alerts returns active alerts', async () => {
  const { aggregator, fixture } = buildAggregator('monitoring');
  fixture.clearCallLog();

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'monitoring/list_alerts',
    args: {},
  });
  assert.equal(result.isError, undefined, 'list_alerts should succeed');

  const alerts = JSON.parse(result.content[0].text as string) as { alerts: Array<{ id: string; severity: string }>; count: number };
  assert.ok(Array.isArray(alerts.alerts), 'should return alerts array');
  assert.ok(typeof alerts.count === 'number', 'should include count');
});

test('monitoring focus: multi-step — check health then list active alerts', async () => {
  const { aggregator, fixture } = buildAggregator('monitoring');
  const sessionId = 'monitoring-scenario-001';
  fixture.clearCallLog();

  // Step 1: check health
  const healthResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'monitoring/check_health',
    args: {},
  }, sessionId);
  assert.equal(healthResult.isError, undefined, 'check_health should succeed');
  const health = JSON.parse(healthResult.content[0].text as string) as { summary: { degraded: number } };
  assert.ok(health.summary.degraded >= 0, 'summary.degraded should be a non-negative number');

  // Step 2: list alerts for context
  const alertResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'monitoring/list_alerts',
    args: {},
  }, sessionId);
  assert.equal(alertResult.isError, undefined, 'list_alerts should succeed');
  const alerts = JSON.parse(alertResult.content[0].text as string) as { count: number };
  assert.ok(typeof alerts.count === 'number', 'alerts count should be a number');

  // Both calls should appear in the log
  const calls = fixture.getCallLog();
  const toolNames = calls.map((c) => `${c.serverId}/${c.tool}`);
  assert.ok(toolNames.includes('monitoring/check_health'), 'check_health must be in call log');
  assert.ok(toolNames.includes('monitoring/list_alerts'), 'list_alerts must be in call log');
});

test('monitoring focus: probe endpoint returns latency and status', async () => {
  const { aggregator } = buildAggregator('monitoring');

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'monitoring/probe_endpoint',
    args: { url: 'https://ch1tty.chitty.cc/health', expected_status: 200 },
  });
  assert.equal(result.isError, undefined, 'probe_endpoint should succeed');

  const probe = JSON.parse(result.content[0].text as string) as { ok: boolean; status: number; latency_ms: number };
  assert.equal(probe.ok, true, 'probe should return ok: true');
  assert.equal(probe.status, 200, 'probe should return HTTP 200');
  assert.ok(typeof probe.latency_ms === 'number', 'probe should include latency_ms');
});

test('monitoring focus: cast resolves health intent to monitoring tools', async () => {
  const { aggregator } = buildAggregator('monitoring');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'check if any services are down',
    focus: 'monitoring',
    confirm: true,
  });
  assert.equal(result.isError, undefined, 'cast should not error');

  const cast = parseCast(result);
  assert.ok(cast.plan !== undefined || cast.tool !== undefined || cast.resolved !== undefined,
    'cast should return a plan or resolved tool');
  const str = JSON.stringify(cast);
  assert.ok(str.includes('monitoring'), 'cast should resolve toward monitoring tools');
});

test('monitoring focus: get_uptime_metrics returns availability data', async () => {
  const { aggregator } = buildAggregator('monitoring');

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'monitoring/get_uptime_metrics',
    args: { service_id: 'chittyos', window_hours: 24 },
  });
  assert.equal(result.isError, undefined, 'get_uptime_metrics should succeed');

  const metrics = JSON.parse(result.content[0].text as string) as {
    service_id: string;
    uptime_pct: number;
    window_hours: number;
  };
  assert.equal(metrics.service_id, 'chittyos', 'should return metrics for the requested service');
  assert.ok(metrics.uptime_pct >= 0 && metrics.uptime_pct <= 100, 'uptime_pct should be 0–100');
});
