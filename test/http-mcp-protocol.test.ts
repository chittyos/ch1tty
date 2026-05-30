// End-to-end MCP-protocol-over-HTTP tests for the ch1tty StreamableHTTP transport.
// Validates the actual JSON-RPC message exchange — not just the REST API layer.
// The existing http-server.test.ts covers REST endpoints; this covers the /mcp path.

import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';

interface Started {
  server: HttpMcpServer;
  aggregator: Aggregator;
  baseUrl: string;
  dlqPath: string;
}

let _counter = 0;
async function startServer(token?: string): Promise<Started> {
  const dlqPath = join(tmpdir(), `ch1tty-proto-test-${process.pid}-${++_counter}.dlq.jsonl`);
  const aggregator = new Aggregator([], { ledgerDlqPath: dlqPath });
  const server = new HttpMcpServer(aggregator, { port: 0, bindAddress: '127.0.0.1', mcpToken: token });
  await server.start();
  return { server, aggregator, baseUrl: `http://127.0.0.1:${server.getPort()}`, dlqPath };
}

async function stop(s: Started): Promise<void> {
  await s.server.stop();
  await s.aggregator.shutdown();
  rmSync(s.dlqPath, { force: true });
}

const PROTO_VERSION = '2025-11-25';

// MCP Streamable HTTP: POST requires both content types in Accept
const MCP_HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json, text/event-stream',
} as const;

// Parse the first JSON payload from an SSE response body ("data: <json>")
async function parseSse(res: Response): Promise<unknown> {
  const text = await res.text();
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      return JSON.parse(line.slice(6));
    }
  }
  throw new Error(`No data line in SSE response (HTTP ${res.status}): ${text.slice(0, 300)}`);
}

// Execute MCP initialize handshake and return session metadata
async function initSession(baseUrl: string, extraHeaders: Record<string, string> = {}): Promise<{
  sessionId: string;
  protocolVersion: string;
}> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { ...MCP_HEADERS, ...extraHeaders },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: PROTO_VERSION,
        capabilities: {},
        clientInfo: { name: 'ch1tty-protocol-test', version: '1.0.0' },
      },
    }),
  });
  assert.equal(res.status, 200, `initialize expected 200, got ${res.status}`);
  const sessionId = res.headers.get('mcp-session-id');
  assert.ok(sessionId, 'mcp-session-id header must be present in initialize response');
  const msg = await parseSse(res) as {
    jsonrpc: string;
    id: number;
    result: { protocolVersion: string; serverInfo: { name: string; version: string } };
  };
  return { sessionId, protocolVersion: msg.result.protocolVersion };
}

// Send one JSON-RPC request inside an established session
async function mcpRequest(
  baseUrl: string,
  sessionId: string,
  protocolVersion: string,
  id: number,
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      ...MCP_HEADERS,
      'Mcp-Session-Id': sessionId,
      'Mcp-Protocol-Version': protocolVersion,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  return parseSse(res);
}

// ── Tests ───────────────────────────────────────────────────────────────────

test('initialize over HTTP: valid JSON-RPC response with ch1tty server info and session ID', async (t) => {
  const s = await startServer();
  try {
    const res = await fetch(`${s.baseUrl}/mcp`, {
      method: 'POST',
      headers: MCP_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: PROTO_VERSION,
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      }),
    });

    assert.equal(res.status, 200);

    const sessionId = res.headers.get('mcp-session-id');
    await t.test('mcp-session-id header present', () => {
      assert.ok(sessionId, 'mcp-session-id header must be set');
    });
    await t.test('session ID is a UUID', () => {
      assert.match(sessionId!, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    const body = await parseSse(res) as {
      jsonrpc: string;
      id: number;
      result: { protocolVersion: string; serverInfo: { name: string; version: string }; capabilities: Record<string, unknown> };
    };
    await t.test('JSON-RPC envelope', () => {
      assert.equal(body.jsonrpc, '2.0');
      assert.equal(body.id, 1);
    });
    await t.test('serverInfo.name is ch1tty', () => {
      assert.equal(body.result.serverInfo.name, 'ch1tty');
    });
    await t.test('protocolVersion negotiated', () => {
      assert.ok(body.result.protocolVersion, 'protocolVersion in result');
    });
    await t.test('capabilities object present', () => {
      assert.ok(typeof body.result.capabilities === 'object');
    });
  } finally {
    await stop(s);
  }
});

test('tools/list in established session returns exactly 5 ch1tty meta-tools', async () => {
  const s = await startServer();
  try {
    const { sessionId, protocolVersion } = await initSession(s.baseUrl);

    const body = await mcpRequest(s.baseUrl, sessionId, protocolVersion, 2, 'tools/list') as {
      jsonrpc: string;
      id: number;
      result: { tools: { name: string; description: string; inputSchema: unknown }[] };
    };

    assert.equal(body.jsonrpc, '2.0');
    assert.equal(body.id, 2);
    const names = body.result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, ['ch1tty/cast', 'ch1tty/execute', 'ch1tty/reload', 'ch1tty/search', 'ch1tty/status']);
    assert.equal(names.length, 5, 'surface is exactly 5 tools — no backend tool leakage');
  } finally {
    await stop(s);
  }
});

