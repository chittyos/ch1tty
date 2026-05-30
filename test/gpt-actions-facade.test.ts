/**
 * Tests for src/gpt-actions.ts — GPT Actions REST facade.
 *
 * Strategy: start a real HttpMcpServer on 127.0.0.1:0 (ephemeral port) with a
 * stock Aggregator (no backends). Each action route calls aggregator.callTool()
 * with a bare tool name (no serverId prefix), which returns a graceful isError
 * result — the facade wraps this in {ok:true} and returns HTTP 200. Tests verify
 * HTTP routing, CORS headers, envelope shape, argument mapping, and error paths.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';

interface Started {
  server: HttpMcpServer;
  aggregator: Aggregator;
  baseUrl: string;
  dlqPath: string;
}

let _pid = 0;
async function startServer(): Promise<Started> {
  const dlqPath = join(tmpdir(), `ch1tty-gpt-${process.pid}-${++_pid}.dlq.jsonl`);
  const aggregator = new Aggregator([], { ledgerDlqPath: dlqPath });
  const server = new HttpMcpServer(aggregator, { port: 0, bindAddress: '127.0.0.1' });
  await server.start();
  const baseUrl = `http://127.0.0.1:${server.getPort()}`;
  return { server, aggregator, baseUrl, dlqPath };
}

async function stop(s: Started): Promise<void> {
  await s.server.stop();
  await s.aggregator.shutdown();
  rmSync(s.dlqPath, { force: true });
}

interface Envelope {
  ok: boolean;
  result: unknown;
  chitty_id: string | null;
  timestamp: string;
}

// ── CORS preflight ────────────────────────────────────────────────────────────

test('OPTIONS /gpt-actions/session/get returns 204 + CORS headers', async () => {
  const s = await startServer();
  try {
    const res = await fetch(`${s.baseUrl}/gpt-actions/session/get`, { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    assert.ok(res.headers.get('access-control-allow-origin'), 'CORS origin header present');
    assert.ok(res.headers.get('access-control-allow-methods'), 'CORS methods header present');
  } finally {
    await stop(s);
  }
});

// ── OpenAPI spec ──────────────────────────────────────────────────────────────

test('GET /gpt-actions serves OpenAPI spec (root path)', async () => {
  const s = await startServer();
  try {
    const res = await fetch(`${s.baseUrl}/gpt-actions`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('text/yaml'), 'Content-Type is text/yaml');
    const body = await res.text();
    assert.ok(body.includes('openapi: 3.1.0'), 'body contains openapi version');
    assert.ok(body.includes('ChittyMCP GPT Actions'), 'body contains API title');
  } finally {
    await stop(s);
  }
});

test('GET /gpt-actions/openapi.yaml serves OpenAPI spec', async () => {
  const s = await startServer();
  try {
    const res = await fetch(`${s.baseUrl}/gpt-actions/openapi.yaml`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('text/yaml'), 'Content-Type is text/yaml');
    const body = await res.text();
    assert.ok(body.includes('/session/get'), 'spec contains /session/get path');
    assert.ok(body.includes('/tasks/list'), 'spec contains /tasks/list path');
    assert.ok(body.includes('/decision-log/append'), 'spec contains /decision-log/append path');
  } finally {
    await stop(s);
  }
});

// ── Action routes: envelope shape ─────────────────────────────────────────────

test('POST /gpt-actions/session/get returns 200 envelope with chitty_id from conversation_id', async () => {
  const s = await startServer();
  try {
    const res = await fetch(`${s.baseUrl}/gpt-actions/session/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: 'conv-abc', project_hint: 'ch1tty' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as Envelope;
    assert.equal(body.ok, true, 'ok is true');
    assert.equal(body.chitty_id, 'conv-abc', 'chitty_id reflects conversation_id');
    assert.ok(typeof body.timestamp === 'string' && body.timestamp.length > 0, 'timestamp is an ISO string');
    assert.ok(body.result !== undefined, 'result field present');
  } finally {
    await stop(s);
  }
});

test('POST /gpt-actions/session/get without conversation_id has chitty_id: null', async () => {
  const s = await startServer();
  try {
    const res = await fetch(`${s.baseUrl}/gpt-actions/session/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as Envelope;
    assert.equal(body.ok, true);
    assert.equal(body.chitty_id, null, 'chitty_id is null when conversation_id absent');
  } finally {
    await stop(s);
  }
});

test('POST /gpt-actions/session/save returns 200 ok:true', async () => {
  const s = await startServer();
  try {
    const res = await fetch(`${s.baseUrl}/gpt-actions/session/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: 'conv-1', summary: 'Test session context' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as Envelope;
    assert.equal(body.ok, true);
    assert.equal(body.chitty_id, 'conv-1');
  } finally {
    await stop(s);
  }
});

test('POST /gpt-actions/decision-log/append returns 200 ok:true', async () => {
  const s = await startServer();
  try {
    const res = await fetch(`${s.baseUrl}/gpt-actions/decision-log/append`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: 'conv-2',
        decision: 'Use neon for session storage',
        rationale: 'PostgreSQL fits our schema',
        project_id: 'proj-ch1tty',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as Envelope;
    assert.equal(body.ok, true);
    assert.equal(body.chitty_id, 'conv-2');
  } finally {
    await stop(s);
  }
});

test('POST /gpt-actions/projects/search returns 200 ok:true', async () => {
  const s = await startServer();
  try {
    const res = await fetch(`${s.baseUrl}/gpt-actions/projects/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'ch1tty gateway' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as Envelope;
    assert.equal(body.ok, true);
  } finally {
    await stop(s);
  }
});

test('POST /gpt-actions/tasks/list returns 200 ok:true', async () => {
  const s = await startServer();
  try {
    const res = await fetch(`${s.baseUrl}/gpt-actions/tasks/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: 'proj-ch1tty', status: 'all' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as Envelope;
    assert.equal(body.ok, true);
  } finally {
    await stop(s);
  }
});

test('POST /gpt-actions/state/reconcile returns 200 ok:true', async () => {
  const s = await startServer();
  try {
    const res = await fetch(`${s.baseUrl}/gpt-actions/state/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: 'conv-3', project_id: 'proj-ch1tty', current_summary: 'Building gateway' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as Envelope;
    assert.equal(body.ok, true);
    assert.equal(body.chitty_id, 'conv-3');
  } finally {
    await stop(s);
  }
});

// ── Error paths ───────────────────────────────────────────────────────────────

test('POST /gpt-actions/unknown returns 404 ok:false with path detail', async () => {
  const s = await startServer();
  try {
    const res = await fetch(`${s.baseUrl}/gpt-actions/unknown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 404);
    const body = await res.json() as Envelope & { result: { error: string; path: string } };
    assert.equal(body.ok, false, 'ok is false for unknown action');
    assert.equal(body.result.path, '/unknown', 'path in error reflects the stripped action path');
    assert.ok(body.result.error, 'error message present');
  } finally {
    await stop(s);
  }
});

test('GET /gpt-actions/session/get returns 404 (only POST accepted)', async () => {
  const s = await startServer();
  try {
    const res = await fetch(`${s.baseUrl}/gpt-actions/session/get`, { method: 'GET' });
    assert.equal(res.status, 404);
    const body = await res.json() as Envelope;
    assert.equal(body.ok, false, 'ok is false for non-POST method');
  } finally {
    await stop(s);
  }
});

// ── X-Conversation-Id session header ─────────────────────────────────────────

test('X-Conversation-Id header is used as session discriminator (session created)', async () => {
  const s = await startServer();
  try {
    const before = s.aggregator.sessions.count;
    await fetch(`${s.baseUrl}/gpt-actions/session/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Conversation-Id': 'sess-xyz' },
      body: JSON.stringify({ conversation_id: 'conv-xyz' }),
    });
    // getOrCreate should have created a session keyed 'gpt-actions-sess-xyz'
    assert.ok(s.aggregator.sessions.count > before, 'session was created for the request');
  } finally {
    await stop(s);
  }
});
