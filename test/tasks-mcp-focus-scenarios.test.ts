/**
 * Workstream F — tasks-mcp focused server scenarios.
 *
 * Validates the tasks focus profile:
 *  - tasks/ tools are boosted in search ranking (lens, not gate)
 *  - cast resolves task-management intents to tasks/ tools
 *  - out-of-focus tools remain reachable when tasks focus is active
 *  - multi-step task workflows execute correctly via the fixture backend
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

const TASKS_FOCUS_PROFILES = {
  profiles: {
    tasks: {
      description: 'Task management — create, update, list, and complete ChittyAgent Tasks',
      categories: ['ecosystem' as const],
      servers: ['tasks'],
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
  { id: 'tasks', name: 'ChittyAgent Tasks', type: 'local', access: 'readwrite', category: 'ecosystem', command: 'node', args: ['./apps/tasks-mcp/dist/index.js'] },
  { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.neon' },
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'read', category: 'ecosystem', endpoint: 'https://fixture.stripe' },
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
    focusProfiles: TASKS_FOCUS_PROFILES,
    focus,
    embedEnabled: false,
    backendFactory: (config) => {
      fixture.registerServer(config);
      return fixture;
    },
  });
  return { aggregator, fixture };
}

test('tasks focus: search "list tasks" ranks tasks/ tools first', async () => {
  const { aggregator } = buildAggregator('tasks');

  const result = await aggregator.callTool('ch1tty/search', { query: 'list tasks', limit: 10 });
  assert.equal(result.isError, undefined, 'search should not error');

  const parsed = parseSearch(result);
  const tools = parsed.tools ?? [];
  assert.ok(tools.length > 0, 'should return results');

  const taskIdx = tools.findIndex((r) => r.tool.startsWith('tasks/'));
  const otherIdx = tools.findIndex((r) => !r.tool.startsWith('tasks/'));

  assert.ok(taskIdx !== -1, 'tasks/ tools should appear in results');
  if (otherIdx !== -1) {
    assert.ok(taskIdx < otherIdx, 'tasks/ tools should rank above out-of-focus tools for task query');
  }
  assert.equal(parsed.focus, 'tasks', 'search response should report active focus');
});

test('tasks focus: search "create task" includes tasks/create_task', async () => {
  const { aggregator } = buildAggregator('tasks');

  const result = await aggregator.callTool('ch1tty/search', { query: 'create task', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t === 'tasks/create_task'), 'tasks/create_task must appear in results');
});

test('tasks focus: out-of-focus tools (neon) remain reachable via search', async () => {
  const { aggregator } = buildAggregator('tasks');

  const result = await aggregator.callTool('ch1tty/search', { query: 'database', limit: 20 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('neon/')), 'neon/ tools must remain reachable with tasks focus active');
});

test('tasks focus: no focus — tasks tools still accessible (lens not gate)', async () => {
  const { aggregator } = buildAggregator(); // no focus

  const result = await aggregator.callTool('ch1tty/search', { query: 'list tasks', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('tasks/')), 'tasks/ tools must be reachable without any focus');
});

test('tasks focus: execute list_tasks returns fixture task list', async () => {
  const { aggregator, fixture } = buildAggregator('tasks');
  fixture.clearCallLog();

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'tasks/list_tasks',
    args: { status: 'open' },
  });
  assert.equal(result.isError, undefined, 'execute should succeed');

  const tasks = JSON.parse(result.content[0].text as string) as Array<{ id: string; status: string }>;
  assert.ok(Array.isArray(tasks), 'should return an array of tasks');
  assert.ok(tasks.length > 0, 'fixture should return at least one task');

  const calls = fixture.getCallLog();
  assert.ok(calls.some((c) => c.serverId === 'tasks' && c.tool === 'list_tasks'), 'tasks/list_tasks must be in call log');
});

test('tasks focus: multi-step — list open tasks then create a follow-up', async () => {
  const { aggregator, fixture } = buildAggregator('tasks');
  const sessionId = 'tasks-scenario-001';
  fixture.clearCallLog();

  // Step 1: list open tasks
  const listResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'tasks/list_tasks',
    args: { status: 'open' },
  }, sessionId);
  assert.equal(listResult.isError, undefined, 'list_tasks should succeed');
  const tasks = JSON.parse(listResult.content[0].text as string) as Array<{ id: string; title: string }>;
  assert.ok(tasks.length > 0, 'should return open tasks');

  // Step 2: create a follow-up task
  const createResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'tasks/create_task',
    args: { entity_id: 'ch1tty', title: `Follow up on: ${tasks[0]!.title}` },
  }, sessionId);
  assert.equal(createResult.isError, undefined, 'create_task should succeed');
  const created = JSON.parse(createResult.content[0].text as string) as { id: string; status: string };
  assert.equal(created.status, 'open', 'created task should be open');

  // Both calls should appear in the log
  const calls = fixture.getCallLog();
  const toolNames = calls.map((c) => `${c.serverId}/${c.tool}`);
  assert.ok(toolNames.includes('tasks/list_tasks'), 'list_tasks must be in call log');
  assert.ok(toolNames.includes('tasks/create_task'), 'create_task must be in call log');
});

test('tasks focus: update task status via execute', async () => {
  const { aggregator } = buildAggregator('tasks');

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'tasks/update_task',
    args: { task_id: 'task-1', status: 'done' },
  });
  assert.equal(result.isError, undefined, 'update_task should succeed');

  const updated = JSON.parse(result.content[0].text as string) as { id: string; status: string };
  assert.equal(updated.status, 'done', 'updated task status should be done');
});

test('tasks focus: status reports active focus as tasks', async () => {
  const { aggregator } = buildAggregator('tasks');

  const result = await aggregator.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined);

  const status = JSON.parse(result.content[0].text as string) as { focus?: { active?: string } };
  assert.equal(status.focus?.active, 'tasks', 'status must report tasks as active focus');
});

test('tasks focus: cast "list my open tasks" with confirm resolves to tasks/list_tasks', async () => {
  const { aggregator } = buildAggregator('tasks');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'list my open tasks',
    confirm: true,
  });
  assert.equal(result.isError, undefined, 'cast should not error');

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string; score: number } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.ok(resolved.tool.startsWith('tasks/'), `cast should resolve to tasks/, got: ${resolved.tool}`);
  assert.equal(cast.focus, 'tasks', 'cast response should report active focus');
});

test('tasks focus: cast "create a task for review" resolves to tasks/create_task', async () => {
  const { aggregator } = buildAggregator('tasks');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'create a task for review',
    confirm: true,
  });
  assert.equal(result.isError, undefined);

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string; score: number } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.equal(
    resolved.tool,
    'tasks/create_task',
    `should resolve to tasks/create_task, got: ${resolved.tool}`,
  );
});