test('tools/call ch1tty/status returns real gateway status with expected shape', async () => {
  const s = await startServer();
  try {
    const { sessionId, protocolVersion } = await initSession(s.baseUrl);

    const body = await mcpRequest(s.baseUrl, sessionId, protocolVersion, 3, 'tools/call', {
      name: 'ch1tty/status',
      arguments: {},
    }) as {
      jsonrpc: string;
      id: number;
      result: { content: { type: string; text: string }[]; isError?: boolean };
    };

    assert.equal(body.jsonrpc, '2.0');
    assert.equal(body.id, 3);
    assert.ok(!body.result.isError, 'status call must not be an error');
    assert.equal(body.result.content[0]!.type, 'text');

    const status = JSON.parse(body.result.content[0]!.text) as {
      gateway: string;
      totalServers: number;
      servers: unknown[];
      brainHealth?: { status: string };
    };
    assert.equal(status.gateway, 'ch1tty');
    assert.equal(typeof status.totalServers, 'number');
    assert.ok(Array.isArray(status.servers));
  } finally {
    await stop(s);
  }
});

test('POST /mcp without Accept text/event-stream returns 406', async () => {
  const s = await startServer();
  try {
    const res = await fetch(`${s.baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: PROTO_VERSION, capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } },
      }),
    });
    assert.equal(res.status, 406);
  } finally {
    await stop(s);
  }
});

test('POST /mcp without Content-Type application/json returns 415', async () => {
  const s = await startServer();
  try {
    const res = await fetch(`${s.baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: PROTO_VERSION, capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } },
      }),
    });
    assert.equal(res.status, 415);
  } finally {
    await stop(s);
  }
});

test('POST /mcp with invalid JSON body returns 400', async () => {
  const s = await startServer();
  try {
    const res = await fetch(`${s.baseUrl}/mcp`, {
      method: 'POST',
      headers: MCP_HEADERS,
      body: 'not-valid-json!!',
    });
    assert.equal(res.status, 400);
  } finally {
    await stop(s);
  }
});

test('POST /mcp with unknown session ID returns 400 from ch1tty session guard', async () => {
  const s = await startServer();
  try {
    const res = await fetch(`${s.baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        ...MCP_HEADERS,
        'Mcp-Session-Id': '00000000-dead-beef-cafe-000000000000',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    });
    assert.equal(res.status, 400);
    const body = await res.json() as { error: string; message: string };
    assert.equal(body.error, 'bad request');
  } finally {
    await stop(s);
  }
});

test('session appears in /api/v1/sessions after initialize', async () => {
  const s = await startServer();
  try {
    const { sessionId } = await initSession(s.baseUrl);

    const res = await fetch(`${s.baseUrl}/api/v1/sessions`);
    assert.equal(res.status, 200);
    const body = await res.json() as { sessions: { id: string }[] };
    const found = body.sessions.some((sess) => sess.id === sessionId);
    assert.ok(found, `initialized session ${sessionId} must appear in /api/v1/sessions`);
  } finally {
    await stop(s);
  }
});

test('bearer-auth gates /mcp: 401 without token, 200 with valid token', async () => {
  const s = await startServer('integration-test-token');
  try {
    const noAuth = await fetch(`${s.baseUrl}/mcp`, {
      method: 'POST',
      headers: MCP_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: PROTO_VERSION, capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } },
      }),
    });
    assert.equal(noAuth.status, 401, 'no token → 401');

    const withAuth = await fetch(`${s.baseUrl}/mcp`, {
      method: 'POST',
      headers: { ...MCP_HEADERS, Authorization: 'Bearer integration-test-token' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: PROTO_VERSION, capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } },
      }),
    });
    assert.equal(withAuth.status, 200, 'valid token → 200');
    assert.ok(withAuth.headers.get('mcp-session-id'), 'session ID present with valid token');
  } finally {
    await stop(s);
  }
});

test('second initialize on same session returns 400 (re-init rejected)', async () => {
  const s = await startServer();
  try {
    const { sessionId, protocolVersion } = await initSession(s.baseUrl);

    // A second initialize on the same session should be rejected by the SDK
    const res = await fetch(`${s.baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        ...MCP_HEADERS,
        'Mcp-Session-Id': sessionId,
        'Mcp-Protocol-Version': protocolVersion,
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 99, method: 'initialize',
        params: { protocolVersion: PROTO_VERSION, capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } },
      }),
    });
    assert.equal(res.status, 400, 'second initialize must be rejected with 400');
  } finally {
    await stop(s);
  }
});
