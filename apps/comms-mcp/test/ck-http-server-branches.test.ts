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

// ── url.startsWith('/mcp?') → routes to MCP handler ──────────────────────────

test('comms-mcp: POST /mcp?foo=bar routes to MCP handler (not 404)', async () => {
  const { baseUrl, stop } = await startApp();
  try {
    // A POST to /mcp?<query> must hit the MCP handler branch, not fall through to 404.
    // The session manager returns 400/other for a malformed body, proving routing occurred.
    const res = await fetch(`${baseUrl}/mcp?session=abc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.notEqual(res.status, 404, 'POST /mcp?<query> must not return 404');
  } finally {
    await stop();
  }
});

// ── url.startsWith('/mcp/') → routes to MCP handler ──────────────────────────

test('comms-mcp: POST /mcp/something routes to MCP handler (not 404)', async () => {
  const { baseUrl, stop } = await startApp();
  try {
    // A POST to /mcp/<subpath> must hit the MCP handler branch, not fall through to 404.
    const res = await fetch(`${baseUrl}/mcp/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.notEqual(res.status, 404, 'POST /mcp/<subpath> must not return 404');
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
