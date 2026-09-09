/**
 * MCP tool layer tests for tasks-mcp (Workstream L).
 *
 * Tests the `createTaskServer` factory against a mock TasksClient, using
 * InMemoryTransport to wire a real MCP Client/Server pair in-process — no
 * spawned processes, no network. Covers all 6 tools, error handling, and the
 * complete_task / delete_task shortcuts.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createTaskServer } from '../src/server.ts';
import type { TasksClient, Task, CreateTaskInput, UpdateTaskInput, ListTasksFilter } from '../src/tasks-client.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TASK_1: Task = {
  id: 't1',
  title: 'Set up CI',
  status: 'open',
  priority: 'high',
  project: 'infra',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const TASK_2: Task = {
  id: 't2',
  title: 'Review PR',
  status: 'in_progress',
  priority: 'medium',
  assignee: 'nick',
  created_at: '2026-01-02T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
};

// ── Mock TasksClient ──────────────────────────────────────────────────────────

interface MockOverrides {
  listTasks?: (filter?: ListTasksFilter) => Promise<Task[]>;
  getTask?: (id: string) => Promise<Task>;
  createTask?: (input: CreateTaskInput) => Promise<Task>;
  updateTask?: (id: string, input: UpdateTaskInput) => Promise<Task>;
  deleteTask?: (id: string) => Promise<void>;
}

/** Build a TasksClient stub. Each method defaults to a fixture response unless overridden. */
function makeMockClient(overrides: MockOverrides = {}): TasksClient {
  return {
    listTasks: overrides.listTasks ?? (async () => [TASK_1, TASK_2]),
    getTask: overrides.getTask ?? (async () => TASK_1),
    createTask: overrides.createTask ?? (async (input) => ({ ...TASK_1, id: 't_new', title: input.title })),
    updateTask: overrides.updateTask ?? (async (id, input) => ({ ...TASK_1, id, ...input })),
    deleteTask: overrides.deleteTask ?? (async () => undefined),
  } as unknown as TasksClient;
}

// ── Test harness ──────────────────────────────────────────────────────────────

/** Wire a real MCP Client+Server pair in-process via InMemoryTransport for a single test. */
async function setup(overrides?: MockOverrides): Promise<{ client: Client; cleanup: () => Promise<void> }> {
  const mockClient = makeMockClient(overrides);
  const server = createTaskServer(mockClient);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const mcpClient = new Client(
    { name: 'test-client', version: '1.0.0' },
    { capabilities: {} },
  );

  await server.connect(serverTransport);
  await mcpClient.connect(clientTransport);

  return {
    client: mcpClient,
    cleanup: async () => {
      await mcpClient.close();
    },
  };
}

// ── Tool listing ──────────────────────────────────────────────────────────────

test('list_tools returns exactly 6 tools', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.listTools();
    assert.equal(result.tools.length, 6);
    const names = result.tools.map(t => t.name);
    assert.deepEqual(names.sort(), [
      'complete_task', 'create_task', 'delete_task', 'get_task', 'list_tasks', 'update_task',
    ]);
  } finally {
    await cleanup();
  }
});

test('list_tools: create_task has required=[title]', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.listTools();
    const createTool = result.tools.find(t => t.name === 'create_task');
    assert.ok(createTool, 'create_task tool missing');
    const schema = createTool.inputSchema as { required?: string[] };
    assert.deepEqual(schema.required, ['title']);
  } finally {
    await cleanup();
  }
});

test('list_tools: get_task has required=[id]', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.listTools();
    const tool = result.tools.find(t => t.name === 'get_task');
    assert.ok(tool);
    const schema = tool.inputSchema as { required?: string[] };
    assert.deepEqual(schema.required, ['id']);
  } finally {
    await cleanup();
  }
});

// ── list_tasks ────────────────────────────────────────────────────────────────

test('list_tasks: returns all tasks as JSON', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'list_tasks', arguments: {} });
    assert.ok(!result.isError);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.equal(content.length, 1);
    const tasks = JSON.parse(content[0].text) as Task[];
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].id, 't1');
    assert.equal(tasks[1].id, 't2');
  } finally {
    await cleanup();
  }
});

test('list_tasks: passes status filter to client', async () => {
  let capturedFilter: ListTasksFilter | undefined;
  const { client, cleanup } = await setup({
    listTasks: async (filter) => { capturedFilter = filter; return [TASK_1]; },
  });
  try {
    await client.callTool({ name: 'list_tasks', arguments: { status: 'open' } });
    assert.equal(capturedFilter?.status, 'open');
  } finally {
    await cleanup();
  }
});

test('list_tasks: passes assignee and limit filters', async () => {
  let capturedFilter: ListTasksFilter | undefined;
  const { client, cleanup } = await setup({
    listTasks: async (filter) => { capturedFilter = filter; return []; },
  });
  try {
    await client.callTool({ name: 'list_tasks', arguments: { assignee: 'alice', limit: 5 } });
    assert.equal(capturedFilter?.assignee, 'alice');
    assert.equal(capturedFilter?.limit, 5);
  } finally {
    await cleanup();
  }
});

// ── get_task ──────────────────────────────────────────────────────────────────

test('get_task: returns task as JSON', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'get_task', arguments: { id: 't1' } });
    assert.ok(!result.isError);
    const content = result.content as Array<{ type: string; text: string }>;
    const task = JSON.parse(content[0].text) as Task;
    assert.equal(task.id, 't1');
    assert.equal(task.title, 'Set up CI');
  } finally {
    await cleanup();
  }
});

