/**
 * LLL batch — one uncovered branch
 *
 * http-server.ts transport.onclose handler (line 162-168):
 *   The onclose callback uses find() to look up the session by transport reference.
 *   When the session is no longer in the map (e.g. stop() already removed it, or
 *   a duplicate close event fires), sid is undefined, the `if (sid)` block is
 *   skipped, but mcpServer.close() is still called unconditionally.
 *
 *   Trigger: establish a session, remove it from the sessions map manually, then
 *   fire the transport's onclose callback directly.
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
  return join(tmpdir(), `ch1tty-lll-${process.pid}-${++_seq}.dlq.jsonl`);
}

// ── onclose: sid not found ─────────────────────────────────────────────────────

test('http-server onclose: session already removed from map → if(sid) skips, mcpServer.close() still runs', async () => {
  const dlq = dlqPath();
  const aggregator = new Aggregator([], { ledgerDlqPath: dlq });
  const httpServer = new HttpMcpServer(aggregator, { port: 0, bindAddress: '127.0.0.1' });
  await httpServer.start();

  try {
    // Establish a real MCP session so we get a transport with an onclose callback set.
    const res = await fetch(`http://127.0.0.1:${httpServer.getPort()}/mcp`, {
      method: 'POST',
      headers: MCP_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'lll-test', version: '1.0.0' },
        },
      }),
    });
    assert.equal(res.status, 200, 'MCP initialize must succeed');

    // Access the private sessions map and grab the single session.
    type SessionMap = Map<string, { server: { close: () => Promise<void> }; transport: { onclose?: () => void } }>;
    const sessions = (httpServer as unknown as { sessions: SessionMap }).sessions;
    assert.equal(sessions.size, 1, 'exactly one session must be active');

    const [[sid, session]] = [...sessions.entries()];

    // Remove the session from the map — simulating it already being cleaned up
    // (e.g. by a concurrent stop() or a previous onclose firing).
    sessions.delete(sid);
    assert.equal(sessions.size, 0, 'session removed from map');

    // Stub out mcpServer.close() so that invoking onclose() doesn't recurse back
    // into the transport (transport.close → onclose → mcpServer.close → repeat).
    let mcpCloseCallCount = 0;
    session.server.close = async () => { mcpCloseCallCount++; };

    // Directly invoke the onclose callback. With the session gone, find() returns
    // undefined, so sid is falsy and the if(sid) block is skipped. mcpServer.close()
    // still runs (unconditional last line). This must not throw.
    assert.doesNotThrow(
      () => session.transport.onclose?.(),
      'onclose must not throw when session is not in the sessions map',
    );

    // Give any async mcpServer.close() microtasks a moment to settle.
    await new Promise<void>((r) => setImmediate(r));
    assert.equal(mcpCloseCallCount, 1, 'mcpServer.close() called exactly once despite sid not found');
  } finally {
    await httpServer.stop();
    await aggregator.shutdown();
    rmSync(dlq, { force: true });
  }
});
