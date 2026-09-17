/**
 * CI: evidence-mcp HTTP server branch coverage
 *
 * Covers branches in apps/evidence-mcp/src/http-server.ts not reached by
 * the existing http-transport.test.ts:
 *
 *   1. Line 50 — Origin header present → 403 forbidden
 *      (DNS-rebinding protection, CWE-346). Any request to /mcp carrying
 *      an Origin header must be rejected before the bearer check or MCP
 *      handler is reached.
 *
 *   2. Line 47 — url.startsWith('/mcp?')
 *      A POST to /mcp?session=… routes to the MCP handler (not 404).
 *
 *   3. Line 47 — url.startsWith('/mcp/')
 *      A POST to /mcp/something routes to the MCP handler (not 404).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createEvidenceHttpApp } from '../src/http-server.ts';

async function startApp(token?: string): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  const app = createEvidenceHttpApp({ mcpToken: token });
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

// ── Branch 1: Origin header → 403 forbidden ──────────────────────────────────

test('evidence-mcp: POST /mcp with Origin header → 403 forbidden (DNS-rebinding guard)', async () => {
  const { baseUrl, stop } = await startApp();
  try {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.example.com',
      },
      body: '{}',
    });
    assert.equal(res.status, 403, `expected 403 from Origin-guarded POST, got ${res.status}`);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'forbidden');
  } finally {
    await stop();
  }
});

test('evidence-mcp: GET /mcp with Origin header → 403 (guard fires before any other check)', async () => {
  const { baseUrl, stop } = await startApp('some-token');
  try {
    // Even with a correct token configured, Origin must trigger 403 first.
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer some-token',
        Origin: 'http://localhost:3000',
      },
    });
    assert.equal(res.status, 403);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'forbidden');
  } finally {
    await stop();
  }
});

// ── Branch 2: url.startsWith('/mcp?') → routes to MCP handler ────────────────

test('evidence-mcp: POST /mcp?foo=bar routes to MCP handler (not 404)', async () => {
  const { baseUrl, stop } = await startApp();
  try {
    // A POST to /mcp?<query> must hit the MCP handler, not fall through to 404.
    // The session manager returns 400 for a POST without a session ID and
    // without an initialize body, which proves routing happened.
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

// ── Branch 3: url.startsWith('/mcp/') → routes to MCP handler ────────────────

test('evidence-mcp: POST /mcp/something routes to MCP handler (not 404)', async () => {
  const { baseUrl, stop } = await startApp();
  try {
    // A POST to /mcp/<subpath> must hit the MCP handler, not fall through to 404.
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
