/**
 * Workstream H — ledger-mcp focused server scenarios.
 *
 * Validates the ledger focus profile:
 *  - ledger/ tools are boosted in search ranking (lens, not gate)
 *  - cast resolves audit/ledger intents to ledger/ tools
 *  - out-of-focus tools remain reachable when ledger focus is active
 *  - multi-step ledger workflows execute correctly via the fixture backend
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

const LEDGER_FOCUS_PROFILES = {
  profiles: {
    ledger: {
      description: 'Append-only audit ledger — list namespaces, read entries, and append immutable records',
      categories: ['ecosystem' as const],
      servers: ['ledger'],
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
  { id: 'ledger', name: 'ChittyLedger', type: 'local', access: 'readwrite', category: 'ecosystem', command: 'node', args: ['./apps/ledger-mcp/dist/index.js'] },
  { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.neon' },
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'read', category: 'ecosystem', endpoint: 'https://fixture.stripe' },
  { id: 'notion', name: 'Notion', type: 'remote', access: 'readwrite', category: 'documents', endpoint: 'https://fixture.notion' },
  { id: 'github', name: 'GitHub', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.github' },
  { id: 'tasks', name: 'ChittyAgent Tasks', type: 'local', access: 'readwrite', category: 'ecosystem', command: 'node', args: ['./apps/tasks-mcp/dist/index.js'] },
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
    focusProfiles: LEDGER_FOCUS_PROFILES,
    focus,
    embedEnabled: false,
    backendFactory: (config) => {
      fixture.registerServer(config);
      return fixture;
    },
  });
  return { aggregator, fixture };
}

test('ledger focus: search "list namespaces" ranks ledger/ tools first', async () => {
  const { aggregator } = buildAggregator('ledger');

  const result = await aggregator.callTool('ch1tty/search', { query: 'list namespaces', limit: 10 });
  assert.equal(result.isError, undefined, 'search should not error');

  const parsed = parseSearch(result);
  const tools = parsed.tools ?? [];
  assert.ok(tools.length > 0, 'should return results');

  const ledgerIdx = tools.findIndex((r) => r.tool.startsWith('ledger/'));
  const otherIdx = tools.findIndex((r) => !r.tool.startsWith('ledger/'));

  assert.ok(ledgerIdx !== -1, 'ledger/ tools should appear in results');
  if (otherIdx !== -1) {
    assert.ok(ledgerIdx < otherIdx, 'ledger/ tools should rank above out-of-focus tools for ledger query');
  }
  assert.equal(parsed.focus, 'ledger', 'search response should report active focus');
});

test('ledger focus: search "append entry" includes ledger/append_entry', async () => {
  const { aggregator } = buildAggregator('ledger');

  const result = await aggregator.callTool('ch1tty/search', { query: 'append entry', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t === 'ledger/append_entry'), 'ledger/append_entry must appear in results');
});

test('ledger focus: out-of-focus tools (neon) remain reachable via search', async () => {
  const { aggregator } = buildAggregator('ledger');

  const result = await aggregator.callTool('ch1tty/search', { query: 'database', limit: 20 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('neon/')), 'neon/ tools must remain reachable with ledger focus active');
});

test('ledger focus: no focus — ledger tools still accessible (lens not gate)', async () => {
  const { aggregator } = buildAggregator(); // no focus

  const result = await aggregator.callTool('ch1tty/search', { query: 'ledger namespace', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('ledger/')), 'ledger/ tools must be reachable without any focus');
});

test('ledger focus: execute list_namespaces returns fixture namespace list', async () => {
  const { aggregator, fixture } = buildAggregator('ledger');
  fixture.clearCallLog();

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'ledger/list_namespaces',
    args: {},
  });
  assert.equal(result.isError, undefined, 'execute should succeed');

  const namespaces = JSON.parse(result.content[0].text as string) as Array<{ name: string; entry_count: number }>;
  assert.ok(Array.isArray(namespaces), 'should return an array of namespaces');
  assert.ok(namespaces.length > 0, 'fixture should return at least one namespace');

  const calls = fixture.getCallLog();
  assert.ok(calls.some((c) => c.serverId === 'ledger' && c.tool === 'list_namespaces'), 'ledger/list_namespaces must be in call log');
});

test('ledger focus: multi-step — list namespaces then read entries', async () => {
  const { aggregator, fixture } = buildAggregator('ledger');
  const sessionId = 'ledger-scenario-001';
  fixture.clearCallLog();

  // Step 1: list namespaces
  const nsResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'ledger/list_namespaces',
    args: {},
  }, sessionId);
  assert.equal(nsResult.isError, undefined, 'list_namespaces should succeed');
  const namespaces = JSON.parse(nsResult.content[0].text as string) as Array<{ name: string }>;
  assert.ok(namespaces.length > 0, 'should return namespaces');

  // Step 2: read entries for the first namespace
  const entriesResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'ledger/list_entries',
    args: { namespace: namespaces[0]!.name, limit: 10 },
  }, sessionId);
  assert.equal(entriesResult.isError, undefined, 'list_entries should succeed');
  const body = JSON.parse(entriesResult.content[0].text as string) as { entries: unknown[]; has_more: boolean };
  assert.ok(Array.isArray(body.entries), 'should return entries array');

  // Both calls should appear in the log
  const calls = fixture.getCallLog();
  const toolNames = calls.map((c) => `${c.serverId}/${c.tool}`);
  assert.ok(toolNames.includes('ledger/list_namespaces'), 'list_namespaces must be in call log');
  assert.ok(toolNames.includes('ledger/list_entries'), 'list_entries must be in call log');
});

test('ledger focus: append then get entry via execute', async () => {
  const { aggregator } = buildAggregator('ledger');

  const appendResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'ledger/append_entry',
    args: { namespace: 'events', payload: { type: 'test.event', service: 'ch1tty' } },
  });
  assert.equal(appendResult.isError, undefined, 'append_entry should succeed');
  const created = JSON.parse(appendResult.content[0].text as string) as { id: string; namespace: string; sequence: number };
  assert.ok(created.id, 'appended entry should have an id');
  assert.equal(created.namespace, 'events', 'entry should be in events namespace');
  assert.ok(typeof created.sequence === 'number', 'entry should have a sequence number');

  const getResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'ledger/get_entry',
    args: { namespace: 'events', id: created.id },
  });
  assert.equal(getResult.isError, undefined, 'get_entry should succeed');
  const entry = JSON.parse(getResult.content[0].text as string) as { id: string };
  assert.equal(entry.id, created.id, 'fetched entry id should match appended entry id');
});

test('ledger focus: status reports active focus as ledger', async () => {
  const { aggregator } = buildAggregator('ledger');

  const result = await aggregator.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined);

  const status = JSON.parse(result.content[0].text as string) as { focus?: { active?: string } };
  assert.equal(status.focus?.active, 'ledger', 'status must report ledger as active focus');
});

test('ledger focus: cast "list all ledger namespaces" with confirm resolves to ledger/list_namespaces', async () => {
  const { aggregator } = buildAggregator('ledger');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'list all ledger namespaces',
    confirm: true,
  });
  assert.equal(result.isError, undefined, 'cast should not error');

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string; score: number } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.ok(resolved.tool.startsWith('ledger/'), `cast should resolve to ledger/, got: ${resolved.tool}`);
  assert.equal(cast.focus, 'ledger', 'cast response should report active focus');
});

test('ledger focus: cast "append an audit record" resolves to ledger/append_entry', async () => {
  const { aggregator } = buildAggregator('ledger');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'append an audit record to the ledger',
    confirm: true,
  });
  assert.equal(result.isError, undefined);

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string; score: number } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.equal(
    resolved.tool,
    'ledger/append_entry',
    `should resolve to ledger/append_entry, got: ${resolved.tool}`,
  );
});
