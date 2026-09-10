/**
 * Workstream W — finance focus profile scenarios.
 *
 * Validates the finance focus profile:
 *  - stripe/ and ledger/ tools are boosted in search ranking (lens, not gate)
 *  - cast resolves payment/billing intents to stripe/ tools
 *  - out-of-focus tools remain reachable when finance focus is active
 *  - multi-step finance workflow (check balance → list payments) executes via fixture backend
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

const FINANCE_FOCUS_PROFILES = {
  profiles: {
    finance: {
      description: 'Finance — Stripe payments, ledger entries, billing, and task tracking for financial workflows.',
      categories: ['ecosystem' as const],
      servers: ['stripe', 'tasks', 'ledger'],
      boost: 0.5,
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
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://fixture.stripe' },
  { id: 'tasks', name: 'Tasks', type: 'local', access: 'readwrite', category: 'ecosystem', command: 'node', args: ['./tasks'] },
  { id: 'ledger', name: 'Ledger', type: 'local', access: 'readwrite', category: 'ecosystem', command: 'node', args: ['./ledger'] },
  { id: 'github', name: 'GitHub', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.github' },
  { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.neon' },
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
    focusProfiles: FINANCE_FOCUS_PROFILES,
    focus,
    embedEnabled: false,
    backendFactory: (config) => {
      fixture.registerServer(config);
      return fixture;
    },
  });
  return { aggregator, fixture };
}

test('finance focus: search "payment billing" ranks stripe/ tools first', async () => {
  const { aggregator } = buildAggregator('finance');

  const result = await aggregator.callTool('ch1tty/search', { query: 'payment billing invoice', limit: 10 });
  assert.equal(result.isError, undefined, 'search should not error');

  const parsed = parseSearch(result);
  const tools = parsed.tools ?? [];
  assert.ok(tools.length > 0, 'should return results');

  const financeIdx = tools.findIndex((r) => ['stripe/', 'ledger/', 'tasks/'].some((p) => r.tool.startsWith(p)));
  const outIdx = tools.findIndex((r) => !['stripe/', 'ledger/', 'tasks/'].some((p) => r.tool.startsWith(p)));

  assert.ok(financeIdx !== -1, 'stripe/ledger/tasks tools should appear for payment query');
  if (outIdx !== -1) {
    assert.ok(financeIdx < outIdx, 'finance tools should rank above out-of-focus tools for payment query');
  }
  assert.equal(parsed.focus, 'finance', 'search response should report active focus');
});

test('finance focus: out-of-focus tools (github) remain reachable', async () => {
  const { aggregator } = buildAggregator('finance');

  const result = await aggregator.callTool('ch1tty/search', { query: 'code commit repository branch', limit: 15 });
  assert.equal(result.isError, undefined, 'search should not error with finance focus');

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('github/')), 'github/ tools must remain reachable under finance focus');
});

test('finance focus: cast "check account balance" resolves to stripe/ tool', async () => {
  const { aggregator } = buildAggregator('finance');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'check the current Stripe account balance for available funds',
    confirm: true,
  });
  assert.equal(result.isError, undefined, 'cast should not error');

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.ok(
    ['stripe/', 'ledger/', 'tasks/'].some((p) => resolved.tool.startsWith(p)),
    `cast should resolve to finance-focus tool, got: ${resolved.tool}`,
  );
  assert.equal(cast.focus, 'finance', 'cast response should report active focus');
});

test('finance focus: execute stripe/get_balance returns balance', async () => {
  const { aggregator } = buildAggregator('finance');

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'stripe/get_balance',
    args: {},
  });
  assert.equal(result.isError, undefined, 'stripe/get_balance should succeed under finance focus');
  const parsed = JSON.parse(result.content[0].text as string) as { available?: Array<{ amount: number; currency: string }> };
  assert.ok(Array.isArray(parsed.available), 'balance response should include available array');
});

test('finance focus: multi-step — get balance, then list payments', async () => {
  const { aggregator } = buildAggregator('finance');

  const balResult = await aggregator.callTool('ch1tty/execute', { tool: 'stripe/get_balance', args: {} });
  assert.equal(balResult.isError, undefined, 'get_balance step should succeed');

  const balParsed = JSON.parse(balResult.content[0].text as string) as { available?: Array<{ amount: number }> };
  assert.ok(Array.isArray(balParsed.available), 'balance should be returned');

  const listResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'stripe/list_payments',
    args: { limit: 5 },
  });
  assert.equal(listResult.isError, undefined, 'list_payments step should succeed');
  const listParsed = JSON.parse(listResult.content[0].text as string) as { data?: unknown[] };
  assert.ok(Array.isArray(listParsed.data), 'payments data array should be returned');
});

test('finance focus: status reports active focus as finance', async () => {
  const { aggregator } = buildAggregator('finance');

  const result = await aggregator.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined);

  const status = JSON.parse(result.content[0].text as string) as { focus?: { active?: string } };
  assert.equal(status.focus?.active, 'finance', 'status must report finance as active focus');
});
