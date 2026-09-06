/**
 * Workstream N — realestate focus profile scenarios.
 *
 * Validates the realestate focus profile:
 *  - turbotenant/ tools are boosted in search ranking (lens, not gate)
 *  - cast resolves property-management intents to turbotenant/ tools
 *  - out-of-focus tools remain reachable when realestate focus is active
 *  - multi-step property → tenant workflows execute via the fixture backend
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

const REALESTATE_FOCUS_PROFILES = {
  profiles: {
    realestate: {
      description: 'Property management — list and inspect rental properties, tenants, leases, and maintenance requests via TurboTenant',
      categories: ['ecosystem' as const],
      servers: ['turbotenant', 'market', 'finance', 'tasks'],
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
  { id: 'turbotenant', name: 'TurboTenant', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://fixture.turbotenant' },
  { id: 'tasks', name: 'ChittyAgent Tasks', type: 'local', access: 'readwrite', category: 'ecosystem', command: 'node', args: ['./apps/tasks-mcp/dist/index.js'] },
  { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.neon' },
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'read', category: 'ecosystem', endpoint: 'https://fixture.stripe' },
  { id: 'ledger', name: 'ChittyLedger', type: 'local', access: 'readwrite', category: 'ecosystem', command: 'node', args: ['./apps/ledger-mcp/dist/index.js'] },
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
    focusProfiles: REALESTATE_FOCUS_PROFILES,
    focus,
    embedEnabled: false,
    backendFactory: (config) => {
      fixture.registerServer(config);
      return fixture;
    },
  });
  return { aggregator, fixture };
}

test('realestate focus: search "list properties" ranks turbotenant/ tools first', async () => {
  const { aggregator } = buildAggregator('realestate');

  const result = await aggregator.callTool('ch1tty/search', { query: 'list properties', limit: 10 });
  assert.equal(result.isError, undefined, 'search should not error');

  const parsed = parseSearch(result);
  const tools = parsed.tools ?? [];
  assert.ok(tools.length > 0, 'should return results');

  const ttIdx = tools.findIndex((r) => r.tool.startsWith('turbotenant/'));
  const otherIdx = tools.findIndex((r) => !r.tool.startsWith('turbotenant/'));

  assert.ok(ttIdx !== -1, 'turbotenant/ tools should appear in results');
  if (otherIdx !== -1) {
    assert.ok(ttIdx < otherIdx, 'turbotenant/ tools should rank above out-of-focus tools for property query');
  }
  assert.equal(parsed.focus, 'realestate', 'search response should report active focus');
});

test('realestate focus: search "tenant" includes turbotenant/list_tenants', async () => {
  const { aggregator } = buildAggregator('realestate');

  const result = await aggregator.callTool('ch1tty/search', { query: 'tenant', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t === 'turbotenant/list_tenants'), 'turbotenant/list_tenants must appear in results');
});

test('realestate focus: search "maintenance" includes turbotenant/list_maintenance_requests', async () => {
  const { aggregator } = buildAggregator('realestate');

  const result = await aggregator.callTool('ch1tty/search', { query: 'maintenance', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t === 'turbotenant/list_maintenance_requests'), 'turbotenant/list_maintenance_requests must appear in results');
});

test('realestate focus: out-of-focus tools (neon) remain reachable via search', async () => {
  const { aggregator } = buildAggregator('realestate');

  const result = await aggregator.callTool('ch1tty/search', { query: 'database', limit: 20 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('neon/')), 'neon/ tools must remain reachable with realestate focus active');
});

test('realestate focus: no focus — turbotenant tools still accessible (lens not gate)', async () => {
  const { aggregator } = buildAggregator(); // no focus

  const result = await aggregator.callTool('ch1tty/search', { query: 'rental property tenant', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('turbotenant/')), 'turbotenant/ tools must be reachable without any focus');
});

test('realestate focus: execute list_properties returns fixture property list', async () => {
  const { aggregator, fixture } = buildAggregator('realestate');
  fixture.clearCallLog();

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'turbotenant/list_properties',
    args: {},
  });
  assert.equal(result.isError, undefined, 'execute should succeed');

  const body = JSON.parse(result.content[0].text as string) as { properties: Array<{ id: string; address: string }> };
  assert.ok(Array.isArray(body.properties), 'should return a properties array');
  assert.ok(body.properties.length > 0, 'fixture should return at least one property');
  assert.ok(body.properties[0]?.id, 'each property should have an id');

  const calls = fixture.getCallLog();
  assert.ok(calls.some((c) => c.serverId === 'turbotenant' && c.tool === 'list_properties'), 'turbotenant/list_properties must be in call log');
});

test('realestate focus: multi-step — list properties then list tenants for first property', async () => {
  const { aggregator, fixture } = buildAggregator('realestate');
  const sessionId = 'realestate-scenario-001';
  fixture.clearCallLog();

  // Step 1: list properties
  const propsResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'turbotenant/list_properties',
    args: {},
  }, sessionId);
  assert.equal(propsResult.isError, undefined, 'list_properties should succeed');
  const { properties } = JSON.parse(propsResult.content[0].text as string) as { properties: Array<{ id: string }> };
  assert.ok(properties.length > 0, 'should return at least one property');

  // Step 2: list tenants for the first property
  const tenantsResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'turbotenant/list_tenants',
    args: { property_id: properties[0]!.id },
  }, sessionId);
  assert.equal(tenantsResult.isError, undefined, 'list_tenants should succeed');
  const { tenants } = JSON.parse(tenantsResult.content[0].text as string) as { tenants: unknown[] };
  assert.ok(Array.isArray(tenants), 'should return tenants array');

  const calls = fixture.getCallLog();
  const toolNames = calls.map((c) => `${c.serverId}/${c.tool}`);
  assert.ok(toolNames.includes('turbotenant/list_properties'), 'list_properties must be in call log');
  assert.ok(toolNames.includes('turbotenant/list_tenants'), 'list_tenants must be in call log');
});

test('realestate focus: execute create_maintenance_request returns new request id', async () => {
  const { aggregator } = buildAggregator('realestate');

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'turbotenant/create_maintenance_request',
    args: { property_id: 'prop-001', unit: '2A', description: 'Outlet not working', category: 'electrical', priority: 'medium' },
  });
  assert.equal(result.isError, undefined, 'create_maintenance_request should succeed');

  const created = JSON.parse(result.content[0].text as string) as { id: string; status: string; property_id: string };
  assert.ok(created.id, 'created request should have an id');
  assert.equal(created.status, 'open', 'new request status should be open');
});

test('realestate focus: status reports active focus as realestate', async () => {
  const { aggregator } = buildAggregator('realestate');

  const result = await aggregator.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined);

  const status = JSON.parse(result.content[0].text as string) as { focus?: { active?: string } };
  assert.equal(status.focus?.active, 'realestate', 'status must report realestate as active focus');
});

test('realestate focus: cast "list my rental properties" with confirm resolves to turbotenant/list_properties', async () => {
  const { aggregator } = buildAggregator('realestate');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'list my rental properties',
    confirm: true,
  });
  assert.equal(result.isError, undefined, 'cast should not error');

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string; score: number } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.ok(resolved.tool.startsWith('turbotenant/'), `cast should resolve to turbotenant/, got: ${resolved.tool}`);
  assert.equal(cast.focus, 'realestate', 'cast response should report active focus');
});

test('realestate focus: cast "show open maintenance issues" resolves to turbotenant/ tool', async () => {
  const { aggregator } = buildAggregator('realestate');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'show open maintenance issues for my properties',
    confirm: true,
  });
  assert.equal(result.isError, undefined);

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string; score: number } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.ok(resolved.tool.startsWith('turbotenant/'), `cast should resolve to turbotenant/, got: ${resolved.tool}`);
});
