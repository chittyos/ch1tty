/**
 * CH: session-manager onclose edge-case branches
 *
 * Covers two branches in packages/shared-mcp/src/session-manager.ts not
 * reached by session-manager.test.ts or session-manager-routing.test.ts (PR #1327):
 *
 *   1. Line 71 — if (sid) falsy: transport.onclose fires after the session has
 *      already been removed from the sessions map; the find() yields undefined,
 *      the if (sid) guard skips cleanup, and mcpServer.close() is still called.
 *
 *   2. Line 75 — .catch(() => {}) callback: when mcpServer!.close() rejects, the
 *      catch callback fires and silently absorbs the error so the onclose handler
 *      does not propagate a fatal unhandled rejection.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { McpSessionManager } from '../src/session-manager.js';
import type { McpServerFactory } from '../src/session-manager.js';

const MCP_ACCEPT = 'application/json, text/event-stream';

async function startHttpServer(
  manager: McpSessionManager,
): Promise<{ url: string; close: () => Promise<void> }> {
  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    manager.handleRequest(req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('{}');
      }
    });
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        httpServer.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

async function initializeSession(url: string): Promise<string> {
  const res = await fetch(`${url}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: MCP_ACCEPT },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'ch-test', version: '1.0' },
      },
      id: 1,
    }),
  });
  assert.equal(res.status, 200, `initialize must return 200, got ${res.status}`);
  const sessionId = res.headers.get('mcp-session-id');
  assert.ok(sessionId, 'Mcp-Session-Id header must be present');
  return sessionId;
}

// ── Test 1 (line 71): if (sid) falsy — session pre-removed before onclose ────
// When the session has already been evicted from the map before transport.onclose
// fires, the find() scan yields undefined, so sid is falsy.  The cleanup block
// is skipped (onSessionEnd is NOT called) and execution falls through to
// mcpServer!.close().catch(() => {}) without throwing.

test('McpSessionManager onclose: if (sid) falsy — pre-removed session skips cleanup without throw', async () => {
  const endedIds: string[] = [];
  const manager = new McpSessionManager(() =>
    new Server({ name: 'ch-test', version: '1.0.0' }, { capabilities: {} }),
  );
  manager.onSessionEnd = (id) => endedIds.push(id);

  const { url, close } = await startHttpServer(manager);
  try {
    const sessionId = await initializeSession(url);
    assert.equal(manager.sessionCount, 1);

    // Reflect into the private sessions map
    type Entry = { server: Server; transport: { onclose?: () => void } };
    const sessions = (manager as unknown as { sessions: Map<string, Entry> }).sessions;

    const entry = sessions.get(sessionId);
    assert.ok(entry, 'session entry must exist in the map');
    assert.ok(typeof entry.transport.onclose === 'function', 'transport.onclose must be set');

    // Remove the session from the map before triggering onclose — simulates a
    // scenario where closeAll() or another concurrent path already cleaned up.
    sessions.delete(sessionId);
    assert.equal(manager.sessionCount, 0, 'session must be gone from map');

    // Fire onclose: isClosing=false (first call), runs the body; find() returns
    // undefined because the transport is no longer in sessions → if (sid) is falsy.
    assert.doesNotThrow(() => entry.transport.onclose!(), 'onclose must not throw when sid not found');

    // onSessionEnd must NOT have been called (the if (sid) block was skipped)
    assert.deepEqual(endedIds, [], 'onSessionEnd must not fire when session not found in map');
    assert.equal(manager.sessionCount, 0);
  } finally {
    await close();
    // manager.closeAll() intentionally omitted — map is already empty
  }
});

// ── Test 2 (line 75): .catch(() => {}) absorbs mcpServer.close() rejection ───
// When the factory's Server has a close() that rejects, the .catch(() => {}) in
// the onclose handler absorbs the error.  closeAll() must still resolve cleanly
// even though the underlying server close failed.

test('McpSessionManager onclose: mcpServer.close() rejection absorbed by .catch(() => {})', async () => {
  const rejectingFactory: McpServerFactory = () => {
    const srv = new Server({ name: 'ch-test', version: '1.0.0' }, { capabilities: {} });
    srv.close = async () => {
      throw new Error('intentional close rejection for CH coverage');
    };
    return srv;
  };

  const manager = new McpSessionManager(rejectingFactory);
  const { url, close } = await startHttpServer(manager);
  try {
    await initializeSession(url);
    assert.equal(manager.sessionCount, 1);

    // closeAll() calls transport.close() → onclose fires → mcpServer!.close() rejects
    // → .catch(() => {}) absorbs the error; closeAll must resolve without throwing.
    await assert.doesNotReject(
      manager.closeAll(),
      'closeAll must not throw when mcpServer.close() rejects',
    );
    assert.equal(manager.sessionCount, 0, 'sessionCount must be 0 after closeAll');
  } finally {
    await close();
  }
});