test('get_task: passes id to client', async () => {
  let capturedId = '';
  const { client, cleanup } = await setup({
    getTask: async (id) => { capturedId = id; return TASK_1; },
  });
  try {
    await client.callTool({ name: 'get_task', arguments: { id: 'my-id-123' } });
    assert.equal(capturedId, 'my-id-123');
  } finally {
    await cleanup();
  }
});

// ── create_task ───────────────────────────────────────────────────────────────

test('create_task: passes title and optional fields to client', async () => {
  let capturedInput: CreateTaskInput | undefined;
  const { client, cleanup } = await setup({
    createTask: async (input) => { capturedInput = input; return { ...TASK_1, id: 't_new', title: input.title }; },
  });
  try {
    await client.callTool({
      name: 'create_task',
      arguments: { title: 'Ship it', priority: 'high', assignee: 'alice', tags: ['release'] },
    });
    assert.equal(capturedInput?.title, 'Ship it');
    assert.equal(capturedInput?.priority, 'high');
    assert.equal(capturedInput?.assignee, 'alice');
    assert.deepEqual(capturedInput?.tags, ['release']);
  } finally {
    await cleanup();
  }
});

test('create_task: returns new task as JSON', async () => {
  const { client, cleanup } = await setup({
    createTask: async (input) => ({ ...TASK_1, id: 't_new', title: input.title }),
  });
  try {
    const result = await client.callTool({ name: 'create_task', arguments: { title: 'New task' } });
    assert.ok(!result.isError);
    const content = result.content as Array<{ type: string; text: string }>;
    const task = JSON.parse(content[0].text) as Task;
    assert.equal(task.id, 't_new');
    assert.equal(task.title, 'New task');
  } finally {
    await cleanup();
  }
});

// ── update_task ───────────────────────────────────────────────────────────────

test('update_task: passes id and patch fields to client', async () => {
  let capturedId = '';
  let capturedInput: UpdateTaskInput | undefined;
  const { client, cleanup } = await setup({
    updateTask: async (id, input) => { capturedId = id; capturedInput = input; return { ...TASK_1, id, ...input }; },
  });
  try {
    await client.callTool({
      name: 'update_task',
      arguments: { id: 't2', status: 'done', priority: 'low' },
    });
    assert.equal(capturedId, 't2');
    assert.equal(capturedInput?.status, 'done');
    assert.equal(capturedInput?.priority, 'low');
  } finally {
    await cleanup();
  }
});

// ── complete_task ─────────────────────────────────────────────────────────────

test('complete_task: calls updateTask with status=done', async () => {
  let capturedId = '';
  let capturedInput: UpdateTaskInput | undefined;
  const { client, cleanup } = await setup({
    updateTask: async (id, input) => { capturedId = id; capturedInput = input; return { ...TASK_1, id, status: 'done' }; },
  });
  try {
    const result = await client.callTool({ name: 'complete_task', arguments: { id: 't1' } });
    assert.ok(!result.isError);
    assert.equal(capturedId, 't1');
    assert.equal(capturedInput?.status, 'done');
  } finally {
    await cleanup();
  }
});

test('complete_task: returns updated task as JSON', async () => {
  const { client, cleanup } = await setup({
    updateTask: async (id) => ({ ...TASK_1, id, status: 'done' }),
  });
  try {
    const result = await client.callTool({ name: 'complete_task', arguments: { id: 't1' } });
    const content = result.content as Array<{ type: string; text: string }>;
    const task = JSON.parse(content[0].text) as Task;
    assert.equal(task.status, 'done');
  } finally {
    await cleanup();
  }
});

// ── delete_task ───────────────────────────────────────────────────────────────

test('delete_task: calls deleteTask with id', async () => {
  let capturedId = '';
  const { client, cleanup } = await setup({
    deleteTask: async (id) => { capturedId = id; },
  });
  try {
    await client.callTool({ name: 'delete_task', arguments: { id: 't2' } });
    assert.equal(capturedId, 't2');
  } finally {
    await cleanup();
  }
});

test('delete_task: returns { deleted: true, id }', async () => {
  const { client, cleanup } = await setup({ deleteTask: async () => undefined });
  try {
    const result = await client.callTool({ name: 'delete_task', arguments: { id: 'x99' } });
    assert.ok(!result.isError);
    const content = result.content as Array<{ type: string; text: string }>;
    const body = JSON.parse(content[0].text) as { deleted: boolean; id: string };
    assert.equal(body.deleted, true);
    assert.equal(body.id, 'x99');
  } finally {
    await cleanup();
  }
});

// ── Error handling ────────────────────────────────────────────────────────────

test('unknown tool: returns isError=true with message', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'nonexistent_tool', arguments: {} });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('Unknown tool'));
  } finally {
    await cleanup();
  }
});

test('client error: propagates as isError=true text response', async () => {
  const { client, cleanup } = await setup({
    getTask: async () => { throw new Error('tasks API GET /api/tasks/bad → 404: not found'); },
  });
  try {
    const result = await client.callTool({ name: 'get_task', arguments: { id: 'bad' } });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('404'));
  } finally {
    await cleanup();
  }
});

test('client error: non-Error thrown still captured as string', async () => {
  const { client, cleanup } = await setup({
    listTasks: async () => { throw 'string error'; },
  });
  try {
    const result = await client.callTool({ name: 'list_tasks', arguments: {} });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('string error'));
  } finally {
    await cleanup();
  }
});

test('create_task error: surfaces in isError response', async () => {
  const { client, cleanup } = await setup({
    createTask: async () => { throw new Error('tasks API POST /api/tasks → 422: validation failed'); },
  });
  try {
    const result = await client.callTool({ name: 'create_task', arguments: { title: 'Bad' } });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('422'));
  } finally {
    await cleanup();
  }
});
