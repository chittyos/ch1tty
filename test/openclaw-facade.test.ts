// Tests for the /openclaw/* REST facade (handleOpenClawRoute).
// Covers: CORS preflight, skill manifest, status endpoint, invoke routing and
// arg mapping, node-id session derivation, error paths (missing/unknown skill,
// unknown route), and a real fixture-backend path through ch1tty/execute.

import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';
import { FixtureBackend } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

interface Started {
  server: HttpMcpServer;
  aggregator: Aggregator;
  baseUrl: string;
  dlqPath: string;
}

let _seq = 0;
function makeDlqPath(): string {
  return join(tmpdir(), `ch1tty-openclaw-${process.pid}-${++_seq}.dlq.jsonl`);
}

async function startServer(configs: ServerConfig[] = [], fb?: FixtureBackend): Promise<Started> {
  const dlqPath = makeDlqPath();
  const aggregator = new Aggregator(configs, {
    ledgerDlqPath: dlqPath,
    embedEnabled: false,
    ...(fb ? { backendFactory: () => fb } : {}),
  });
  const server = new HttpMcpServer(aggregator, { port: 0, bindAddress: '127.0.0.1' });
  await server.start();
  return { server, aggregator, baseUrl: `http://127.0.0.1:${server.getPort()}`, dlqPath };
}

async function stop(s: Started): Promise<void> {
  await s.server.stop();
  await s.aggregator.shutdown();
  rmSync(s.dlqPath, { force: true });
}

async function postInvoke(
  baseUrl: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}/openclaw/invoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  });
}

