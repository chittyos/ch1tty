/**
 * CJ: tasks-mcp HTTP server URL-variant branch coverage
 *
 * Covers branches in apps/tasks-mcp/src/http-server.ts not reached by
 * the existing http-transport.test.ts:
 *
 *   Line 47 — url.startsWith('/mcp?')
 *     A POST to /mcp?session=… routes to the MCP handler (not 404).
 *
 *   Line 47 — url.startsWith('/mcp/')
 *     A POST to /mcp/something routes to the MCP handler (not 404).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createTasksHttpApp } from '../src/http-server.ts';

/** Spin up a real HTTP server on a random port and return its base URL + a stop handle. */
async function startApp(token?: string): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  const app = createTasksHttpApp({ mcpToken: token });
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

test('tasks-mcp: POST /mcp?foo=bar routes to MCP handler (not 404)', async () => {
  const { baseUrl, stop } = await startApp();
  try {
    // A POST to /mcp?<query> must hit the MCP handler, not fall through to 404.
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

test('tasks-mcp: POST /mcp/something routes to MCP handler (not 404)', async () => {
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
