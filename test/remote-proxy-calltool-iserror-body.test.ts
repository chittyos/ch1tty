// Tests for OO: callTool path where the backend signals isError:true in the result body.
//
// Distinct from:
//   - MM (error-paths): callTool transport throw → circuit records FAILURE + evict
//   - LL (calltool-templates): callTool success → isError=false
//   - NN (edge-paths): callTool circuit-open → isError=true (no connection attempted)
//
// Here the backend returns HTTP 200 with a JSON-RPC result containing isError:true.
// The circuit breaker must record SUCCESS (tool-level errors are healthy transport
// responses); the connection must NOT be evicted.
//
// All tests use a real local HTTP fixture — no behaviour mocks.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { RemoteProxy } from '../src/remote-proxy.js';

// ---------------------------------------------------------------------------
// Minimal fixture: handles initialize + tools/list + tools/call.
// callFn controls what tools/call returns (can include isError:true).
// ---------------------------------------------------------------------------

interface ToolCallResponse {
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
}

interface IsErrorFixture {
  readonly port: number;
  readonly callCount: number;
  stop: () => Promise<void>;
}

async function startIsErrorFixture(
  callFn: (name: string, args: Record<string, unknown>) => ToolCallResponse,
): Promise<IsErrorFixture> {
  let callCount = 0;

  const server: HttpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST') {
      req.resume();
      res.writeHead(405);
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      let body: { method: string; id?: number | string; params?: Record<string, unknown> };
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body;
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end('{"error":"bad json"}');
        return;
      }
      const { method, id, params } = body;

      // Notifications (no id) — ack silently
      if (id === undefined) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }

      let result: unknown;
      switch (method) {
        case 'initialize':
          result = {
            protocolVersion: '2025-11-25',
            capabilities: { tools: {} },
            serverInfo: { name: 'oo-fixture', version: '1.0' },
          };
          break;
        case 'tools/list':
          result = {
            tools: [
              { name: 'query', description: 'Run a query', inputSchema: { type: 'object', properties: {} } },
              { name: 'fail', description: 'Always fails at tool level', inputSchema: { type: 'object', properties: {} } },
            ],
          };
          break;
        case 'tools/call': {
          callCount++;
          const name = String((params as { name: string }).name ?? '');
          const args = ((params as { arguments?: Record<string, unknown> }).arguments ?? {}) as Record<string, unknown>;
          result = callFn(name, args);
          break;
        }
        default:
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32601, message: 'method not found' }, id }));
          return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', result, id }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const port = (server.address() as AddressInfo).port;

  return {
    port,
    get callCount() { return callCount; },
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('callTool: backend isError:true in result body → isError propagated, connection survives', async () => {
  const fixture = await startIsErrorFixture(() => ({
    isError: true,
    content: [{ type: 'text', text: 'tool-level failure: query returned no rows' }],
  }));
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'iserr-1', name: 'IsErr', type: 'remote', access: 'read', category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    const result = await proxy.callTool('iserr-1', 'query', {});
    // isError:true from the backend result body must be propagated unchanged
    assert.equal(result.isError, true, 'isError:true from backend body must be propagated');
    assert.ok(result.content.length > 0, 'content array must be forwarded');
    assert.match(result.content[0].text as string, /tool-level failure/);
    // Circuit records success — connection must still be alive after a tool-level error
    const status = proxy.getStatus('iserr-1');
    assert.equal(status.connected, true, 'connection must survive a tool-level error response (not evicted)');
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});

test('callTool: backend isError:true — subsequent call succeeds (circuit still healthy)', async () => {
  // After an isError:true body response the circuit breaker must have recorded success,
  // not failure. A subsequent call must reach the backend (circuit not open, no reconnect).
  const fixture = await startIsErrorFixture((name) => ({
    isError: name === 'fail',
    content: [{ type: 'text', text: name === 'fail' ? 'tool failed' : 'ok' }],
  }));
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'iserr-2', name: 'IsErr2', type: 'remote', access: 'read', category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    // First call: tool-level error (isError:true)
    const first = await proxy.callTool('iserr-2', 'fail', {});
    assert.equal(first.isError, true);
    // Second call: must succeed without triggering circuit-open or eviction
    const second = await proxy.callTool('iserr-2', 'query', {});
    assert.equal(second.isError, false);
    assert.equal(second.content[0].text, 'ok');
    // Both calls must have reached the fixture (circuit was never opened)
    assert.equal(fixture.callCount, 2, 'both calls must reach the backend — circuit breaker recorded success for first call');
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});

test('callTool: backend isError:true with multiple content items → all items forwarded', async () => {
  const fixture = await startIsErrorFixture(() => ({
    isError: true,
    content: [
      { type: 'text', text: 'Error: constraint violation' },
      { type: 'text', text: 'Detail: column "email" must be unique' },
    ],
  }));
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'iserr-3', name: 'IsErr3', type: 'remote', access: 'read', category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    const result = await proxy.callTool('iserr-3', 'query', {});
    assert.equal(result.isError, true);
    assert.equal(result.content.length, 2, 'both content items must be forwarded');
    assert.equal(result.content[0].text, 'Error: constraint violation');
    assert.equal(result.content[1].text, 'Detail: column "email" must be unique');
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});
