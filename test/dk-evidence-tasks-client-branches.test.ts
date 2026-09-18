/**
 * Workstream DK: branch coverage for the two HTTP client classes that had
 * zero test coverage:
 *
 *   apps/evidence-mcp/src/evidence-client.ts  — EvidenceClient
 *   apps/tasks-mcp/src/tasks-client.ts        — TasksClient
 *
 * Covered branch paths:
 *
 *  EvidenceClient
 *   - request() !res.ok → throws with status + text
 *   - request() ok → returns parsed JSON
 *   - headers() with token → Authorization header present
 *   - headers() without token → no Authorization header
 *   - listDocuments() with all filters → full query string
 *   - listDocuments() with no filter → no query string
 *   - searchDocuments() with kind + limit
 *   - searchDocuments() without kind/limit
 *   - constructor trailing-slash normalisation
 *
 *  TasksClient
 *   - request() !res.ok → throws
 *   - request() 204 No Content → returns undefined
 *   - request() ok with body → JSON parsed
 *   - headers() with / without token
 *   - listTasks() with full filter
 *   - listTasks() with no filter
 *   - deleteTask() → exercises 204 branch via real method
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { EvidenceClient } from '../apps/evidence-mcp/src/evidence-client.js';
import { TasksClient } from '../apps/tasks-mcp/src/tasks-client.js';

// ── Fetch-stub helpers ────────────────────────────────────────────────────────

type FetchFn = typeof globalThis.fetch;

function stubFetch(fn: (input: string | URL | Request, init?: RequestInit) => Promise<Response>): FetchFn {
  return fn as unknown as FetchFn;
}

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResp(text: string, status: number): Response {
  return new Response(text, { status });
}

// ── EvidenceClient ────────────────────────────────────────────────────────────

test('EvidenceClient — request() !res.ok throws with status and body text', async () => {
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = stubFetch(async () => textResp('not found detail', 404));
    const c = new EvidenceClient('https://ev.test', 'tok');
    await assert.rejects(
      () => c.getDocument('missing-id'),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('404'), `expected 404 in: ${err.message}`);
        assert.ok(err.message.includes('not found detail'), `expected body in: ${err.message}`);
        return true;
      },
    );
  } finally {
    globalThis.fetch = orig;
  }
});

test('EvidenceClient — request() ok returns parsed JSON', async () => {
  const doc = { id: 'abc', canonical_uri: 'chittycanon://d/abc', kind: 'note', content: 'hello', created_at: '2026-01-01' };
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = stubFetch(async () => jsonResp(doc));
    const c = new EvidenceClient('https://ev.test', 'tok');
    const result = await c.getDocument('abc');
    assert.deepEqual(result, doc);
  } finally {
    globalThis.fetch = orig;
  }
});

test('EvidenceClient — headers() with token includes Authorization', async () => {
  let capturedHeaders: Record<string, string> | undefined;
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = stubFetch(async (url, init) => {
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return jsonResp({ id: 'x', canonical_uri: 'c', kind: 'k', created_at: '2026-01-01' });
    });
    const c = new EvidenceClient('https://ev.test', 'mytoken');
    await c.getDocument('x');
    assert.equal(capturedHeaders!['Authorization'], 'Bearer mytoken');
  } finally {
    globalThis.fetch = orig;
  }
});

test('EvidenceClient — headers() without token has no Authorization', async () => {
  let capturedHeaders: Record<string, string> | undefined;
  const orig = globalThis.fetch;
  // Unset env var for this test to avoid accidental token pickup
  const origEnv = process.env['CHITTY_EVIDENCE_TOKEN'];
  delete process.env['CHITTY_EVIDENCE_TOKEN'];
  try {
    globalThis.fetch = stubFetch(async (url, init) => {
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return jsonResp({ id: 'x', canonical_uri: 'c', kind: 'k', created_at: '2026-01-01' });
    });
    // No token argument and env var removed
    const c = new EvidenceClient('https://ev.test');
    await c.getDocument('x');
    assert.equal(capturedHeaders!['Authorization'], undefined);
  } finally {
    globalThis.fetch = orig;
    if (origEnv !== undefined) process.env['CHITTY_EVIDENCE_TOKEN'] = origEnv;
  }
});

test('EvidenceClient — listDocuments() with all filters constructs full query string', async () => {
  let capturedUrl: string | undefined;
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = stubFetch(async (url) => {
      capturedUrl = url.toString();
      return jsonResp({ documents: [], has_more: false });
    });
    const c = new EvidenceClient('https://ev.test', 't');
    await c.listDocuments({ kind: 'note', tag: 'urgent', since: '2026-01-01', cursor: 'cur1', limit: 10 });
    assert.ok(capturedUrl?.includes('kind=note'), capturedUrl);
    assert.ok(capturedUrl?.includes('tag=urgent'), capturedUrl);
    assert.ok(capturedUrl?.includes('since=2026-01-01'), capturedUrl);
    assert.ok(capturedUrl?.includes('cursor=cur1'), capturedUrl);
    assert.ok(capturedUrl?.includes('limit=10'), capturedUrl);
  } finally {
    globalThis.fetch = orig;
  }
});

test('EvidenceClient — listDocuments() with no filter → no query string', async () => {
  let capturedUrl: string | undefined;
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = stubFetch(async (url) => {
      capturedUrl = url.toString();
      return jsonResp({ documents: [], has_more: false });
    });
    const c = new EvidenceClient('https://ev.test', 't');
    await c.listDocuments();
    assert.ok(!capturedUrl?.includes('?'), `unexpected query string: ${capturedUrl}`);
  } finally {
    globalThis.fetch = orig;
  }
});

test('EvidenceClient — searchDocuments() with kind and limit adds both params', async () => {
  let capturedUrl: string | undefined;
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = stubFetch(async (url) => {
      capturedUrl = url.toString();
      return jsonResp({ documents: [], total: 0 });
    });
    const c = new EvidenceClient('https://ev.test', 't');
    await c.searchDocuments('query text', 'report', 5);
    assert.ok(capturedUrl?.includes('q=query+text') || capturedUrl?.includes('q=query%20text'), capturedUrl);
    assert.ok(capturedUrl?.includes('kind=report'), capturedUrl);
    assert.ok(capturedUrl?.includes('limit=5'), capturedUrl);
  } finally {
    globalThis.fetch = orig;
  }
});

test('EvidenceClient — searchDocuments() without kind/limit omits those params', async () => {
  let capturedUrl: string | undefined;
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = stubFetch(async (url) => {
      capturedUrl = url.toString();
      return jsonResp({ documents: [], total: 0 });
    });
    const c = new EvidenceClient('https://ev.test', 't');
    await c.searchDocuments('hello');
    assert.ok(!capturedUrl?.includes('kind='), capturedUrl);
    assert.ok(!capturedUrl?.includes('limit='), capturedUrl);
  } finally {
    globalThis.fetch = orig;
  }
});

test('EvidenceClient — constructor strips trailing slash from baseUrl', async () => {
  let capturedUrl: string | undefined;
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = stubFetch(async (url) => {
      capturedUrl = url.toString();
      return jsonResp({ id: 'x', canonical_uri: 'c', kind: 'k', created_at: '2026-01-01' });
    });
    const c = new EvidenceClient('https://ev.test/', 't');
    await c.getDocument('x');
    // Should not have double slash: ev.test//api/...
    assert.ok(!capturedUrl?.includes('//api'), `double slash found: ${capturedUrl}`);
    assert.ok(capturedUrl?.startsWith('https://ev.test/'), capturedUrl);
  } finally {
    globalThis.fetch = orig;
  }
});

// ── TasksClient ───────────────────────────────────────────────────────────────

test('TasksClient — request() !res.ok throws with status', async () => {
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = stubFetch(async () => textResp('task not found', 404));
    const c = new TasksClient('https://tasks.test', 'tok');
    await assert.rejects(
      () => c.getTask('nonexistent'),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('404'), `expected 404 in: ${err.message}`);
        return true;
      },
    );
  } finally {
    globalThis.fetch = orig;
  }
});

test('TasksClient — deleteTask() 204 branch returns undefined', async () => {
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = stubFetch(async () => new Response(null, { status: 204 }));
    const c = new TasksClient('https://tasks.test', 'tok');
    const result = await c.deleteTask('t1');
    assert.equal(result, undefined);
  } finally {
    globalThis.fetch = orig;
  }
});

test('TasksClient — request() 200 with JSON body returns parsed result', async () => {
  const task = {
    id: 't1', title: 'Do thing', status: 'open' as const,
    created_at: '2026-01-01', updated_at: '2026-01-01',
  };
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = stubFetch(async () => jsonResp(task));
    const c = new TasksClient('https://tasks.test', 'tok');
    const result = await c.getTask('t1');
    assert.deepEqual(result, task);
  } finally {
    globalThis.fetch = orig;
  }
});

test('TasksClient — headers() with token includes Authorization', async () => {
  let capturedHeaders: Record<string, string> | undefined;
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = stubFetch(async (url, init) => {
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return jsonResp([]);
    });
    const c = new TasksClient('https://tasks.test', 'secret');
    await c.listTasks();
    assert.equal(capturedHeaders!['Authorization'], 'Bearer secret');
  } finally {
    globalThis.fetch = orig;
  }
});

test('TasksClient — headers() without token has no Authorization', async () => {
  let capturedHeaders: Record<string, string> | undefined;
  const orig = globalThis.fetch;
  const origEnv = process.env['CHITTY_TASKS_TOKEN'];
  delete process.env['CHITTY_TASKS_TOKEN'];
  try {
    globalThis.fetch = stubFetch(async (url, init) => {
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return jsonResp([]);
    });
    const c = new TasksClient('https://tasks.test');
    await c.listTasks();
    assert.equal(capturedHeaders!['Authorization'], undefined);
  } finally {
    globalThis.fetch = orig;
    if (origEnv !== undefined) process.env['CHITTY_TASKS_TOKEN'] = origEnv;
  }
});

test('TasksClient — listTasks() with all filters constructs full query string', async () => {
  let capturedUrl: string | undefined;
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = stubFetch(async (url) => {
      capturedUrl = url.toString();
      return jsonResp([]);
    });
    const c = new TasksClient('https://tasks.test', 't');
    await c.listTasks({ status: 'open', assignee: 'alice', project: 'proj1', limit: 20 });
    assert.ok(capturedUrl?.includes('status=open'), capturedUrl);
    assert.ok(capturedUrl?.includes('assignee=alice'), capturedUrl);
    assert.ok(capturedUrl?.includes('project=proj1'), capturedUrl);
    assert.ok(capturedUrl?.includes('limit=20'), capturedUrl);
  } finally {
    globalThis.fetch = orig;
  }
});

test('TasksClient — listTasks() with no filter → no query string', async () => {
  let capturedUrl: string | undefined;
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = stubFetch(async (url) => {
      capturedUrl = url.toString();
      return jsonResp([]);
    });
    const c = new TasksClient('https://tasks.test', 't');
    await c.listTasks();
    assert.ok(!capturedUrl?.includes('?'), `unexpected query string: ${capturedUrl}`);
  } finally {
    globalThis.fetch = orig;
  }
});

test('TasksClient — constructor strips trailing slash from baseUrl', async () => {
  let capturedUrl: string | undefined;
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = stubFetch(async (url) => {
      capturedUrl = url.toString();
      return jsonResp([]);
    });
    const c = new TasksClient('https://tasks.test/', 't');
    await c.listTasks();
    assert.ok(!capturedUrl?.includes('//api'), `double slash found: ${capturedUrl}`);
    assert.ok(capturedUrl?.startsWith('https://tasks.test/'), capturedUrl);
  } finally {
    globalThis.fetch = orig;
  }
});

test('TasksClient — createTask() sends POST with JSON body', async () => {
  let capturedMethod: string | undefined;
  let capturedBody: string | undefined;
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = stubFetch(async (url, init) => {
      capturedMethod = init?.method;
      capturedBody = init?.body as string;
      return jsonResp({ id: 'new1', title: 'New task', status: 'open', created_at: '2026-01-01', updated_at: '2026-01-01' });
    });
    const c = new TasksClient('https://tasks.test', 't');
    await c.createTask({ title: 'New task', priority: 'high' });
    assert.equal(capturedMethod, 'POST');
    const parsed = JSON.parse(capturedBody!);
    assert.equal(parsed.title, 'New task');
    assert.equal(parsed.priority, 'high');
  } finally {
    globalThis.fetch = orig;
  }
});
