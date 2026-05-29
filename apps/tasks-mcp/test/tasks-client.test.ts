import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { TasksClient } from '../src/tasks-client.ts';

const FIXTURE_TASKS = [
  {
    id: 't1',
    title: 'Set up CI',
    status: 'open',
    priority: 'high',
    project: 'infra',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 't2',
    title: 'Review PR',
    status: 'in_progress',
    priority: 'medium',
    assignee: 'nick',
    created_at: '2026-01-02T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
  },
];

let fixtureServer: http.Server;
let baseUrl: string;
let lastAuthHeader: string | undefined;

before(async () => {
  fixtureServer = http.createServer((req, res) => {
    lastAuthHeader = req.headers['authorization'];
    const url = new URL(req.url!, 'http://localhost');
    res.setHeader('Content-Type', 'application/json');

    const readBody = (): Promise<string> =>
      new Promise((resolve) => {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => resolve(body));
      });

    (async () => {
      if (req.method === 'GET' && url.pathname === '/api/tasks') {
        const statusFilter = url.searchParams.get('status');
        const assigneeFilter = url.searchParams.get('assignee');
        const limitParam = url.searchParams.get('limit');
        let tasks = [...FIXTURE_TASKS];
        if (statusFilter) tasks = tasks.filter(t => t.status === statusFilter);
        if (assigneeFilter) tasks = tasks.filter(t => (t as Record<string, unknown>)['assignee'] === assigneeFilter);
        if (limitParam) tasks = tasks.slice(0, Number(limitParam));
        res.end(JSON.stringify(tasks));

      } else if (req.method === 'GET' && url.pathname.startsWith('/api/tasks/')) {
        const id = decodeURIComponent(url.pathname.split('/').pop()!);
        const task = FIXTURE_TASKS.find(t => t.id === id);
        if (task) {
          res.end(JSON.stringify(task));
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'not found' }));
        }

      } else if (req.method === 'POST' && url.pathname === '/api/tasks') {
        const body = await readBody();
        const input = JSON.parse(body) as Record<string, unknown>;
        const created = {
          id: 't_new',
          status: 'open',
          created_at: '2026-01-03T00:00:00Z',
          updated_at: '2026-01-03T00:00:00Z',
          ...input,
        };
        res.writeHead(201);
        res.end(JSON.stringify(created));

      } else if (req.method === 'PATCH' && url.pathname.startsWith('/api/tasks/')) {
        const id = decodeURIComponent(url.pathname.split('/').pop()!);
        const body = await readBody();
        const base = FIXTURE_TASKS.find(t => t.id === id) ?? { id, created_at: '2026-01-01T00:00:00Z' };
        const updated = { ...base, ...JSON.parse(body), updated_at: '2026-01-04T00:00:00Z' };
        res.end(JSON.stringify(updated));

      } else if (req.method === 'DELETE' && url.pathname.startsWith('/api/tasks/')) {
        res.writeHead(204);
        res.end();

      } else {
        res.writeHead(404);
        res.end('{}');
      }
    })().catch(() => { res.writeHead(500); res.end('{}'); });
  });

  await new Promise<void>(resolve => fixtureServer.listen(0, '127.0.0.1', resolve));
  const addr = fixtureServer.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    fixtureServer.close(err => (err ? reject(err) : resolve()))
  );
});

describe('TasksClient', () => {
  it('lists all tasks', async () => {
    const client = new TasksClient(baseUrl, 'test-token');
    const tasks = await client.listTasks();
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].id, 't1');
    assert.equal(tasks[1].id, 't2');
  });

  it('filters tasks by status', async () => {
    const client = new TasksClient(baseUrl, 'test-token');
    const tasks = await client.listTasks({ status: 'open' });
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].status, 'open');
    assert.equal(tasks[0].id, 't1');
  });

  it('filters tasks by assignee', async () => {
    const client = new TasksClient(baseUrl, 'test-token');
    const tasks = await client.listTasks({ assignee: 'nick' });
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].id, 't2');
  });

  it('respects limit filter', async () => {
    const client = new TasksClient(baseUrl, 'test-token');
    const tasks = await client.listTasks({ limit: 1 });
    assert.equal(tasks.length, 1);
  });

  it('gets a task by id', async () => {
    const client = new TasksClient(baseUrl, 'test-token');
    const task = await client.getTask('t1');
    assert.equal(task.id, 't1');
    assert.equal(task.title, 'Set up CI');
    assert.equal(task.priority, 'high');
  });

  it('rejects a missing task with a 404 error', async () => {
    const client = new TasksClient(baseUrl, 'test-token');
    await assert.rejects(() => client.getTask('nonexistent'), /404/);
  });

  it('creates a task with required fields', async () => {
    const client = new TasksClient(baseUrl, 'test-token');
    const task = await client.createTask({ title: 'Deploy release' });
    assert.equal(task.id, 't_new');
    assert.equal(task.title, 'Deploy release');
    assert.equal(task.status, 'open');
  });

  it('creates a task with all optional fields', async () => {
    const client = new TasksClient(baseUrl, 'test-token');
    const task = await client.createTask({
      title: 'Full task',
      description: 'desc',
      priority: 'high',
      assignee: 'alice',
      project: 'infra',
      due_date: '2026-06-01',
      tags: ['urgent'],
    });
    assert.equal(task.title, 'Full task');
    assert.equal(task.priority, 'high');
  });

  it('updates a task status', async () => {
    const client = new TasksClient(baseUrl, 'test-token');
    const task = await client.updateTask('t1', { status: 'done' });
    assert.equal(task.id, 't1');
    assert.equal(task.status, 'done');
  });

  it('updates a task priority', async () => {
    const client = new TasksClient(baseUrl, 'test-token');
    const task = await client.updateTask('t2', { priority: 'low' });
    assert.equal(task.priority, 'low');
  });

  it('deletes a task without error', async () => {
    const client = new TasksClient(baseUrl, 'test-token');
    await assert.doesNotReject(() => client.deleteTask('t1'));
  });

  it('sends Authorization header when token is provided', async () => {
    const client = new TasksClient(baseUrl, 'my-secret-token');
    await client.listTasks();
    assert.equal(lastAuthHeader, 'Bearer my-secret-token');
  });

  it('omits Authorization header when no token is set', async () => {
    const client = new TasksClient(baseUrl, undefined);
    // Clear env var to ensure no token leak
    const saved = process.env['CHITTY_TASKS_TOKEN'];
    delete process.env['CHITTY_TASKS_TOKEN'];
    const c2 = new TasksClient(baseUrl, undefined);
    await c2.listTasks();
    assert.equal(lastAuthHeader, undefined);
    if (saved !== undefined) process.env['CHITTY_TASKS_TOKEN'] = saved;
  });

  it('reads CHITTY_TASKS_URL from environment', () => {
    process.env['CHITTY_TASKS_URL'] = baseUrl;
    const client = new TasksClient();
    assert.equal((client as unknown as { baseUrl: string }).baseUrl, baseUrl);
    delete process.env['CHITTY_TASKS_URL'];
  });

  it('reads CHITTY_TASKS_TOKEN from environment', async () => {
    process.env['CHITTY_TASKS_TOKEN'] = 'env-token';
    const client = new TasksClient(baseUrl);
    await client.listTasks();
    assert.equal(lastAuthHeader, 'Bearer env-token');
    delete process.env['CHITTY_TASKS_TOKEN'];
  });
});