test('OpenClaw: OPTIONS /openclaw → 204 with CORS headers', async () => {
  const s = await startServer();
  try {
    const res = await fetch(`${s.baseUrl}/openclaw`, { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    assert.ok(res.headers.get('access-control-allow-origin'), 'CORS Allow-Origin present');
    assert.ok(res.headers.get('access-control-allow-methods'), 'CORS Allow-Methods present');
  } finally {
    await stop(s);
  }
});

test('OpenClaw: GET /openclaw/skills.json → 200 manifest with 4 skills', async () => {
  const s = await startServer();
  try {
    const res = await fetch(`${s.baseUrl}/openclaw/skills.json`);
    assert.equal(res.status, 200);
    const body = await res.json() as { skills: Array<{ key: string; version: string }> };
    assert.ok(Array.isArray(body.skills), 'skills is an array');
    assert.equal(body.skills.length, 4);
    const keys = new Set(body.skills.map((sk) => sk.key));
    assert.ok(keys.has('ch1tty-search'), 'ch1tty-search in manifest');
    assert.ok(keys.has('ch1tty-execute'), 'ch1tty-execute in manifest');
    assert.ok(keys.has('ch1tty-status'), 'ch1tty-status in manifest');
    assert.ok(keys.has('ch1tty-session'), 'ch1tty-session in manifest');
  } finally {
    await stop(s);
  }
});

test('OpenClaw: GET /openclaw (root) → 200 same manifest as /skills.json', async () => {
  const s = await startServer();
  try {
    const res = await fetch(`${s.baseUrl}/openclaw`);
    assert.equal(res.status, 200);
    const body = await res.json() as { skills: unknown[] };
    assert.ok(Array.isArray(body.skills));
    assert.equal(body.skills.length, 4, 'root also returns 4-skill manifest');
  } finally {
    await stop(s);
  }
});

test('OpenClaw: GET /openclaw/status → 200 gateway snapshot with channel:openclaw', async () => {
  const s = await startServer();
  try {
    const res = await fetch(`${s.baseUrl}/openclaw/status`);
    assert.equal(res.status, 200);
    const body = await res.json() as { ok: boolean; gateway: { gateway: string; totalServers: number }; channel: string };
    assert.equal(body.ok, true);
    assert.ok(body.gateway, 'gateway field present');
    assert.equal(body.gateway.gateway, 'ch1tty');
    assert.equal(typeof body.gateway.totalServers, 'number');
    assert.equal(body.channel, 'openclaw');
  } finally {
    await stop(s);
  }
});

test('OpenClaw: POST /openclaw/invoke without skill field → 400', async () => {
  const s = await startServer();
  try {
    const res = await postInvoke(s.baseUrl, {});
    assert.equal(res.status, 400);
    const body = await res.json() as { ok: boolean; error: string };
    assert.equal(body.ok, false);
    assert.ok(body.error.toLowerCase().includes('missing'), `error should mention 'missing': ${body.error}`);
  } finally {
    await stop(s);
  }
});

test('OpenClaw: POST /openclaw/invoke with unknown skill → 404 + available list', async () => {
  const s = await startServer();
  try {
    const res = await postInvoke(s.baseUrl, { skill: 'nonexistent-skill' });
    assert.equal(res.status, 404);
    const body = await res.json() as { ok: boolean; error: string; available: string[] };
    assert.equal(body.ok, false);
    assert.ok(body.error.includes('nonexistent-skill'), `error should name the skill: ${body.error}`);
    assert.ok(Array.isArray(body.available), 'available list present');
    assert.ok(body.available.length >= 4, 'available lists at least the 4 real skills');
    assert.ok(body.available.includes('ch1tty-status'), 'ch1tty-status in available list');
  } finally {
    await stop(s);
  }
});

test('OpenClaw: POST /openclaw/invoke ch1tty-status → 200 with gateway result', async () => {
  const s = await startServer();
  try {
    const res = await postInvoke(s.baseUrl, { skill: 'ch1tty-status' });
    assert.equal(res.status, 200);
    const body = await res.json() as {
      ok: boolean;
      skill: string;
      result: { gateway: string; totalServers: number };
      node_id: string;
      timestamp: string;
    };
    assert.equal(body.ok, true);
    assert.equal(body.skill, 'ch1tty-status');
    assert.ok(body.result, 'result present');
    assert.equal(body.result.gateway, 'ch1tty');
    assert.equal(body.result.totalServers, 0, 'empty aggregator has 0 backends');
    assert.ok(typeof body.node_id === 'string', 'node_id present');
    assert.ok(typeof body.timestamp === 'string', 'timestamp present');
  } finally {
    await stop(s);
  }
});

test('OpenClaw: POST /openclaw/invoke ch1tty-search → 200 with tools array', async () => {
  const s = await startServer();
  try {
    const res = await postInvoke(s.baseUrl, { skill: 'ch1tty-search', args: { query: 'database' } });
    assert.equal(res.status, 200);
    const body = await res.json() as { ok: boolean; skill: string; result: { tools: unknown[] } };
    assert.equal(body.ok, true);
    assert.equal(body.skill, 'ch1tty-search');
    assert.ok(body.result, 'result present');
    assert.ok(Array.isArray(body.result.tools), 'result.tools is an array');
  } finally {
    await stop(s);
  }
});

test('OpenClaw: POST /openclaw/invoke ch1tty-session recall with fixture backend → 200', async () => {
  const fb = new FixtureBackend();
  fb.defineServer('chittyos', {
    tools: [{
      name: 'chitty_memory_recall',
      description: 'Recall session memory from ContextConsciousness',
      inputSchema: { type: 'object', properties: { query: { type: 'string' }, scope: { type: 'string' } } },
      response: {
        content: [{ type: 'text', text: JSON.stringify({ results: [{ key: 'ctx', content: 'session context data' }] }) }],
      },
    }],
  });
  const configs: ServerConfig[] = [
    { id: 'chittyos', name: 'ChittyOS', type: 'local', access: 'readwrite', category: 'ecosystem', command: 'noop', args: [] },
  ];
  const s = await startServer(configs, fb);
  try {
    const res = await postInvoke(s.baseUrl, {
      skill: 'ch1tty-session',
      args: { action: 'recall', query: 'recent context', scope: 'session' },
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { ok: boolean; skill: string; result: unknown };
    assert.equal(body.ok, true);
    assert.equal(body.skill, 'ch1tty-session');
    assert.ok(body.result !== null && body.result !== undefined, 'result present');
    // Verify the fixture backend was actually called
    const calls = fb.getCallLog();
    assert.ok(calls.length > 0, 'fixture backend was invoked');
    assert.equal(calls[0].serverId, 'chittyos');
    assert.equal(calls[0].tool, 'chitty_memory_recall');
  } finally {
    await stop(s);
  }
});

test('OpenClaw: X-OpenClaw-Node-Id header → node_id reflected in invoke response', async () => {
  const s = await startServer();
  try {
    const res = await postInvoke(
      s.baseUrl,
      { skill: 'ch1tty-status' },
      { 'X-OpenClaw-Node-Id': 'test-node-42' },
    );
    assert.equal(res.status, 200);
    const body = await res.json() as { ok: boolean; node_id: string };
    assert.equal(body.ok, true);
    assert.equal(body.node_id, 'test-node-42', 'node_id reflects X-OpenClaw-Node-Id header');
  } finally {
    await stop(s);
  }
});

test('OpenClaw: GET /openclaw/unknown-path → 404 with route details', async () => {
  const s = await startServer();
  try {
    const res = await fetch(`${s.baseUrl}/openclaw/unknown-path`);
    assert.equal(res.status, 404);
    const body = await res.json() as { ok: boolean; error: string; path: string };
    assert.equal(body.ok, false);
    assert.ok(body.error.includes('Unknown OpenClaw route'), `error: ${body.error}`);
    assert.equal(body.path, '/unknown-path');
  } finally {
    await stop(s);
  }
});
