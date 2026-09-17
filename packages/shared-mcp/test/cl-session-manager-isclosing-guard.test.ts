/**
 * CL: session-manager `isClosing` re-entrancy guard
 *
 * Covers the `if (isClosing) return;` guard at the top of the transport.onclose
 * callback in packages/shared-mcp/src/session-manager.ts.
 *
 * The guard is a per-session closure variable set to `true` on the first onclose
 * invocation. Subsequent calls to onclose (e.g. the transport fires twice due to
 * an SDK edge case, or a manual double-close) return immediately, preventing
 * duplicate cleanup (double-delete from sessions map, double onSessionEnd fire,
 * double mcpServer.close() call).
 *
 * Two tests:
 *
 *   1. Double-fire via closeAll + manual: closeAll() triggers onclose (isClosing=false→true,
 *      cleanup runs, onSessionEnd fires once). A second manual fire of the saved onclose
 *      ref hits `if (isClosing) return;` — no further cleanup, no throw.
 *
 *   2. Double-fire via two manual calls (pre-remove session): manually call onclose
 *      twice with no intervening closeAll — first call sets isClosing=true and runs
 *      cleanup; second call returns early immediately.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { McpSessionManager } from '../src/session-manager.js';

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
        clientInfo: { name: 'cl-test', version: '1.0' },
      },
      id: 1,
    }),
  });
  assert.equal(res.status, 200, `initialize must return 200, got ${res.status}`);
  const sessionId = res.headers.get('mcp-session-id');
  assert.ok(sessionId, 'Mcp-Session-Id header must be present after initialize');
  return sessionId;
}

type SessionEntry = { server: Server; transport: { onclose?: () => void } };

// ── Test 1: double-fire via closeAll + manual re-fire ─────────────────────────
//
// closeAll() calls transport.close() which fires transport.onclose once:
//   isClosing=false → set to true → session found in map → deleted → onSessionEnd
//   fires once → mcpServer.close() called.
//
// Saving a reference to transport.onclose BEFORE closeAll() and calling it after:
//   isClosing is now true → `if (isClosing) return;` fires immediately.
//   onSessionEnd must NOT be called a second time, and must not throw.

test('McpSessionManager isClosing guard: closeAll + manual re-fire — cleanup runs once, guard stops second call', async () => {
  const endedIds: string[] = [];
  const manager = new McpSessionManager(() =>
    new Server({ name: 'cl-test', version: '1.0.0' }, { capabilities: {} }),
  );
  manager.onSessionEnd = (id) => endedIds.push(id);

  const { url, close } = await startHttpServer(manager);
  try {
    const sessionId = await initializeSession(url);
    assert.equal(manager.sessionCount, 1);

    // Capture the onclose reference before closeAll evicts the session.
    const sessions = (manager as unknown as { sessions: Map<string, SessionEntry> }).sessions;
    const entry = sessions.get(sessionId);
    assert.ok(entry, 'session entry must exist in the map');
    assert.ok(typeof entry.transport.onclose === 'function', 'transport.onclose must be assigned');
    const savedOnClose = entry.transport.onclose!;

    // First trigger: closeAll → transport.close() → onclose fires (isClosing false→true).
    await manager.closeAll();
    assert.equal(manager.sessionCount, 0, 'session must be gone after closeAll');
    assert.deepEqual(endedIds, [sessionId], 'onSessionEnd must have fired exactly once after closeAll');

    // Second trigger: call the saved onclose directly.
    // isClosing is now true → guard returns immediately.
    assert.doesNotThrow(
      () => savedOnClose(),
      'second call to onclose must not throw when isClosing=true',
    );

    // onSessionEnd must NOT have fired again.
    assert.deepEqual(
      endedIds,
      [sessionId],
      'onSessionEnd must not fire on the second onclose call (isClosing guard)',
    );
    assert.equal(manager.sessionCount, 0, 'sessionCount must stay 0 after guarded no-op');
  } finally {
    await close();
  }
});

// ── Test 2: double-fire via two manual calls (no closeAll) ────────────────────
//
// Pre-remove the session from the map, then fire transport.onclose twice.
//
// First call: isClosing=false → set to true → session not found in map (pre-removed) →
//   sid undefined → if (sid) block skipped → onSessionEnd NOT called → mcpServer.close() called.
//
// Second call: isClosing=true → `if (isClosing) return;` fires immediately.
//   No further side effects. Must not throw.

test('McpSessionManager isClosing guard: double manual fire (no closeAll) — second call is no-op', async () => {
  const endedIds: string[] = [];
  const manager = new McpSessionManager(() =>
    new Server({ name: 'cl-test', version: '1.0.0' }, { capabilities: {} }),
  );
  manager.onSessionEnd = (id) => endedIds.push(id);

  const { url, close } = await startHttpServer(manager);
  try {
    const sessionId = await initializeSession(url);
    assert.equal(manager.sessionCount, 1);

    const sessions = (manager as unknown as { sessions: Map<string, SessionEntry> }).sessions;
    const entry = sessions.get(sessionId);
    assert.ok(entry, 'session entry must exist');
    assert.ok(typeof entry.transport.onclose === 'function', 'transport.onclose must be set');
    const savedOnClose = entry.transport.onclose!;

    // Pre-remove the session so the first onclose call's sid-lookup yields undefined.
    sessions.delete(sessionId);
    assert.equal(manager.sessionCount, 0, 'session must be manually evicted from map');

    // First manual fire: isClosing=false → true; sid not found → cleanup skipped;
    // mcpServer.close() called via the .catch() path.
    assert.doesNotThrow(() => savedOnClose(), 'first manual onclose must not throw');
    assert.deepEqual(endedIds, [], 'onSessionEnd must not fire when session is pre-removed');

    // Second manual fire: isClosing=true → guard returns immediately.
    assert.doesNotThrow(() => savedOnClose(), 'second manual onclose must not throw (isClosing guard)');
    assert.deepEqual(endedIds, [], 'onSessionEnd must still not fire on second call');
    assert.equal(manager.sessionCount, 0);
  } finally {
    await close();
    // manager.closeAll() intentionally omitted — sessions map is empty.
  }
});
