/**
 * OOO batch — 5 previously uncovered branches across http-server.ts and gpt-actions.ts
 *
 * 1. http-server.ts transport.onclose — when sid IS found in the sessions map:
 *    The if(sid) block (lines 163-167) fires: sessions.delete, aggregator.sessions.remove,
 *    aggregator.coordinator.onSessionEnd are all called, then mcpServer.close() runs
 *    unconditionally. LLL covered the sid-NOT-found case; OOO covers the found case.
 *
 * 2. gpt-actions.ts GET /gpt-actions/session/get → 404:
 *    Line 95: `if (!action || req.method !== 'POST')` fires via the req.method !== 'POST'
 *    branch when the action IS in ACTION_MAP but the method is GET. The "!action" branch
 *    (unknown action) is covered by gpt-actions-facade.test.ts; this covers the other side.
 *
 * 3. http-server.ts start() EADDRINUSE:
 *    Line 249: `this.server.once('error', reject)` — if listen() fails (port already in use),
 *    the 'error' event fires and start() rejects with the listen error. All auth-guard tests
 *    reject via the early guard throw (never reaching listen()); this is the first test that
 *    exercises the listen-error → reject path.
 *
 * 4. http-server.ts GET /mcp with no Mcp-Session-Id header → 400:
 *    Lines 186-190: when sessionId is absent (undefined, falsy) and method is not POST,
 *    both the "existing session" and "new POST session" guards are false, so the request
 *    falls through to the "Invalid" 400 response. http-mcp-protocol.test.ts covers the
 *    POST-with-unknown-sid path; OOO covers the non-POST-with-no-sid path.
 *
 * 5. gpt-actions.ts POST with empty body → readBody if(!raw) early return:
 *    Line 27: `if (!raw) return {}` — when no body bytes are sent, raw === '' (falsy),
 *    so readBody returns {} early instead of attempting JSON.parse. ccc covers the
 *    malformed-JSON catch path; OOO covers the empty-string early-return path.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';

const MCP_HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json, text/event-stream',
} as const;

let _seq = 0;
function dlqPath(): string {
  return join(tmpdir(), `ch1tty-ooo-${process.pid}-${++_seq}.dlq.jsonl`);
}

interface Started {
  server: HttpMcpServer;
  aggregator: Aggregator;
  baseUrl: string;
  dlq: string;
}

async function startServer(token?: string): Promise<Started> {
  const dlq = dlqPath();
  const aggregator = new Aggregator([], { ledgerDlqPath: dlq });
  const server = new HttpMcpServer(aggregator, { port: 0, bindAddress: '127.0.0.1', mcpToken: token });
  await server.start();
  return { server, aggregator, baseUrl: `http://127.0.0.1:${server.getPort()}`, dlq };
}

async function stop(s: Started): Promise<void> {
  await s.server.stop();
  await s.aggregator.shutdown();
  rmSync(s.dlq, { force: true });
}

// ── 1. transport.onclose: sid IS found ──────────────────────────────────────

test('http-server transport.onclose: sid IS in sessions map → if(sid) block executes cleanup', async () => {
  const dlq = dlqPath();
  const aggregator = new Aggregator([], { ledgerDlqPath: dlq });
  const httpServer = new HttpMcpServer(aggregator, { port: 0, bindAddress: '127.0.0.1' });
  await httpServer.start();

  try {
    // Establish a real MCP session so we get a transport+server pair with onclose wired.
    const initRes = await fetch(`http://127.0.0.1:${httpServer.getPort()}/mcp`, {
      method: 'POST',
      headers: MCP_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'ooo-close-test', version: '1.0.0' },
        },
      }),
    });
    assert.equal(initRes.status, 200, 'initialize must succeed');

    type SessionMap = Map<string, {
      server: { close: () => Promise<void> };
      transport: { onclose?: () => void };
    }>;
    const sessions = (httpServer as unknown as { sessions: SessionMap }).sessions;
    assert.equal(sessions.size, 1, 'exactly one session must be active after initialize');

    const [[sid, session]] = [...sessions.entries()];
    assert.ok(sid, 'session id must be non-empty');

    // Stub mcpServer.close() to track the unconditional final call.
    let mcpCloseCount = 0;
    session.server.close = async () => { mcpCloseCount++; };

    // Fire onclose while session IS in the map — exercises the if(sid) true branch.
    // This must not throw.
    assert.doesNotThrow(() => session.transport.onclose?.());

    // Give async cleanup tasks a microtask to settle.
    await new Promise<void>((r) => setImmediate(r));

    // if(sid) block: sessions.delete(sid) must have fired.
    assert.equal(sessions.size, 0, 'session must be removed from the sessions map');
    // mcpServer.close() — unconditional line after the if(sid) block.
    assert.equal(mcpCloseCount, 1, 'mcpServer.close() must be called exactly once');
    // aggregator.sessions.remove(sid) must have fired — session no longer listed.
    const listed = aggregator.sessions.listSessions();
    assert.equal(listed.filter((s) => s.id === sid).length, 0, 'session must be removed from aggregator tracker');
  } finally {
    await httpServer.stop();
    await aggregator.shutdown();
    rmSync(dlq, { force: true });
  }
});

// ── 2. gpt-actions GET on known action → 404 (wrong method) ─────────────────

test('gpt-actions GET /session/get → 404 (action exists but req.method !== POST)', async () => {
  const s = await startServer();
  try {
    const res = await fetch(`${s.baseUrl}/gpt-actions/session/get`, { method: 'GET' });
    assert.equal(res.status, 404, 'GET on a POST-only action must return 404');
    const body = await res.json() as { ok: boolean; result: { error: string } };
    assert.equal(body.ok, false, 'ok must be false');
    assert.ok(body.result?.error, 'error field must be present');
  } finally {
    await stop(s);
  }
});

// ── 3. start() EADDRINUSE → listen error → start() rejects ─────────────────

test('http-server start(): EADDRINUSE → listen error event fires → start() rejects', async () => {
  const dlq1 = dlqPath();
  const dlq2 = dlqPath();
  const agg1 = new Aggregator([], { ledgerDlqPath: dlq1 });
  const srv1 = new HttpMcpServer(agg1, { port: 0, bindAddress: '127.0.0.1' });
  await srv1.start();
  const occupiedPort = srv1.getPort();

  const agg2 = new Aggregator([], { ledgerDlqPath: dlq2 });
  const srv2 = new HttpMcpServer(agg2, { port: occupiedPort, bindAddress: '127.0.0.1' });

  try {
    await assert.rejects(
      () => srv2.start(),
      (err: NodeJS.ErrnoException) => {
        // The listen 'error' event fires with EADDRINUSE → start() rejects.
        assert.equal(err.code, 'EADDRINUSE', `expected EADDRINUSE, got ${err.code}: ${err.message}`);
        return true;
      },
      'start() must reject when the port is already in use (EADDRINUSE)',
    );
  } finally {
    await srv1.stop();
    await agg1.shutdown();
    // srv2 never started — just shut down the aggregator
    await agg2.shutdown();
    rmSync(dlq1, { force: true });
    rmSync(dlq2, { force: true });
  }
});

// ── 4. GET /mcp no Mcp-Session-Id → 400 ─────────────────────────────────────

test('http-server GET /mcp with no Mcp-Session-Id header → 400 bad request', async () => {
  const s = await startServer();
  try {
    // sessionId is absent (undefined), method is GET (not POST):
    // — "existing session" guard: (undefined && ...) = false — skipped
    // — "new POST session" guard: (GET === POST) = false — skipped
    // → falls through to the 400 "Missing or invalid session" response
    const res = await fetch(`${s.baseUrl}/mcp`, {
      method: 'GET',
      headers: { 'Accept': 'application/json, text/event-stream' },
    });
    assert.equal(res.status, 400, 'GET /mcp without session-id must return 400');
    const body = await res.json() as { error: string; message: string };
    assert.equal(body.error, 'bad request');
    assert.ok(body.message, 'message field must be present');
  } finally {
    await stop(s);
  }
});

// ── 5. POST /gpt-actions with empty body → readBody if(!raw) ─────────────────

test('gpt-actions POST /session/get with empty body → readBody if(!raw) early return → 200', async () => {
  const s = await startServer();
  try {
    // Empty POST body → chunks is [] → Buffer.concat([]).toString() = '' (falsy)
    // → `if (!raw) return {}` fires (early return, no JSON.parse attempt)
    // → mapArgs({}) produces default args → callTool returns graceful isError result
    // → facade wraps in {ok:true} and returns HTTP 200
    const res = await fetch(`${s.baseUrl}/gpt-actions/session/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Omit body entirely — no bytes sent, raw will be ''
    });
    // The facade returns 200 (wraps callTool result as ok:true) even when the
    // tool call fails gracefully (no backend registered).
    assert.equal(res.status, 200, 'empty-body POST must not crash — facade returns 200');
    const body = await res.json() as { ok: boolean; timestamp: string };
    // ok:true (graceful tool error) — facade always returns ok:true for successful callTool
    assert.equal(body.ok, true, 'ok must be true for a graceful tool result');
    assert.ok(body.timestamp, 'timestamp field must be present in envelope');
  } finally {
    await stop(s);
  }
});
