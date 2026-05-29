import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';

interface Started {
  server: HttpMcpServer;
  aggregator: Aggregator;
  baseUrl: string;
}

async function startServer(token?: string): Promise<Started> {
  const aggregator = new Aggregator([]);
  const server = new HttpMcpServer(aggregator, { port: 0, bindAddress: '127.0.0.1', mcpToken: token });
  await server.start();
  const baseUrl = `http://127.0.0.1:${server.getPort()}`;
  return { server, aggregator, baseUrl };
}

async function stop(s: Started): Promise<void> {
  await s.server.stop();
  await s.aggregator.shutdown();
}

test('GET /health returns 200 without auth', async () => {
  const s = await startServer('secret');
  try {
    const res = await fetch(`${s.baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json() as { status: string; service: string };
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'ch1tty');
  } finally {
    await stop(s);
  }
});

test('GET /api/v1/status returns 200 without auth and real snapshot', async () => {
  const s = await startServer('secret');
  try {
    const res = await fetch(`${s.baseUrl}/api/v1/status`);
    assert.equal(res.status, 200);
    const body = await res.json() as {
      gateway: string;
      totalServers: number;
      servers: unknown[];
      brainHealth: { status: string; embeddingCircuitOpen: boolean; ollamaCircuitOpen: boolean };
      ledgerHealth: { status: string; dropped: number; buffered: number; flushErrors: number; dlqEntries: number; dlqPath: string };
    };
    assert.equal(body.gateway, 'ch1tty');
    assert.equal(body.totalServers, 0);
    assert.ok(Array.isArray(body.servers));
    assert.ok(body.brainHealth, 'brainHealth present in /api/v1/status');
    assert.ok(body.brainHealth.status === 'ok' || body.brainHealth.status === 'degraded');
    assert.equal(typeof body.brainHealth.embeddingCircuitOpen, 'boolean');
    assert.equal(typeof body.brainHealth.ollamaCircuitOpen, 'boolean');
    assert.ok(body.ledgerHealth, 'ledgerHealth present in /api/v1/status');
    assert.ok(
      body.ledgerHealth.status === 'ok' || body.ledgerHealth.status === 'warn' || body.ledgerHealth.status === 'degraded',
    );
    assert.equal(typeof body.ledgerHealth.dropped, 'number');
    assert.equal(typeof body.ledgerHealth.dlqEntries, 'number');
    assert.equal(typeof body.ledgerHealth.dlqPath, 'string');
  } finally {
    await stop(s);
  }
});

test('GET /api/v1/sessions returns 401 when token required and absent', async () => {
  const s = await startServer('secret');
  try {
    const res = await fetch(`${s.baseUrl}/api/v1/sessions`);
    assert.equal(res.status, 401);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'unauthorized');
  } finally {
    await stop(s);
  }
});

test('GET /api/v1/sessions returns 401 with wrong bearer token', async () => {
  const s = await startServer('secret');
  try {
    const res = await fetch(`${s.baseUrl}/api/v1/sessions`, {
      headers: { authorization: 'Bearer wrongtoken' },
    });
    assert.equal(res.status, 401);
  } finally {
    await stop(s);
  }
});

test('GET /api/v1/sessions returns 200 with correct bearer token', async () => {
  const s = await startServer('secret');
  try {
    const res = await fetch(`${s.baseUrl}/api/v1/sessions`, {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { sessions: unknown[] };
    assert.ok(Array.isArray(body.sessions));
  } finally {
    await stop(s);
  }
});

test('GET /api/v1/sessions returns 200 when no token is configured', async () => {
  const s = await startServer();
  try {
    const res = await fetch(`${s.baseUrl}/api/v1/sessions`);
    assert.equal(res.status, 200);
    const body = await res.json() as { sessions: unknown[] };
    assert.ok(Array.isArray(body.sessions));
  } finally {
    await stop(s);
  }
});

test('POST /mcp returns 401 when token required and absent', async () => {
  const s = await startServer('secret');
  try {
    const res = await fetch(`${s.baseUrl}/mcp`, { method: 'POST' });
    assert.equal(res.status, 401);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'unauthorized');
  } finally {
    await stop(s);
  }
});

test('unknown route returns 404', async () => {
  const s = await startServer();
  try {
    const res = await fetch(`${s.baseUrl}/unknown/path`);
    assert.equal(res.status, 404);
  } finally {
    await stop(s);
  }
});

test('bearer scheme check is case-insensitive', async () => {
  const s = await startServer('tok');
  try {
    const res = await fetch(`${s.baseUrl}/api/v1/sessions`, {
      headers: { authorization: 'BEARER tok' },
    });
    assert.equal(res.status, 200);
  } finally {
    await stop(s);
  }
});

test('malformed Authorization header (no space) yields 401', async () => {
  const s = await startServer('tok');
  try {
    const res = await fetch(`${s.baseUrl}/api/v1/sessions`, {
      headers: { authorization: 'Bearertok' },
    });
    assert.equal(res.status, 401);
  } finally {
    await stop(s);
  }
});

test('wrong scheme (Basic) yields 401', async () => {
  const s = await startServer('tok');
  try {
    const res = await fetch(`${s.baseUrl}/api/v1/sessions`, {
      headers: { authorization: 'Basic dG9rOnRvaw==' },
    });
    assert.equal(res.status, 401);
  } finally {
    await stop(s);
  }
});

test('task REST routes are gone (guardrail enforcement)', async () => {
  const s = await startServer();
  try {
    const resA = await fetch(`${s.baseUrl}/api/v1/tasks`);
    assert.equal(resA.status, 404, 'GET /api/v1/tasks must be 404');
    const resB = await fetch(`${s.baseUrl}/api/v1/tasks`, { method: 'POST', body: '{}' });
    assert.equal(resB.status, 404, 'POST /api/v1/tasks must be 404');
    const resC = await fetch(`${s.baseUrl}/api/v1/tasks/t_1`);
    assert.equal(resC.status, 404, 'GET /api/v1/tasks/:id must be 404');
  } finally {
    await stop(s);
  }
});
