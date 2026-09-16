/**
 * HTTP transport tests for ledger-mcp (Workstream T).
 *
 * Spins up a real HTTP server bound to a random port (0) for each fixture, makes
 * real fetch() requests, and checks the responses. Covers /health, bearer-auth
 * guard on /mcp, and 404 for unknown paths. MCP session creation is covered by
 * the happy-path POST /mcp test.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createLedgerMcpHttpApp } from '../src/http-server.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function startApp(token?: string): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  const app = createLedgerMcpHttpApp({ mcpToken: token });
  const server: Server = createServer((req, res) => { void app.handleRequest(req, res); });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    stop: () => new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    ),
  };
}

// ── /health ───────────────────────────────────────────────────────────────────

test('GET /health returns 200 with JSON body', async () => {
  const { baseUrl, stop } = await startApp();
  try {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json() as { status: string; service: string };
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'ledger-mcp');
  } finally {
    await stop();
  }
});

test('GET /health does not require bearer token', async () => {
  const { baseUrl, stop } = await startApp('secret-token');
  try {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
  } finally {
    await stop();
  }
});

test('GET /health Content-Type is application/json', async () => {
  const { baseUrl, stop } = await startApp();
  try {
    const res = await fetch(`${baseUrl}/health`);
    assert.ok(res.headers.get('content-type')?.includes('application/json'));
  } finally {
    await stop();
  }
});

// ── 404 for unknown paths ─────────────────────────────────────────────────────

test('GET /unknown returns 404', async () => {
  const { baseUrl, stop } = await startApp();
  try {
    const res = await fetch(`${baseUrl}/unknown`);
    assert.equal(res.status, 404);
  } finally {
    await stop();
  }
});

test('GET / (root) returns 404', async () => {
  const { baseUrl, stop } = await startApp();
  try {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 404);
  } finally {
    await stop();
  }
});

// ── Bearer auth guard on /mcp ─────────────────────────────────────────────────

test('/mcp without token configured — any request is allowed through to MCP handler', async () => {
  const { baseUrl, stop } = await startApp();
  try {
    // POST /mcp with no session ID → MCP session manager returns non-401
    const res = await fetch(`${baseUrl}/mcp`, { method: 'POST', body: '{}' });
    assert.notEqual(res.status, 401);
  } finally {
    await stop();
  }
});

test('/mcp with token configured — request without Authorization returns 401', async () => {
  const { baseUrl, stop } = await startApp('my-secret');
  try {
    const res = await fetch(`${baseUrl}/mcp`, { method: 'POST', body: '{}' });
    assert.equal(res.status, 401);
  } finally {
    await stop();
  }
});

test('/mcp with token configured — wrong token returns 401', async () => {
  const { baseUrl, stop } = await startApp('correct-token');
  try {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-token' },
      body: '{}',
    });
    assert.equal(res.status, 401);
  } finally {
    await stop();
  }
});

test('/mcp with token configured — correct token is allowed through', async () => {
  const { baseUrl, stop } = await startApp('correct-token');
  try {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { Authorization: 'Bearer correct-token' },
      body: '{}',
    });
    // Not 401 — auth passed; MCP handler may return 400 for missing session
    assert.notEqual(res.status, 401);
  } finally {
    await stop();
  }
});

test('/mcp bearer check is case-insensitive for "Bearer" scheme', async () => {
  const { baseUrl, stop } = await startApp('tok');
  try {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { Authorization: 'BEARER tok' },
      body: '{}',
    });
    assert.notEqual(res.status, 401);
  } finally {
    await stop();
  }
});

test('/mcp 401 response includes WWW-Authenticate: Bearer header', async () => {
  const { baseUrl, stop } = await startApp('secret');
  try {
    const res = await fetch(`${baseUrl}/mcp`, { method: 'POST', body: '{}' });
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('www-authenticate'), 'Bearer');
  } finally {
    await stop();
  }
});

test('/mcp 401 response body has error: unauthorized', async () => {
  const { baseUrl, stop } = await startApp('secret');
  try {
    const res = await fetch(`${baseUrl}/mcp`, { method: 'POST', body: '{}' });
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'unauthorized');
  } finally {
    await stop();
  }
});

// ── MCP session creation ──────────────────────────────────────────────────────

test('POST /mcp without session ID — MCP handler responds (not 401, not 404)', async () => {
  const { baseUrl, stop } = await startApp();
  try {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1, params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } } }),
    });
    assert.ok(res.ok, `Expected MCP initialize success, got ${res.status}`);
    assert.ok(res.headers.get('mcp-session-id'), 'Expected mcp-session-id header');
  } finally {
    await stop();
  }
});
