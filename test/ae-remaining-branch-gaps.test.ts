/**
 * AE: Remaining branch gaps — 3 uncovered paths identified by c8 after AD merges.
 *
 * Paths closed (all in src-stdio/):
 *   child-manager.ts:137  — errJson.reason || "no reason" fallback (error body lacks reason field)
 *   child-manager.ts:139  — catch {} when res.json() throws on a non-OK response
 *   http-server.ts:168    — isClosing guard (transport.onclose called twice; second call returns early)
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { ChildManager } from '../src/child-manager.js';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';
import type { LocalServerConfig } from '../src/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE_CONFIG: LocalServerConfig = {
  id: 'ae-test-server',
  name: 'AE Test Server',
  type: 'local',
  access: 'readwrite',
  category: 'code',
  command: 'node',
};

function makeConfig(env: Record<string, string>): LocalServerConfig {
  return { ...BASE_CONFIG, env };
}

const MCP_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
} as const;

async function parseSse(res: Response): Promise<unknown> {
  const text = await res.text();
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) return JSON.parse(line.slice(6));
  }
  throw new Error(`No data line in SSE response: ${text.slice(0, 200)}`);
}

// ─── 1. child-manager.ts:137 — "no reason" fallback ──────────────────────────
// When a non-OK ChittySecrets response body has error but no reason field,
// the template literal uses the "no reason" default (|| "no reason" branch).

test('ChittySecrets error body without reason field uses "no reason" fallback', async () => {
  const savedFetch = globalThis.fetch;
  const savedEnv = {
    id: process.env['CF_ACCESS_CLIENT_ID'],
    secret: process.env['CF_ACCESS_CLIENT_SECRET'],
    chittyId: process.env['CHITTY_CF_ACCESS_CLIENT_ID'],
    chittySecret: process.env['CHITTY_CF_ACCESS_CLIENT_SECRET'],
  };
  try {
    // Provide CF Access creds so fetchChittySecret reaches the fetch() call
    process.env['CF_ACCESS_CLIENT_ID'] = 'test-client-id';
    process.env['CF_ACCESS_CLIENT_SECRET'] = 'test-client-secret';

    // Mock: ok:false, body has error but NO reason field → hits the || "no reason" branch
    globalThis.fetch = async (_url: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      return {
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({ error: 'access denied' }), // no reason field
      } as unknown as Response;
    };

    const cm = new ChildManager();
    // resolveEnv calls fetchChittySecret which enters the !res.ok branch, hits line 137
    // with errJson.reason = undefined, so `errJson.reason || "no reason"` uses "no reason"
    const env = await (cm as Record<string, unknown>)['resolveEnv'](
      makeConfig({ K: 'chittysecrets://test-key' }),
    );

    // Error is caught by resolveEnv, failed secret is dropped
    assert.ok(!('K' in env), 'secret with no-reason error should be removed from env');
  } finally {
    globalThis.fetch = savedFetch;
    if (savedEnv.id !== undefined) process.env['CF_ACCESS_CLIENT_ID'] = savedEnv.id;
    else delete process.env['CF_ACCESS_CLIENT_ID'];
    if (savedEnv.secret !== undefined) process.env['CF_ACCESS_CLIENT_SECRET'] = savedEnv.secret;
    else delete process.env['CF_ACCESS_CLIENT_SECRET'];
    if (savedEnv.chittyId !== undefined) process.env['CHITTY_CF_ACCESS_CLIENT_ID'] = savedEnv.chittyId;
    else delete process.env['CHITTY_CF_ACCESS_CLIENT_ID'];
    if (savedEnv.chittySecret !== undefined) process.env['CHITTY_CF_ACCESS_CLIENT_SECRET'] = savedEnv.chittySecret;
    else delete process.env['CHITTY_CF_ACCESS_CLIENT_SECRET'];
  }
});

// ─── 2. child-manager.ts:139 — catch {} when res.json() throws ───────────────
// When a non-OK response body cannot be parsed as JSON, the try block throws
// and the catch {} swallows it; the error message stays as "HTTP <status> <text>".

test('ChittySecrets non-JSON error body hits catch{} and falls back to plain HTTP status', async () => {
  const savedFetch = globalThis.fetch;
  const savedEnv = {
    id: process.env['CF_ACCESS_CLIENT_ID'],
    secret: process.env['CF_ACCESS_CLIENT_SECRET'],
  };
  try {
    process.env['CF_ACCESS_CLIENT_ID'] = 'test-client-id';
    process.env['CF_ACCESS_CLIENT_SECRET'] = 'test-client-secret';

    // Mock: ok:false, json() THROWS → hits the catch {} at child-manager.ts:139
    globalThis.fetch = async (_url: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      return {
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => { throw new SyntaxError('not JSON'); },
      } as unknown as Response;
    };

    const cm = new ChildManager();
    const env = await (cm as Record<string, unknown>)['resolveEnv'](
      makeConfig({ K: 'chittysecrets://service-down-key' }),
    );

    // json() threw — catch {} fired — error thrown from fetchChittySecret
    // resolveEnv swallows it and removes the key
    assert.ok(!('K' in env), 'secret with non-JSON error body should be removed from env');
  } finally {
    globalThis.fetch = savedFetch;
    if (savedEnv.id !== undefined) process.env['CF_ACCESS_CLIENT_ID'] = savedEnv.id;
    else delete process.env['CF_ACCESS_CLIENT_ID'];
    if (savedEnv.secret !== undefined) process.env['CF_ACCESS_CLIENT_SECRET'] = savedEnv.secret;
    else delete process.env['CF_ACCESS_CLIENT_SECRET'];
  }
});

// ─── 3. http-server.ts:168 — isClosing guard ─────────────────────────────────
// The transport.onclose handler sets isClosing=true on first call.
// A second call must return early without throwing or duplicating cleanup.

test('http-server transport.onclose isClosing guard — second call returns early', async () => {
  const dlqPath = join(tmpdir(), `ch1tty-ae-isClosing-${Date.now()}.dlq.jsonl`);
  const aggregator = new Aggregator([], { ledgerDlqPath: dlqPath });
  const server = new HttpMcpServer(aggregator, {
    port: 0,
    bindAddress: '127.0.0.1',
    mcpToken: undefined,
  });

  await server.start();
  const baseUrl = `http://127.0.0.1:${server.getPort()}`;

  try {
    // Initialize an MCP session to create a transport with the onclose handler
    const initRes = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: MCP_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'ae-isClosing-test', version: '1.0.0' },
        },
      }),
    });

    assert.equal(initRes.status, 200, `initialize expected 200, got ${initRes.status}`);
    const sessionId = initRes.headers.get('mcp-session-id');
    assert.ok(sessionId, 'mcp-session-id must be present');
    await parseSse(initRes); // drain the SSE body

    // Locate the transport via the server's internal sessions map
    const sessions = (server as Record<string, unknown>)['sessions'] as Map<
      string,
      { transport: { onclose?: () => void } }
    >;
    const session = sessions.get(sessionId);
    assert.ok(session, `session ${sessionId} must be in server.sessions`);
    assert.ok(typeof session.transport.onclose === 'function', 'transport.onclose must be set');

    // First call: performs cleanup (deletes session, calls session ends)
    session.transport.onclose!();
    assert.ok(!sessions.has(sessionId), 'session must be removed after first onclose');

    // Second call: hits if (isClosing) return — must not throw or re-run cleanup
    assert.doesNotThrow(() => session.transport.onclose!(), 'second onclose call must not throw');
  } finally {
    await server.stop();
    await aggregator.shutdown();
    rmSync(dlqPath, { force: true });
  }
});
