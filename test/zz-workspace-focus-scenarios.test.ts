/**
 * Workstream Z — workspace focus profile scenarios.
 *
 * Validates the workspace focus profile with notion, google, comms, and tasks as wired backends:
 *  - workspace tools are boosted in search ranking (lens, not gate)
 *  - cast resolves workspace intents to the right backend tools
 *  - out-of-focus tools remain reachable when workspace focus is active
 *  - multi-step workspace workflows execute via fixture backends
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

const WORKSPACE_FOCUS_PROFILES = {
  profiles: {
    workspace: {
      description: 'Personal and team workspace productivity — notes, docs, calendar, messaging, and tasks across Notion, Google Workspace, and ChittyComms',
      categories: ['documents' as const, 'communication' as const],
      servers: ['notion', 'google', 'comms', 'tasks', 'context7', 'notes'],
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
  { id: 'notion', name: 'Notion', type: 'remote', access: 'readwrite', category: 'documents', endpoint: 'https://fixture.notion' },
  { id: 'google', name: 'Google Workspace', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://fixture.google' },
  { id: 'comms', name: 'ChittyComms', type: 'remote', access: 'readwrite', category: 'communication', endpoint: 'https://fixture.comms' },
  { id: 'tasks', name: 'ChittyAgent Tasks', type: 'local', access: 'readwrite', category: 'ecosystem', command: 'node', args: ['./apps/tasks-mcp/dist/index.js'] },
  { id: 'context7', name: 'Library Docs', type: 'remote', access: 'read', category: 'documents', endpoint: 'https://fixture.context7' },
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
    focusProfiles: WORKSPACE_FOCUS_PROFILES,
    focus,
    embedEnabled: false,
    backendFactory: (config) => {
      fixture.registerServer(config);
      return fixture;
    },
  });
  return { aggregator, fixture };
}

test('workspace focus: search "search notion workspace documents" ranks notion tools first', async () => {
  const { aggregator } = buildAggregator('workspace');

  const result = await aggregator.callTool('ch1tty/search', { query: 'search notion workspace documents', limit: 10 });
  assert.equal(result.isError, undefined, 'search should not error');

  const parsed = parseSearch(result);
  const tools = parsed.tools ?? [];
  assert.ok(tools.length > 0, 'should return results');

  const notionIdx = tools.findIndex((r) => r.tool.startsWith('notion/'));
  const firstNonWorkspace = tools.findIndex(
    (r) => !r.tool.startsWith('notion/') && !r.tool.startsWith('google/') && !r.tool.startsWith('comms/') && !r.tool.startsWith('context7/'),
  );
  if (notionIdx >= 0 && firstNonWorkspace >= 0) {
    assert.ok(notionIdx < firstNonWorkspace, `notion/ tool (idx ${notionIdx}) should rank before out-of-focus tools (idx ${firstNonWorkspace})`);
  }
});

test('workspace focus: search "send message" boosts comms and google tools', async () => {
  const { aggregator } = buildAggregator('workspace');

  const result = await aggregator.callTool('ch1tty/search', { query: 'send message email', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const tools = parsed.tools ?? [];
  const workspaceTools = tools.filter(
    (r) => r.tool.startsWith('comms/') || r.tool.startsWith('google/') || r.tool.startsWith('notion/'),
  );
  assert.ok(workspaceTools.length > 0, 'should return workspace communication tools');
  const workspaceIdx = tools.indexOf(workspaceTools[0]);
  assert.ok(workspaceIdx < 5, `first workspace comms tool should be in top 5, got idx ${workspaceIdx}`);
});

test('workspace focus: out-of-focus tools remain reachable', async () => {
  const { aggregator } = buildAggregator('workspace');

  const result = await aggregator.callTool('ch1tty/search', { query: 'neon database', limit: 15 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const neonTool = (parsed.tools ?? []).find((r) => r.tool.startsWith('neon/'));
  assert.ok(neonTool, 'neon/ tools must remain reachable even when workspace focus is active (lens, not gate)');
});

test('workspace focus: cast "search Notion workspace for Q3 planning" resolves to notion/search', async () => {
  const { aggregator } = buildAggregator('workspace');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'search Notion workspace for Q3 planning documents',
    confirm: true,
  });
  assert.equal(result.isError, undefined, 'cast should not error');

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string; score: number } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.ok(
    resolved.tool === 'notion/search',
    `cast should resolve to notion/search, got: ${resolved.tool}`,
  );
  assert.equal(cast.focus, 'workspace', 'cast response should report active focus');
});

test('workspace focus: cast "list upcoming calendar events" resolves to google/list_events', async () => {
  const { aggregator } = buildAggregator('workspace');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'list my upcoming Google Calendar events',
    confirm: true,
  });
  assert.equal(result.isError, undefined);

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan');
  const resolved = cast.resolved as { tool: string } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.ok(
    resolved.tool === 'google/list_events',
    `should resolve to google/list_events, got: ${resolved.tool}`,
  );
});

test('workspace focus: cast "recent communications from Nick" resolves to comms tool', async () => {
  const { aggregator } = buildAggregator('workspace');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'show recent communications from Nick',
    confirm: true,
  });
  assert.equal(result.isError, undefined);

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan');
  const resolved = cast.resolved as { tool: string } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.ok(
    resolved.tool.startsWith('comms/'),
    `should resolve to a comms/ tool, got: ${resolved.tool}`,
  );
});

test('workspace focus: status reports active focus as workspace', async () => {
  const { aggregator } = buildAggregator('workspace');

  const result = await aggregator.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined);

  const status = JSON.parse(result.content[0].text as string) as { focus?: { active?: string } };
  assert.equal(status.focus?.active, 'workspace', 'status must report workspace as active focus');
});

test('workspace focus: search without focus returns unbiased results', async () => {
  const { aggregator } = buildAggregator();

  const result = await aggregator.callTool('ch1tty/search', { query: 'find documents', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  assert.equal(parsed.focus, undefined, 'no focus should be active');
  assert.ok((parsed.tools ?? []).length > 0, 'should still return results without focus');
});

test('workspace focus: execute notion/search returns fixture results', async () => {
  const { aggregator } = buildAggregator('workspace');

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'notion/search',
    args: { query: 'Q3 planning' },
  });
  assert.equal(result.isError, undefined, 'notion/search should succeed');

  const data = JSON.parse(result.content[0].text as string) as { results?: unknown[] };
  assert.ok(Array.isArray(data.results) && data.results.length > 0, 'should return results');
});

test('workspace focus: execute google/list_events returns fixture events', async () => {
  const { aggregator } = buildAggregator('workspace');

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'google/list_events',
    args: { max_results: 5 },
  });
  assert.equal(result.isError, undefined, 'google/list_events should succeed');

  const data = JSON.parse(result.content[0].text as string) as { events?: unknown[] };
  assert.ok(Array.isArray(data.events) && data.events.length > 0, 'should return calendar events');
});

test('workspace focus: multi-step — pull calendar then create Notion meeting-notes page', async () => {
  const { aggregator, fixture } = buildAggregator('workspace');
  const sessionId = 'workspace-scenario-001';
  fixture.clearCallLog();

  // Step 1: fetch calendar events
  const calResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'google/list_events',
    args: { max_results: 2 },
  }, sessionId);
  assert.equal(calResult.isError, undefined, 'list_events should succeed');
  const cal = JSON.parse(calResult.content[0].text as string) as { events: Array<{ summary: string }> };
  assert.ok(cal.events.length > 0, 'fixture should return events');

  // Step 2: create meeting-notes page in Notion for the first event
  const pageResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'notion/create_page',
    args: {
      title: `Meeting Notes — ${cal.events[0].summary}`,
      parent_id: 'meetings-db',
    },
  }, sessionId);
  assert.equal(pageResult.isError, undefined, 'notion/create_page should succeed');
  const page = JSON.parse(pageResult.content[0].text as string) as { id: string };
  assert.ok(page.id, 'should return a page id');

  const calls = fixture.getCallLog();
  const keys = calls.map((c) => `${c.serverId}/${c.tool}`);
  assert.ok(keys.includes('google/list_events'), 'google/list_events must be in call log');
  assert.ok(keys.includes('notion/create_page'), 'notion/create_page must be in call log');
});

test('workspace focus: multi-step — read comms log then create follow-up task', async () => {
  const { aggregator, fixture } = buildAggregator('workspace');
  const sessionId = 'workspace-scenario-002';
  fixture.clearCallLog();

  // Step 1: get recent comms from Nick
  const commsResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'comms/comms.recentLog',
    args: { person: 'Nick', days: 7 },
  }, sessionId);
  assert.equal(commsResult.isError, undefined, 'comms.recentLog should succeed');
  const comms = JSON.parse(commsResult.content[0].text as string) as { ok: boolean; entries: unknown[] };
  assert.equal(comms.ok, true, 'comms result should be ok');
  assert.ok(comms.entries.length > 0, 'should return entries');

  // Step 2: create a follow-up task
  const taskResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'tasks/create_task',
    args: { entity_id: 'ch1tty', title: 'Follow up with Nick on Q3 planning thread' },
  }, sessionId);
  assert.equal(taskResult.isError, undefined, 'create_task should succeed');
  const task = JSON.parse(taskResult.content[0].text as string) as { id: string; status: string };
  assert.equal(task.status, 'open', 'new task should be open');

  const calls = fixture.getCallLog();
  const keys = calls.map((c) => `${c.serverId}/${c.tool}`);
  assert.ok(keys.includes('comms/comms.recentLog'), 'comms.recentLog must be in call log');
  assert.ok(keys.includes('tasks/create_task'), 'create_task must be in call log');
});

test('workspace focus: cast with focus:none disables boost', async () => {
  const { aggregator } = buildAggregator('workspace');

  const result = await aggregator.callTool('ch1tty/search', { query: 'database schema', limit: 10, focus: 'none' });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  assert.equal(parsed.focus, undefined, 'focus:none should clear active focus');
});
