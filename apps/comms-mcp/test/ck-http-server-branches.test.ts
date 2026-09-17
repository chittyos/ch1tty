/**
 * CK: comms-mcp HTTP server URL-variant + Origin-inside-variant branch coverage
 *
 * Covers branches in apps/comms-mcp/src/http-server.ts not reached by
 * the existing http-transport.test.ts:
 *
 *   Line (url.startsWith('/mcp?')) — POST /mcp?session=… routes to MCP handler, not 404
 *   Line (url.startsWith('/mcp/')) — POST /mcp/something routes to MCP handler, not 404
 *
 *   Origin-inside-/mcp? — POST /mcp?session=… with Origin header → 403 (DNS-rebinding guard
 *     fires inside the /mcp? branch, not just for bare /mcp)
 *   Origin-inside-/mcp/ — POST /mcp/something with Origin header → 403 (same guard)
 *
 * The existing http-transport.test.ts already covers Origin+/mcp (bare) → 403.
 * This file closes the remaining two Origin-inside-variant branches.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createCommsHttpApp } from '../src/http-server.ts';

/** Spin up a real HTTP server on a random port and return its base URL + a stop handle. */
async function startApp(token?: string): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  const app = createCommsHttpApp({ mcpToken: token });
  const server: Server = createServer((req, res) => { void app.handleRequest(req, res); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    stop: () => new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    ),
  };
}

/** MCP initialize request body used to create a new session. */
const INIT_BODY = JSON.stringify({
  jsonrpc: '2.0',
  method: 'initialize',
  id: 1,
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '1.0.0' },
  },
});

/** Headers required for a valid MCP initialize request. */
const INIT_HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json, text/event-stream',
};

// ── url.startsWith('/mcp?') → routes to MCP handler ──────────────────────────

test('comms-mcp: POST /mcp?foo=bar routes to MCP handler — returns 200 + mcp-session-id', async () => {
  const { baseUrl, stop } = await startApp();
  try {
    // The session manager reads the session ID from the mcp-session-id header only,
    // not from URL query params. A POST to /mcp?<query> with no mcp-session-id header
    // is therefore treated as a fresh initialize, which must return 200 + mcp-session-id.
    const res = await fetch(`${baseUrl}/mcp?foo=bar`, {
      method: 'POST',
      headers: INIT_HEADERS,
      body: INIT_BODY,
    });
    assert.ok(res.ok, `Expected 200 from MCP initialize on /mcp?foo=bar, got ${res.status}`);
    assert.ok(res.headers.get('mcp-session-id'), 'Expected mcp-session-id header on /mcp?<query> initialize');
  } finally {
    await stop();
  }
});

// ── url.startsWith('/mcp/') → routes to MCP handler ──────────────────────────

test('comms-mcp: POST /mcp/something routes to MCP handler — returns 200 + mcp-session-id', async () => {
  const { baseUrl, stop } = await startApp();
  try {
    // Same as above: no mcp-session-id header → treated as fresh initialize.
    const res = await fetch(`${baseUrl}/mcp/session`, {
      method: 'POST',
      headers: INIT_HEADERS,
      body: INIT_BODY,
    });
    assert.ok(res.ok, `Expected 200 from MCP initialize on /mcp/session, got ${res.status}`);
    assert.ok(res.headers.get('mcp-session-id'), 'Expected mcp-session-id header on /mcp/<subpath> initialize');
  } finally {
    await stop();
  }
});

// ── Origin + /mcp?  → 403 (DNS-rebinding guard fires inside /mcp? branch) ───

test('comms-mcp: POST /mcp?foo=bar with Origin header → 403 (rebinding guard inside /mcp? branch)', async () => {
  const { baseUrl, stop } = await startApp();
  try {
    const res = await fetch(`${baseUrl}/mcp?session=abc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://evil.example.com' },
      body: '{}',
    });
    assert.equal(res.status, 403, 'Origin header on /mcp?<query> must return 403');
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'forbidden');
  } finally {
    await stop();
  }
});

// ── Origin + /mcp/  → 403 (DNS-rebinding guard fires inside /mcp/ branch) ───

test('comms-mcp: POST /mcp/something with Origin header → 403 (rebinding guard inside /mcp/ branch)', async () => {
  const { baseUrl, stop } = await startApp();
  try {
    const res = await fetch(`${baseUrl}/mcp/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://evil.example.com' },
      body: '{}',
    });
    assert.equal(res.status, 403, 'Origin header on /mcp/<subpath> must return 403');
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'forbidden');
  } finally {
    await stop();
  }
});
