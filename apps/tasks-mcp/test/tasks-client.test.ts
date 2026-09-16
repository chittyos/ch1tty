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
let lastRequestUrl: URL | undefined;

before(async () => {
  fixtureServer = http.createServer((req, res) => {
    lastAuthHeader = req.headers['authorization'];
    const url = new URL(req.url!, 'http://localhost');
    lastRequestUrl = url;
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
        const projectFilter = url.searchParams.get('project');
        const limitParam = url.searchParams.get('limit');
        let tasks = [...FIXTURE_TASKS];
        if (statusFilter) tasks = tasks.filter(t => t.status === statusFilter);
        if (assigneeFilter) tasks = tasks.filter(t => (t as Record<string, unknown>)['assignee'] === assigneeFilter);
        if (projectFilter) tasks = tasks.filter(t => (t as Record<string, unknown>)['project'] === projectFilter);
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

  it('uses https://tasks.chitty.cc default when no baseUrl or env var', () => {
    const saved = process.env['CHITTY_TASKS_URL'];
    delete process.env['CHITTY_TASKS_URL'];
    const client = new TasksClient(undefined, undefined);
    assert.equal((client as unknown as { baseUrl: string }).baseUrl, 'https://tasks.chitty.cc');
    if (saved !== undefined) process.env['CHITTY_TASKS_URL'] = saved;
  });

  it('strips trailing slash from baseUrl', () => {
    const client = new TasksClient('http://host.local/', undefined);
    assert.equal((client as unknown as { baseUrl: string }).baseUrl, 'http://host.local');
  });

  it('filters tasks by project', async () => {
    const client = new TasksClient(baseUrl, 'test-token');
    const tasks = await client.listTasks({ project: 'infra' });
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].id, 't1');
    assert.equal(lastRequestUrl?.searchParams.get('project'), 'infra');
  });

  it('listTasks: no filters → GET /api/tasks with no query string', async () => {
    const client = new TasksClient(baseUrl, 'test-token');
    await client.listTasks();
    assert.equal(lastRequestUrl?.pathname, '/api/tasks');
    assert.equal(lastRequestUrl?.search, '');
  });

  it('getTask: URL-encodes IDs with special characters', async () => {
    let capturedPath = '';
    const server = http.createServer((req, res) => {
      capturedPath = req.url!;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ...FIXTURE_TASKS[0], id: 'id/with/slash' }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    const client = new TasksClient(`http://127.0.0.1:${addr.port}`, 'tok');
    try {
      await client.getTask('id/with/slash');
      assert.equal(capturedPath, '/api/tasks/id%2Fwith%2Fslash');
    } finally {
      await new Promise<void>((res, rej) => server.close(e => (e ? rej(e) : res())));
    }
  });

  it('updateTask: URL-encodes IDs with special characters', async () => {
    let capturedPath = '';
    const server = http.createServer((req, res) => {
      capturedPath = req.url!.split('?')[0];
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(FIXTURE_TASKS[0]));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    const client = new TasksClient(`http://127.0.0.1:${addr.port}`, 'tok');
    try {
      await client.updateTask('id with space', { status: 'done' });
      assert.equal(capturedPath, '/api/tasks/id%20with%20space');
    } finally {
      await new Promise<void>((res, rej) => server.close(e => (e ? rej(e) : res())));
    }
  });

  it('deleteTask: URL-encodes IDs with special characters', async () => {
    let capturedPath = '';
    const server = http.createServer((req, res) => {
      capturedPath = req.url!;
      res.writeHead(204);
      res.end();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    const client = new TasksClient(`http://127.0.0.1:${addr.port}`, 'tok');
    try {
      await client.deleteTask('id#hash');
      assert.equal(capturedPath, '/api/tasks/id%23hash');
    } finally {
      await new Promise<void>((res, rej) => server.close(e => (e ? rej(e) : res())));
    }
  });

  it('deleteTask: returns undefined for 204 No Content', async () => {
    const server = http.createServer((_req, res) => { res.writeHead(204); res.end(); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    const client = new TasksClient(`http://127.0.0.1:${addr.port}`, 'tok');
    try {
      const result = await client.deleteTask('any-id');
      assert.equal(result as unknown, undefined);
    } finally {
      await new Promise<void>((res, rej) => server.close(e => (e ? rej(e) : res())));
    }
  });

  it('getTask: non-ok response (500) throws with status code in message', async () => {
    const server = http.createServer((_req, res) => { res.writeHead(500); res.end('internal server error'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    const client = new TasksClient(`http://127.0.0.1:${addr.port}`, 'tok');
    try {
      await assert.rejects(() => client.getTask('t1'), /500/);
    } finally {
      await new Promise<void>((res, rej) => server.close(e => (e ? rej(e) : res())));
    }
  });

  it('createTask: non-ok response (422) throws with status code in message', async () => {
    const server = http.createServer((_req, res) => { res.writeHead(422); res.end('{"error":"validation failed"}'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    const client = new TasksClient(`http://127.0.0.1:${addr.port}`, 'tok');
    try {
      await assert.rejects(() => client.createTask({ title: 'Bad task' }), /422/);
    } finally {
      await new Promise<void>((res, rej) => server.close(e => (e ? rej(e) : res())));
    }
  });

  it('updateTask: sends PATCH method', async () => {
    let capturedMethod = '';
    const server = http.createServer((req, res) => {
      capturedMethod = req.method!;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(FIXTURE_TASKS[0]));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    const client = new TasksClient(`http://127.0.0.1:${addr.port}`, 'tok');
    try {
      await client.updateTask('t1', { status: 'done' });
      assert.equal(capturedMethod, 'PATCH');
    } finally {
      await new Promise<void>((res, rej) => server.close(e => (e ? rej(e) : res())));
    }
  });

  it('deleteTask: sends DELETE method to /api/tasks/:id', async () => {
    let capturedMethod = '';
    let capturedPath = '';
    const server = http.createServer((req, res) => {
      capturedMethod = req.method!;
      capturedPath = req.url!;
      res.writeHead(204);
      res.end();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    const client = new TasksClient(`http://127.0.0.1:${addr.port}`, 'tok');
    try {
      await client.deleteTask('t99');
      assert.equal(capturedMethod, 'DELETE');
      assert.equal(capturedPath, '/api/tasks/t99');
    } finally {
      await new Promise<void>((res, rej) => server.close(e => (e ? rej(e) : res())));
    }
  });

  it('createTask: sends POST to /api/tasks', async () => {
    let capturedMethod = '';
    let capturedPath = '';
    const server = http.createServer((req, res) => {
      capturedMethod = req.method!;
      capturedPath = req.url!;
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(201);
      res.end(JSON.stringify({ ...FIXTURE_TASKS[0], id: 't_new' }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    const client = new TasksClient(`http://127.0.0.1:${addr.port}`, 'tok');
    try {
      await client.createTask({ title: 'New task' });
      assert.equal(capturedMethod, 'POST');
      assert.equal(capturedPath, '/api/tasks');
    } finally {
      await new Promise<void>((res, rej) => server.close(e => (e ? rej(e) : res())));
    }
  });
});
