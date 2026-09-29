/**
 * Workstream S: freeze tasks-mcp tool response required key presence and value types.
 *
 * Tests that each tasks-mcp tool response includes all required keys with the
 * correct value types. Optional fields (description, priority, assignee, project,
 * due_date, tags) are not asserted here — only required presence and types are frozen.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createTaskServer } from '../src/server.ts';
import type { TasksClient, Task, CreateTaskInput, UpdateTaskInput, ListTasksFilter } from '../src/tasks-client.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TASK_FIXTURE: Task = {
  id: 'task-s-001',
  title: 'Freeze shape test task',
  status: 'open',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const TASK_DONE_FIXTURE: Task = {
  ...TASK_FIXTURE,
  id: 'task-s-002',
  status: 'done',
};

// ── Mock client ───────────────────────────────────────────────────────────────

function makeMockClient(overrides: Partial<TasksClient> = {}): TasksClient {
  return {
    listTasks: async (_filter?: ListTasksFilter) => [TASK_FIXTURE],
    getTask: async (_id: string) => TASK_FIXTURE,
    createTask: async (input: CreateTaskInput) => ({ ...TASK_FIXTURE, id: 'task-s-new', title: input.title }),
    updateTask: async (_id: string, input: UpdateTaskInput) => {
      const defined = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
      return { ...TASK_FIXTURE, ...defined, updated_at: '2026-06-01T00:00:00Z' };
    },
    deleteTask: async (_id: string) => undefined,
    ...overrides,
  } as unknown as TasksClient;
}

// ── Harness ───────────────────────────────────────────────────────────────────

async function setup(overrides?: Partial<TasksClient>): Promise<{ client: Client; cleanup: () => Promise<void> }> {
  const server = createTaskServer(makeMockClient(overrides));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: 'test-s-freeze', version: '1.0.0' }, { capabilities: {} });
  await server.connect(serverTransport);
  await mcpClient.connect(clientTransport);
  return { client: mcpClient, cleanup: async () => { await mcpClient.close(); } };
}

function parseText<T>(result: Awaited<ReturnType<Client['callTool']>>): T {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text) as T;
}

// ── S-1: list_tasks — Task item required keys ─────────────────────────────────

test('S-1: list_tasks Task item has required keys {id, title, status, created_at, updated_at}', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'list_tasks', arguments: {} });
    assert.ok(!result.isError, 'expected success');
    const tasks = parseText<Task[]>(result);
    assert.ok(Array.isArray(tasks) && tasks.length > 0, 'non-empty array');
    const task = tasks[0];
    for (const k of ['id', 'title', 'status', 'created_at', 'updated_at']) {
      assert.ok(Object.prototype.hasOwnProperty.call(task, k), `Task missing required key: ${k}`);
    }
  } finally {
    await cleanup();
  }
});

// ── S-2: list_tasks — Task field value types ──────────────────────────────────

test('S-2: list_tasks Task field value types: id, title, status, created_at, updated_at all strings', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'list_tasks', arguments: {} });
    assert.ok(!result.isError, 'expected success');
    const tasks = parseText<Task[]>(result);
    const task = tasks[0];
    for (const k of ['id', 'title', 'status', 'created_at', 'updated_at']) {
      assert.equal(typeof (task as Record<string, unknown>)[k], 'string', `${k} must be string`);
    }
  } finally {
    await cleanup();
  }
});

// ── S-3: get_task — required keys and value types ─────────────────────────────

test('S-3: get_task returns Task with required keys {id, title, status, created_at, updated_at} all strings', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'get_task', arguments: { id: 'task-s-001' } });
    assert.ok(!result.isError, 'expected success');
    const task = parseText<Task>(result);
    for (const k of ['id', 'title', 'status', 'created_at', 'updated_at']) {
      assert.ok(Object.prototype.hasOwnProperty.call(task, k), `Task missing required key: ${k}`);
      assert.equal(typeof (task as Record<string, unknown>)[k], 'string', `${k} must be string`);
    }
  } finally {
    await cleanup();
  }
});

// ── S-4: create_task — returns Task with required keys ────────────────────────

test('S-4: create_task returns Task with required keys {id, title, status, created_at, updated_at}', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'create_task', arguments: { title: 'New S task' } });
    assert.ok(!result.isError, 'expected success');
    const task = parseText<Task>(result);
    for (const k of ['id', 'title', 'status', 'created_at', 'updated_at']) {
      assert.ok(Object.prototype.hasOwnProperty.call(task, k), `created Task missing required key: ${k}`);
      assert.equal(typeof (task as Record<string, unknown>)[k], 'string', `${k} must be string`);
    }
  } finally {
    await cleanup();
  }
});

// ── S-5: update_task — returns Task with required keys ────────────────────────

test('S-5: update_task returns Task with required keys {id, title, status, created_at, updated_at}', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'update_task', arguments: { id: 'task-s-001', title: 'Updated' } });
    assert.ok(!result.isError, 'expected success');
    const task = parseText<Task>(result);
    for (const k of ['id', 'title', 'status', 'created_at', 'updated_at']) {
      assert.ok(Object.prototype.hasOwnProperty.call(task, k), `updated Task missing required key: ${k}`);
      assert.equal(typeof (task as Record<string, unknown>)[k], 'string', `${k} must be string`);
    }
  } finally {
    await cleanup();
  }
});

// ── S-6: complete_task — returns Task with status 'done' ─────────────────────

test('S-6: complete_task returns Task with status="done"', async () => {
  const { client, cleanup } = await setup({
    updateTask: async (_id, _input) => TASK_DONE_FIXTURE,
  });
  try {
    const result = await client.callTool({ name: 'complete_task', arguments: { id: 'task-s-002' } });
    assert.ok(!result.isError, 'expected success');
    const task = parseText<Task>(result);
    assert.equal(task.status, 'done', 'complete_task must return status="done"');
    assert.ok(Object.prototype.hasOwnProperty.call(task, 'id'), 'Task missing required key: id');
  } finally {
    await cleanup();
  }
});

// ── S-7: delete_task — returns {deleted, id} ─────────────────────────────────

test('S-7: delete_task returns {deleted: true, id: string}', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'delete_task', arguments: { id: 'task-s-001' } });
    assert.ok(!result.isError, 'expected success');
    const res = parseText<{ deleted: boolean; id: string }>(result);
    assert.equal(res.deleted, true, 'deleted must be true');
    assert.equal(typeof res.id, 'string', 'id must be string');
    assert.equal(res.id, 'task-s-001', 'id must echo the requested id');
  } finally {
    await cleanup();
  }
});
