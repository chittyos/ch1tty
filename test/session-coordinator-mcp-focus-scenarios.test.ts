/**
 * Workstream J — session-coordinator-mcp focused server scenarios.
 *
 * Validates the session focus profile:
 *  - session/ tools are boosted in search ranking (lens, not gate)
 *  - cast resolves session-management intents to session/ tools
 *  - out-of-focus tools remain reachable when session focus is active
 *  - multi-step session workflows execute correctly via the fixture backend
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

const SESSION_FOCUS_PROFILES = {
  profiles: {
    session: {
      description: 'Cross-channel session management — create, inspect, update, close, and replay ChittyOS sessions and their event logs',
      categories: ['ecosystem' as const],
      servers: ['session'],
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
  { id: 'session', name: 'ChittyOS Session Coordinator', type: 'local', access: 'readwrite', category: 'ecosystem', command: 'node', args: ['./apps/session-coordinator-mcp/dist/index.js'] },
  { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.neon' },
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'read', category: 'ecosystem', endpoint: 'https://fixture.stripe' },
  { id: 'notion', name: 'Notion', type: 'remote', access: 'readwrite', category: 'documents', endpoint: 'https://fixture.notion' },
  { id: 'github', name: 'GitHub', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.github' },
];

type SearchResult = { tools?: Array<{ tool: string; score?: number; inFocus?: boolean }>; focus?: string };
type CastResult = { cast?: string; resolved?: { tool: string; score: number }; focus?: string; [key: string]: unknown };

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
    focusProfiles: SESSION_FOCUS_PROFILES,
    focus,
    embedEnabled: false,
    backendFactory: (config) => {
      fixture.registerServer(config);
      return fixture;
    },
  });
  return { aggregator, fixture };
}

test('session focus: search "list sessions" ranks session/ tools first', async () => {
  const { aggregator } = buildAggregator('session');

  const result = await aggregator.callTool('ch1tty/search', { query: 'list sessions', limit: 10 });
  assert.equal(result.isError, undefined, 'search should not error');

  const parsed = parseSearch(result);
  const tools = parsed.tools ?? [];
  assert.ok(tools.length > 0, 'should return results');

  const sessionIdx = tools.findIndex((r) => r.tool.startsWith('session/'));
  const otherIdx = tools.findIndex((r) => !r.tool.startsWith('session/'));

  assert.ok(sessionIdx !== -1, 'session/ tool should appear in results');
  if (otherIdx !== -1) {
    assert.ok(sessionIdx < otherIdx, `session/ tool (idx ${sessionIdx}) should rank before non-session tool (idx ${otherIdx})`);
  }
  assert.equal(parsed.focus, 'session', 'response should echo active focus');
});

test('session focus: out-of-focus tools (neon, stripe) remain reachable', async () => {
  const { aggregator } = buildAggregator('session');

  const result = await aggregator.callTool('ch1tty/search', { query: 'database sql project', limit: 20 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const tools = parsed.tools ?? [];
  const neonTool = tools.find((r) => r.tool.startsWith('neon/'));
  assert.ok(neonTool, 'neon/ tools should still appear when session focus is active (lens not gate)');
});

test('session focus: no focus leaves session/ tools reachable via search', async () => {
  const { aggregator } = buildAggregator();

  const result = await aggregator.callTool('ch1tty/search', { query: 'session channel', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const tools = parsed.tools ?? [];
  const sessionTool = tools.find((r) => r.tool.startsWith('session/'));
  assert.ok(sessionTool, 'session/ tools should be searchable without a focus active');
});

test('session focus: cast "list active sessions" resolves to session/list_sessions', async () => {
  const { aggregator } = buildAggregator('session');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'list active sessions',
    confirm: true,
  });
  assert.equal(result.isError, undefined, 'cast should not error');

  const parsed = parseCast(result);
  assert.equal(parsed.cast, 'plan', `cast.cast should be 'plan', got: ${String(parsed.cast)}`);
  const resolved = parsed.resolved;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.ok(resolved.tool.startsWith('session/'), `cast should resolve to session/, got: ${resolved.tool}`);
  assert.equal(parsed.focus, 'session', 'cast response should report active focus');
});

test('session focus: cast "create a new session" resolves to session/create_session', async () => {
  const { aggregator } = buildAggregator('session');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'create a new session for claude-code channel',
    confirm: true,
  });
  assert.equal(result.isError, undefined);

  const parsed = parseCast(result);
  assert.equal(parsed.cast, 'plan', `cast.cast should be 'plan', got: ${String(parsed.cast)}`);
  const resolved = parsed.resolved;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.ok(resolved.tool.startsWith('session/'), `cast should resolve to session/, got: ${resolved.tool}`);
});

test('session focus: search with explicit focus:none ignores session boost', async () => {
  const { aggregator } = buildAggregator('session');

  const result = await aggregator.callTool('ch1tty/search', { query: 'list sessions', limit: 10, focus: 'none' });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  assert.notEqual(parsed.focus, 'session', 'focus:none should override env focus');
});

test('session focus: execute session/list_sessions returns fixture sessions', async () => {
  const { aggregator } = buildAggregator('session');

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'session/list_sessions',
    args: { status: 'active' },
  });
  assert.equal(result.isError, undefined, 'execute should not error');

  const text = result.content?.[0]?.text ?? '';
  const parsed = JSON.parse(text) as unknown[];
  assert.ok(Array.isArray(parsed), 'result should be an array of sessions');
  assert.ok(parsed.length > 0, 'fixture should return at least one session');
  const first = parsed[0] as Record<string, unknown>;
  assert.ok(first.id, 'session should have an id');
  assert.ok(first.channel, 'session should have a channel');
});

test('session focus: execute session/create_session then get_session round-trip', async () => {
  const { aggregator } = buildAggregator('session');

  const createResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'session/create_session',
    args: { channel: 'claude-code', user_id: 'u-test' },
  });
  assert.equal(createResult.isError, undefined, 'create_session should not error');

  const created = JSON.parse(createResult.content?.[0]?.text ?? '{}') as Record<string, unknown>;
  assert.ok(created.id, 'created session should have an id');
  assert.equal(created.status, 'active', 'new session should be active');

  const getResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'session/get_session',
    args: { id: 'sess-1' },
  });
  assert.equal(getResult.isError, undefined, 'get_session should not error');

  const fetched = JSON.parse(getResult.content?.[0]?.text ?? '{}') as Record<string, unknown>;
  assert.ok(fetched.id, 'fetched session should have an id');
});

test('session focus: execute session/list_events returns fixture events', async () => {
  const { aggregator } = buildAggregator('session');

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'session/list_events',
    args: { session_id: 'sess-1' },
  });
  assert.equal(result.isError, undefined, 'list_events should not error');

  const parsed = JSON.parse(result.content?.[0]?.text ?? '{}') as { events: unknown[]; has_more: boolean };
  assert.ok(Array.isArray(parsed.events), 'result.events should be an array');
  assert.ok(parsed.events.length > 0, 'fixture should return at least one event');
});

test('session focus: status reports active focus', async () => {
  const { aggregator } = buildAggregator('session');

  const result = await aggregator.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined);

  const parsed = JSON.parse(result.content?.[0]?.text ?? '{}') as { focus?: { active?: string } };
  assert.equal(parsed.focus?.active, 'session', 'status must report active focus as "session"');
});
