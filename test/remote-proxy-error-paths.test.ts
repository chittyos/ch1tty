// Tests for RemoteProxy error paths not covered by prior suites:
//   1. callTool: transport throw after successful connect → isError + evict (lines 222–228)
//   2. listTools: transport throw after successful connect → [] + evict (lines 189–194)
//   3. listResources: allSettled-rejected partial failure → empty, no eviction (lines 246–265)
//   4. listPrompts: transport throw after successful connect → [] + evict (lines 334–339)
//   5. listResources: unknown server → empty immediately (line 234)
//   6. listPrompts: unknown server → empty immediately (line 305)
//   7. listResources: circuit open → empty immediately (line 236)
//   8. listPrompts: circuit open → empty immediately (line 308)
// All tests use a real local HTTP fixture or refused port — no behaviour mocks.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { RemoteProxy } from '../src/remote-proxy.js';

// ---------------------------------------------------------------------------
// Fixture: accepts initialize, returns HTTP 500 for all other methods.
// This simulates a live backend where the connection is established but
// individual RPC calls fail (stale session, auth expired, etc.).
// ---------------------------------------------------------------------------

async function startFailAfterInit(): Promise<{ port: number; stop: () => Promise<void> }> {
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
      let body: { method?: string; id?: number | string };
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body;
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }
      const { method, id } = body;
      if (id === undefined) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }
      if (method !== 'initialize') {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'forced-fail' }, id }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: '2025-11-25',
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: 'mm-fixture', version: '1.0' },
        },
      }));
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
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// Open the circuit breaker (default threshold = 5) via ECONNREFUSED on port 1.
async function openCircuit(proxy: RemoteProxy, serverId: string): Promise<void> {
  proxy.registerServer({
    id: serverId, name: serverId, type: 'remote', access: 'read', category: 'storage',
    endpoint: 'http://127.0.0.1:1/mcp',
  });
  for (let i = 0; i < 5; i++) {
    await proxy.callTool(serverId, 'any', {});
  }
}

// ---------------------------------------------------------------------------
// Tests 1–4: error catch paths after a successfully-established connection
// ---------------------------------------------------------------------------

test('callTool: transport throw after connect → isError + connection evicted', async () => {
  const fixture = await startFailAfterInit();
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'ct-ep', name: 'CT EP', type: 'remote', access: 'read', category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    // initialize succeeds (connection established), tools/call → 500 → SDK throws
    const result = await proxy.callTool('ct-ep', 'anything', {});
    assert.equal(result.isError, true);
    assert.match(result.content[0].text as string, /Remote call error/);
    // evict() called — connection must be gone
    assert.equal(proxy.getStatus('ct-ep').connected, false, 'connection must be evicted after callTool error');
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});

test('listTools: transport throw after connect → [] + connection evicted', async () => {
  const fixture = await startFailAfterInit();
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'lt-ep', name: 'LT EP', type: 'remote', access: 'read', category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    // initialize succeeds, tools/list → 500 → SDK throws
    const result = await proxy.listTools('lt-ep');
    assert.deepEqual(result, []);
    assert.equal(proxy.getStatus('lt-ep').connected, false, 'connection must be evicted after listTools error');
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});

test('listResources: allSettled-rejected partial failure → empty, connection survives', async () => {
  // initialize succeeds; resources/list + resources/templates/list both return 500.
  // allSettled captures both rejections gracefully — connection is NOT evicted, breaker records success.
  const fixture = await startFailAfterInit();
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'lr-ep', name: 'LR EP', type: 'remote', access: 'read', category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    const result = await proxy.listResources('lr-ep');
    assert.deepEqual(result.resources, []);
    assert.deepEqual(result.templates, []);
    // connection must survive (not evicted) — allSettled handles partial failures gracefully
    assert.equal(proxy.getStatus('lr-ep').connected, true, 'connection must survive allSettled partial failure');
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});

test('listPrompts: transport throw after connect → [] + connection evicted', async () => {
  const fixture = await startFailAfterInit();
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'lp-ep', name: 'LP EP', type: 'remote', access: 'read', category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    // initialize succeeds, prompts/list → 500 → SDK throws
    const result = await proxy.listPrompts('lp-ep');
    assert.deepEqual(result, []);
    assert.equal(proxy.getStatus('lp-ep').connected, false, 'connection must be evicted after listPrompts error');
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});

// ---------------------------------------------------------------------------
// Tests 5–6: unknown-server fast-returns (config not present)
// ---------------------------------------------------------------------------

test('listResources: unknown server returns empty immediately', async () => {
  const proxy = new RemoteProxy();
  const result = await proxy.listResources('not-registered-lr');
  assert.deepEqual(result.resources, []);
  assert.deepEqual(result.templates, []);
});

test('listPrompts: unknown server returns empty immediately', async () => {
  const proxy = new RemoteProxy();
  const result = await proxy.listPrompts('not-registered-lp');
  assert.deepEqual(result, []);
});

// ---------------------------------------------------------------------------
// Tests 7–8: circuit-open fast-returns
// ---------------------------------------------------------------------------

test('listResources: circuit open returns empty immediately', async () => {
  const proxy = new RemoteProxy();
  try {
    await openCircuit(proxy, 'lr-open');
    const result = await proxy.listResources('lr-open');
    assert.deepEqual(result.resources, []);
    assert.deepEqual(result.templates, []);
  } finally {
    await proxy.shutdown();
  }
});

test('listPrompts: circuit open returns empty immediately', async () => {
  const proxy = new RemoteProxy();
  try {
    await openCircuit(proxy, 'lp-open');
    const result = await proxy.listPrompts('lp-open');
    assert.deepEqual(result, []);
  } finally {
    await proxy.shutdown();
  }
});
