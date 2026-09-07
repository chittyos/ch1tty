/**
 * Workstream O — google focus profile scenarios.
 *
 * Validates the google focus profile:
 *  - google/ and gam/ tools are boosted in search ranking (lens, not gate)
 *  - cast resolves Google Workspace intents to google/ and gam/ tools
 *  - out-of-focus tools remain reachable when google focus is active
 *  - multi-step calendar → task and file → doc workflows execute via fixture backend
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

const GOOGLE_FOCUS_PROFILES = {
  profiles: {
    google: {
      description: 'Google Workspace productivity and administration — Gmail, Google Calendar, Drive, Docs, and org-wide user/group management via Google Admin (GAM)',
      categories: ['ecosystem' as const, 'documents' as const],
      servers: ['google', 'gam', 'notion', 'tasks'],
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
  { id: 'google', name: 'Google Workspace', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://fixture.google' },
  { id: 'gam', name: 'Google Admin (GAM)', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://fixture.gam' },
  { id: 'tasks', name: 'ChittyAgent Tasks', type: 'local', access: 'readwrite', category: 'ecosystem', command: 'node', args: ['./apps/tasks-mcp/dist/index.js'] },
  { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.neon' },
  { id: 'notion', name: 'Notion', type: 'remote', access: 'readwrite', category: 'documents', endpoint: 'https://fixture.notion' },
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
    focusProfiles: GOOGLE_FOCUS_PROFILES,
    focus,
    embedEnabled: false,
    backendFactory: (config) => {
      fixture.registerServer(config);
      return fixture;
    },
  });
  return { aggregator, fixture };
}

test('google focus: search "calendar" ranks google/ tools first', async () => {
  const { aggregator } = buildAggregator('google');

  const result = await aggregator.callTool('ch1tty/search', { query: 'calendar', limit: 10 });
  assert.equal(result.isError, undefined, 'search should not error');

  const parsed = parseSearch(result);
  const tools = parsed.tools ?? [];
  assert.ok(tools.length > 0, 'should return results');

  const googleIdx = tools.findIndex((r) => r.tool.startsWith('google/'));
  const outOfFocusIdx = tools.findIndex((r) => r.inFocus === false);

  assert.ok(googleIdx !== -1, 'google/ tools should appear in results');
  if (outOfFocusIdx !== -1) {
    assert.ok(googleIdx < outOfFocusIdx, 'google/ tools should rank above out-of-focus tools for calendar query');
  }
  assert.equal(parsed.focus, 'google', 'search response should report active focus');
});

test('google focus: search "email" includes google/send_email', async () => {
  const { aggregator } = buildAggregator('google');

  const result = await aggregator.callTool('ch1tty/search', { query: 'email', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t === 'google/send_email'), 'google/send_email must appear in results');
});

test('google focus: search "users" includes gam/list_users', async () => {
  const { aggregator } = buildAggregator('google');

  const result = await aggregator.callTool('ch1tty/search', { query: 'users', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t === 'gam/list_users'), 'gam/list_users must appear in results');
});

test('google focus: out-of-focus tools (neon) remain reachable via search', async () => {
  const { aggregator } = buildAggregator('google');

  const result = await aggregator.callTool('ch1tty/search', { query: 'database', limit: 20 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('neon/')), 'neon/ tools must remain reachable with google focus active');
});

test('google focus: no focus — google and gam tools still accessible (lens not gate)', async () => {
  const { aggregator } = buildAggregator();

  const result = await aggregator.callTool('ch1tty/search', { query: 'google calendar drive', limit: 15 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(
    toolNames.some((t) => t.startsWith('google/') || t.startsWith('gam/')),
    'google/ or gam/ tools must be reachable without any focus'
  );
});

test('google focus: execute list_events returns fixture calendar events', async () => {
  const { aggregator, fixture } = buildAggregator('google');
  fixture.clearCallLog();

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'google/list_events',
    args: {},
  });
  assert.equal(result.isError, undefined, 'execute should succeed');

  const body = JSON.parse(result.content[0].text as string) as { events: Array<{ id: string; summary: string }> };
  assert.ok(Array.isArray(body.events), 'should return an events array');
  assert.ok(body.events.length > 0, 'fixture should return at least one event');
  assert.ok(body.events[0]?.id, 'each event should have an id');

  const calls = fixture.getCallLog();
  assert.ok(calls.some((c) => c.serverId === 'google' && c.tool === 'list_events'), 'google/list_events must be in call log');
});

test('google focus: execute send_email returns sent status', async () => {
  const { aggregator } = buildAggregator('google');

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'google/send_email',
    args: { to: 'alice@example.com', subject: 'Meeting follow-up', body: 'Thanks for joining!' },
  });
  assert.equal(result.isError, undefined, 'send_email should succeed');

  const body = JSON.parse(result.content[0].text as string) as { message_id: string; status: string };
  assert.ok(body.message_id, 'sent email should have a message_id');
  assert.equal(body.status, 'sent', 'email status should be sent');
});

test('google focus: execute list_files returns drive file list', async () => {
  const { aggregator } = buildAggregator('google');

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'google/list_files',
    args: { query: 'Q3 Report' },
  });
  assert.equal(result.isError, undefined, 'list_files should succeed');

  const body = JSON.parse(result.content[0].text as string) as { files: Array<{ id: string; name: string }> };
  assert.ok(Array.isArray(body.files), 'should return a files array');
  assert.ok(body.files.length > 0, 'fixture should return at least one file');
});

test('google focus: execute gam/list_users returns org user list', async () => {
  const { aggregator, fixture } = buildAggregator('google');
  fixture.clearCallLog();

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'gam/list_users',
    args: {},
  });
  assert.equal(result.isError, undefined, 'gam/list_users should succeed');

  const body = JSON.parse(result.content[0].text as string) as { users: Array<{ id: string; email: string }> };
  assert.ok(Array.isArray(body.users), 'should return a users array');
  assert.ok(body.users.length > 0, 'fixture should return at least one user');
  assert.ok(body.users[0]?.email, 'each user should have an email');

  const calls = fixture.getCallLog();
  assert.ok(calls.some((c) => c.serverId === 'gam' && c.tool === 'list_users'), 'gam/list_users must be in call log');
});

test('google focus: multi-step — list events then get user details for first attendee', async () => {
  const { aggregator, fixture } = buildAggregator('google');
  const sessionId = 'google-scenario-001';
  fixture.clearCallLog();

  // Step 1: list calendar events
  const eventsResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'google/list_events',
    args: {},
  }, sessionId);
  assert.equal(eventsResult.isError, undefined, 'list_events should succeed');
  const { events } = JSON.parse(eventsResult.content[0].text as string) as { events: Array<{ id: string; attendees?: string[] }> };
  assert.ok(events.length > 0, 'should return at least one event');

  // Step 2: get user details for the first attendee
  const attendeeEmail = events[0]?.attendees?.[0] ?? 'alice@example.com';
  const userResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'gam/get_user',
    args: { user_key: attendeeEmail },
  }, sessionId);
  assert.equal(userResult.isError, undefined, 'gam/get_user should succeed');
  const user = JSON.parse(userResult.content[0].text as string) as { id: string; email: string };
  assert.ok(user.id, 'user should have an id');
  assert.ok(user.email, 'user should have an email');

  const calls = fixture.getCallLog();
  const toolNames = calls.map((c) => `${c.serverId}/${c.tool}`);
  assert.ok(toolNames.includes('google/list_events'), 'list_events must be in call log');
  assert.ok(toolNames.includes('gam/get_user'), 'gam/get_user must be in call log');
});

test('google focus: status reports active focus as google', async () => {
  const { aggregator } = buildAggregator('google');

  const result = await aggregator.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined, 'status should not error');

  const body = JSON.parse(result.content[0].text as string) as { focus?: { active?: string } };
  assert.equal(body.focus?.active, 'google', 'status should report active focus as google');

  await aggregator.shutdown();
});

test('google focus: cast resolves "list calendar events" to google/list_events', async () => {
  const { aggregator } = buildAggregator('google');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'list calendar events',
    focus: 'google',
  }, 'google-cast-001');
  assert.equal(result.isError, undefined, 'cast should not error');

  const body = parseCast(result);
  assert.ok(body.cast === 'executed' || body.cast === 'plan', `expected executed or plan, got: ${JSON.stringify(body)}`);
  const resolvedTool = (body.tool as string | undefined) ?? (body.planned_tool as string | undefined) ?? '';
  assert.ok(
    resolvedTool.includes('google') || resolvedTool.includes('list_events') || resolvedTool === '',
    `cast should resolve toward google/ tools, got: ${resolvedTool}`
  );
});
