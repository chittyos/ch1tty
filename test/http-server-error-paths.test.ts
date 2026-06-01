/**
 * QQ: HttpMcpServer error handler paths not covered by prior suites.
 *
 * Covered paths (http-server.ts):
 *   1. /api/v1/status → 500 + {error:'internal'} when getStatusSnapshot() throws
 *      (http-server.ts:85–90 — never reached in existing tests which only monkey-patch
 *      the return value; this test makes the function itself throw).
 *   2. /api/v1/health → 503 + {error:'internal',status:'degraded'} via the catch block
 *      when getStatusSnapshot() throws (http-server.ts:71–75 — distinct from the 503
 *      path where systemHealth.status==='degraded', which is covered in http-server.test.ts).
 *   3. getPort() before start() returns the configured port (http-server.ts:259–262 —
 *      all prior tests call getPort() only after start()).
 *   4. stop() with an active MCP session closes transports/servers and clears the
 *      sessions map (http-server.ts:264–275 — prior tests call stop() with no sessions).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';

let _ctr = 0;
function dlqPath(): string {
  return join(tmpdir(), `ch1tty-qq-${process.pid}-${++_ctr}.dlq.jsonl`);
}

interface Started {
  server: HttpMcpServer;
  aggregator: Aggregator;
  baseUrl: string;
  dlq: string;
}

async function startServer(): Promise<Started> {
  const dlq = dlqPath();
  const aggregator = new Aggregator([], { ledgerDlqPath: dlq });
  const server = new HttpMcpServer(aggregator, { port: 0, bindAddress: '127.0.0.1' });
  await server.start();
  return { server, aggregator, baseUrl: `http://127.0.0.1:${server.getPort()}`, dlq };
}

async function stop(s: Started): Promise<void> {
  await s.server.stop();
  await s.aggregator.shutdown();
  rmSync(s.dlq, { force: true });
}

// ---------------------------------------------------------------------------
// 1. /api/v1/status → 500 when getStatusSnapshot() throws
// ---------------------------------------------------------------------------

test('/api/v1/status: returns 500 with error:internal when getStatusSnapshot throws', async () => {
  const s = await startServer();
  try {
    s.aggregator.getStatusSnapshot = () => { throw new Error('simulated snapshot failure'); };
    const res = await fetch(`${s.baseUrl}/api/v1/status`);
    assert.equal(res.status, 500, '/api/v1/status must return 500 when getStatusSnapshot throws');
    const body = await res.json() as { error: string; service: string };
    assert.equal(body.error, 'internal', 'error field must be "internal"');
  } finally {
    await stop(s);
  }
});

// ---------------------------------------------------------------------------
// 2. /api/v1/health → 503 via catch block when getStatusSnapshot() throws
//    (distinct from the 503 where systemHealth.status === 'degraded')
// ---------------------------------------------------------------------------

test('/api/v1/health: returns 503 with error:internal (no systemHealth) when getStatusSnapshot throws', async () => {
  const s = await startServer();
  try {
    s.aggregator.getStatusSnapshot = () => { throw new Error('simulated health failure'); };
    const res = await fetch(`${s.baseUrl}/api/v1/health`);
    assert.equal(res.status, 503, '/api/v1/health must return 503 when getStatusSnapshot throws');
    const body = await res.json() as { status: string; error: string; systemHealth?: unknown };
    assert.equal(body.status, 'degraded', 'status field must be "degraded"');
    assert.equal(body.error, 'internal', 'error field must be "internal"');
    // CLAUDE.md: "On internal snapshot failure: 503 with {status:'degraded',service:'ch1tty',error:'internal'}
    //            (no systemHealth field)"
    assert.equal(body.systemHealth, undefined, 'systemHealth must be absent on snapshot failure');
  } finally {
    await stop(s);
  }
});

// ---------------------------------------------------------------------------
// 3. getPort() before start() returns the configured port number
// ---------------------------------------------------------------------------

test('getPort() before start() returns the configured port', async () => {
  const dlq = dlqPath();
  const aggregator = new Aggregator([], { ledgerDlqPath: dlq });
  const server = new HttpMcpServer(aggregator, { port: 9998, bindAddress: '127.0.0.1' });
  try {
    // start() has NOT been called — boundPort is null → returns this.port
    assert.equal(server.getPort(), 9998, 'getPort() before start() must return the configured port');
  } finally {
    await aggregator.shutdown();
    rmSync(dlq, { force: true });
  }
});

// ---------------------------------------------------------------------------
// 4. stop() with an active MCP session closes sessions and clears the map
// ---------------------------------------------------------------------------

const MCP_HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json, text/event-stream',
} as const;

test('stop() with active MCP session closes transports and clears sessions map', async () => {
  const s = await startServer();
  try {
    // Establish a real MCP session via initialize
    const res = await fetch(`${s.baseUrl}/mcp`, {
      method: 'POST',
      headers: MCP_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'qq-test', version: '1.0.0' },
        },
      }),
    });
    assert.equal(res.status, 200, 'initialize must succeed');
    const sessionId = res.headers.get('mcp-session-id');
    assert.ok(sessionId, 'session ID must be present in response headers');

    // Session must now be tracked
    const sessionsBefore = (s.server as unknown as { sessions: Map<string, unknown> }).sessions;
    assert.equal(sessionsBefore.size, 1, 'server must have exactly 1 active session after initialize');

    // stop() must close and clear all sessions
    await s.server.stop();
    assert.equal(sessionsBefore.size, 0, 'sessions map must be empty after stop()');
  } finally {
    // aggregator still needs cleanup even if server.stop() was called early
    await s.aggregator.shutdown().catch(() => {});
    rmSync(s.dlq, { force: true });
  }
});
