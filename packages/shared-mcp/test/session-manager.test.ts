import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { McpSessionManager } from '../src/session-manager.js';
import type { McpServerFactory } from '../src/session-manager.js';

const MCP_ACCEPT = 'application/json, text/event-stream';

function minimalFactory(): McpServerFactory {
  return (_getSessionId) =>
    new Server({ name: 'test-server', version: '1.0.0' }, { capabilities: {} });
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

test('McpSessionManager: sessionCount is 0 on construction', () => {
  const manager = new McpSessionManager(minimalFactory());
  assert.equal(manager.sessionCount, 0);
});

test('McpSessionManager: closeAll() with no sessions resolves without error', async () => {
  const manager = new McpSessionManager(minimalFactory());
  await assert.doesNotReject(manager.closeAll());
});

test('McpSessionManager: GET without mcp-session-id → 400 bad request', async () => {
  const manager = new McpSessionManager(minimalFactory());
  const { url, close } = await startHttpServer(manager);
  try {
    const res = await fetch(`${url}/mcp`, { method: 'GET' });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, 'bad request');
  } finally {
    await close();
    await manager.closeAll();
  }
});

test('McpSessionManager: GET with unknown mcp-session-id → 404 session not found', async () => {
  const manager = new McpSessionManager(minimalFactory());
  const { url, close } = await startHttpServer(manager);
  try {
    const res = await fetch(`${url}/mcp`, {
      method: 'GET',
      headers: { 'Mcp-Session-Id': 'nonexistent-abc-123' },
    });
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, 'session not found');
  } finally {
    await close();
    await manager.closeAll();
  }
});

test('McpSessionManager: DELETE with unknown mcp-session-id → 404', async () => {
  const manager = new McpSessionManager(minimalFactory());
  const { url, close } = await startHttpServer(manager);
  try {
    const res = await fetch(`${url}/mcp`, {
      method: 'DELETE',
      headers: { 'Mcp-Session-Id': 'gone-session' },
    });
    assert.equal(res.status, 404);
  } finally {
    await close();
    await manager.closeAll();
  }
});

test('McpSessionManager: POST initialize creates session, sessionCount = 1, onSessionStart fires', async () => {
  const startedIds: string[] = [];
  const manager = new McpSessionManager(minimalFactory());
  manager.onSessionStart = (id) => startedIds.push(id);

  const { url, close } = await startHttpServer(manager);
  try {
    const res = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: MCP_ACCEPT,
      },
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
    assert.equal(res.status, 200, `expected 200, got ${res.status}`);
    const sessionId = res.headers.get('mcp-session-id');
    assert.ok(sessionId, 'response must include Mcp-Session-Id header');
    assert.equal(manager.sessionCount, 1);
    assert.deepEqual(startedIds, [sessionId]);
  } finally {
    await close();
    await manager.closeAll();
  }
});

test('McpSessionManager: factory error on POST → 500 internal', async () => {
  const manager = new McpSessionManager(() => {
    throw new Error('factory intentionally failed');
  });
  const { url, close } = await startHttpServer(manager);
  try {
    const res = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: MCP_ACCEPT,
      },
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
    assert.equal(res.status, 500);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, 'internal');
  } finally {
    await close();
    await manager.closeAll();
  }
});

test('McpSessionManager: closeAll after creating session → sessionCount returns to 0', async () => {
  const manager = new McpSessionManager(minimalFactory());
  const { url, close } = await startHttpServer(manager);
  try {
    await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: MCP_ACCEPT,
      },
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
    assert.equal(manager.sessionCount, 1);
    await manager.closeAll();
    assert.equal(manager.sessionCount, 0);
  } finally {
    await close();
  }
});
