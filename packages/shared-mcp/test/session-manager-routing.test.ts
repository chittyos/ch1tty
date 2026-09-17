import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { McpSessionManager } from '../src/session-manager.js';
import type { McpServerFactory } from '../src/session-manager.js';

// CG batch — branch-coverage gaps in session-manager.ts not covered by session-manager.test.ts:
//
// 1. Line 41-44: existing session routing — a request carrying a known Mcp-Session-Id
//    is routed to the existing session's transport.handleRequest(); no new session created.
//
// 2. Line 67-75 (transport.onclose callback, positive sid branch): when the transport
//    closes, the session is deleted from the map and onSessionEnd fires with the session ID.
//
// 3. Line 80-82: !mcpSessionId branch — when handleRequest completes without firing
//    onsessioninitialized (non-initialize body), transport.close() is called;
//    sessionCount stays 0, no leak.
//
// 4. Lines 102-108 (closeAll with multiple sessions): each session's transport and server
//    are closed; sessionCount reaches 0.
//
// 5. onSessionEnd not assigned (undefined guard): onclose fires without crashing when
//    onSessionEnd is not set.

const MCP_ACCEPT = 'application/json, text/event-stream';

function minimalFactory(): McpServerFactory {
  return () => new Server({ name: 'test-server', version: '1.0.0' }, { capabilities: {} });
}

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
        clientInfo: { name: 'test-client', version: '1.0' },
      },
      id: 1,
    }),
  });
  assert.equal(res.status, 200, `initialize must return 200, got ${res.status}`);
  const sessionId = res.headers.get('mcp-session-id');
  assert.ok(sessionId, 'Mcp-Session-Id header must be present after initialize');
  return sessionId;
}

// ── Test 1 (line 41-44): existing session routing ───────────────────────────
test('McpSessionManager: known Mcp-Session-Id routes to existing transport, sessionCount stays 1', async () => {
  const manager = new McpSessionManager(minimalFactory());
  const { url, close } = await startHttpServer(manager);
  try {
    const sessionId = await initializeSession(url);
    assert.equal(manager.sessionCount, 1);

    // Subsequent request with the known session ID
    const res2 = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: MCP_ACCEPT,
        'Mcp-Session-Id': sessionId,
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 2 }),
    });
    // Routed to existing session — must return a 2xx response
    assert.ok(res2.ok, `expected 2xx from existing-session ping, got HTTP ${res2.status}`);
    // No new session was created
    assert.equal(manager.sessionCount, 1, 'sessionCount must remain 1 after routing to existing session');
  } finally {
    await close();
    await manager.closeAll();
  }
});

// ── Test 2 (line 67-75): onSessionEnd fires via transport close ──────────────
test('McpSessionManager: onSessionEnd fires when session is closed via closeAll', async () => {
  const endedIds: string[] = [];
  const manager = new McpSessionManager(minimalFactory());
  manager.onSessionEnd = (id) => endedIds.push(id);

  const { url, close } = await startHttpServer(manager);
  try {
    const sessionId = await initializeSession(url);
    assert.equal(manager.sessionCount, 1);
    await manager.closeAll();
    // onSessionEnd must have been called with the session ID from the onclose handler
    assert.deepEqual(endedIds, [sessionId]);
    assert.equal(manager.sessionCount, 0);
  } finally {
    await close();
  }
});

// ── Test 3 (line 80-82): !mcpSessionId branch — non-initialize POST ─────────
test('McpSessionManager: non-initialize POST without session ID → no session created, sessionCount stays 0', async () => {
  const manager = new McpSessionManager(minimalFactory());
  const { url, close } = await startHttpServer(manager);
  try {
    // tools/list is not an initialize message; onsessioninitialized will not fire,
    // so mcpSessionId stays undefined → transport.close() is called (line 80-82).
    const res = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: MCP_ACCEPT },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', params: {}, id: 1 }),
    });
    assert.equal(res.status, 400, 'non-initialize POST without session ID must return 400');
    assert.equal(manager.sessionCount, 0, 'no session must be created for a non-initialize POST');
  } finally {
    await close();
    await manager.closeAll();
  }
});

// ── Test 4 (lines 102-108): closeAll with multiple concurrent sessions ───────
test('McpSessionManager: closeAll drains all sessions when multiple exist', async () => {
  const manager = new McpSessionManager(minimalFactory());
  const { url, close } = await startHttpServer(manager);
  try {
    // Create two sessions concurrently
    const [id1, id2] = await Promise.all([initializeSession(url), initializeSession(url)]);
    assert.equal(manager.sessionCount, 2);
    assert.notEqual(id1, id2, 'each initialize must yield a unique session ID');

    await manager.closeAll();
    assert.equal(manager.sessionCount, 0, 'closeAll must drain all sessions');
  } finally {
    await close();
  }
});

// ── Test 5 (line 73): onSessionEnd undefined guard — no crash when unset ─────
test('McpSessionManager: onclose does not crash when onSessionEnd is not assigned', async () => {
  const manager = new McpSessionManager(minimalFactory());
  // Deliberately do NOT assign onSessionEnd

  const { url, close } = await startHttpServer(manager);
  try {
    await initializeSession(url);
    await assert.doesNotReject(manager.closeAll());
    assert.equal(manager.sessionCount, 0);
  } finally {
    await close();
  }
});

// ── Test 6: second POST after closeAll — new session can be created ──────────
test('McpSessionManager: after closeAll a new session can be created (sessions map is clear)', async () => {
  const manager = new McpSessionManager(minimalFactory());
  const { url, close } = await startHttpServer(manager);
  try {
    await initializeSession(url);
    await manager.closeAll();
    assert.equal(manager.sessionCount, 0);

    // A fresh initialize after closeAll must produce a new session
    const newId = await initializeSession(url);
    assert.ok(newId, 'a new session must be created after closeAll');
    assert.equal(manager.sessionCount, 1);
  } finally {
    await close();
    await manager.closeAll();
  }
});
