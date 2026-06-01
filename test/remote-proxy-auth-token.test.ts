/**
 * PP: RemoteProxy auth-token cache paths — getAuthToken cache hit/miss/expired.
 *
 * Covered paths (remote-proxy.ts:43–73):
 *   1. Cache hit: unexpired pre-populated entry → cached token sent in
 *      Authorization header; chitty-mcp-token exec is never attempted.
 *   2. No cache + chitty-mcp-token unavailable → auth_token_unavailable →
 *      listTools returns [] + connection not established.
 *   3. Expired cache entry → code falls through to exec → same unavailable
 *      path → listTools returns [] (expired entries are not used).
 *   4. Each auth failure increments the circuit breaker failure counter, so
 *      repeated auth errors eventually open the circuit.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { RemoteProxy } from '../src/remote-proxy.js';

// ---------------------------------------------------------------------------
// Minimal MCP fixture that captures request headers and handles initialize +
// tools/list so the SDK can complete the connection handshake.
// ---------------------------------------------------------------------------

interface HeaderCaptureMcp {
  port: number;
  receivedHeaders: Array<Record<string, string>>;
  stop: () => Promise<void>;
}

async function startHeaderCaptureMcp(): Promise<HeaderCaptureMcp> {
  const receivedHeaders: Array<Record<string, string>> = [];

  const server: HttpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const hdrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') hdrs[k.toLowerCase()] = v;
      else if (Array.isArray(v)) hdrs[k.toLowerCase()] = v.join(',');
    }
    receivedHeaders.push(hdrs);

    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      let body: { method: string; id?: number | string } = { method: '' };
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body;
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }
      const { method, id } = body;

      // Notifications have no id — ack without counting
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
            serverInfo: { name: 'auth-pp-fixture', version: '1.0' },
          };
          break;
        case 'tools/list':
          result = {
            tools: [{ name: 'ping', description: 'Ping', inputSchema: { type: 'object', properties: {} } }],
          };
          break;
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
    receivedHeaders,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// ---------------------------------------------------------------------------
// 1. Cache hit: pre-populated unexpired token sent in Authorization header
// ---------------------------------------------------------------------------

test('authTokenKey cache hit: pre-cached token used, connection succeeds with correct header', async () => {
  const fixture = await startHeaderCaptureMcp();
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'cached-tok',
      name: 'Cached Token',
      type: 'remote',
      access: 'read',
      category: 'code',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
      authTokenKey: 'would-fail-exec',  // exec path never reached — cache is hit first
    });
    // Simulate a prior successful token retrieval by pre-populating the cache
    (proxy as any).tokenCaches.set('cached-tok', {
      token: 'pre-cached-value',
      expiresAt: Date.now() + 99_999,
    });

    const tools = await proxy.listTools('cached-tok');

    // Connection must succeed and return real tools from the fixture
    assert.ok(tools.length > 0, `expected tools from fixture; got: ${JSON.stringify(tools)}`);

    // The cached token must appear in the Authorization header of at least one request
    const authHeaders = fixture.receivedHeaders.map((h) => h['authorization']).filter(Boolean);
    assert.ok(
      authHeaders.some((h) => h === 'Bearer pre-cached-value'),
      `expected 'Bearer pre-cached-value' in one of the requests; got: ${JSON.stringify(authHeaders)}`,
    );

    assert.equal(proxy.getStatus('cached-tok').connected, true, 'connection must be established');
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});

// ---------------------------------------------------------------------------
// 2. No cache, chitty-mcp-token unavailable → auth_token_unavailable
// ---------------------------------------------------------------------------

test('authTokenKey no cache, chitty-mcp-token unavailable → listTools returns []', async () => {
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'no-cache-tok',
      name: 'No Cache Token',
      type: 'remote',
      access: 'read',
      category: 'code',
      // endpoint is irrelevant — doConnect throws before the network call
      endpoint: 'http://127.0.0.1:1/mcp',
      authTokenKey: 'nonexistent-auth-key',
    });

    const tools = await proxy.listTools('no-cache-tok');

    assert.deepEqual(tools, [], 'auth_token_unavailable must cause listTools to return []');
    assert.equal(proxy.getStatus('no-cache-tok').connected, false, 'connection must not be established');
  } finally {
    await proxy.shutdown();
  }
});

// ---------------------------------------------------------------------------
// 3. Expired cache: code falls through to exec → same unavailable path
// ---------------------------------------------------------------------------

test('authTokenKey expired cache: re-tries exec → auth_token_unavailable → listTools returns []', async () => {
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'expired-tok',
      name: 'Expired Token',
      type: 'remote',
      access: 'read',
      category: 'code',
      endpoint: 'http://127.0.0.1:1/mcp',
      authTokenKey: 'expired-auth-key',
    });
    // Plant an expired entry (expiresAt in the past → cache miss → falls through to exec)
    (proxy as any).tokenCaches.set('expired-tok', {
      token: 'stale-token',
      expiresAt: Date.now() - 1,
    });

    const tools = await proxy.listTools('expired-tok');

    assert.deepEqual(tools, [], 'expired cache entry must trigger re-exec → fail → []');
    assert.equal(proxy.getStatus('expired-tok').connected, false, 'connection must not be established');
  } finally {
    await proxy.shutdown();
  }
});

// ---------------------------------------------------------------------------
// 4. Auth failures increment the circuit breaker failure counter
// ---------------------------------------------------------------------------

test('authTokenKey auth failure: each listTools failure advances circuit breaker failure count', async () => {
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'circuit-tok',
      name: 'Circuit Token',
      type: 'remote',
      access: 'read',
      category: 'code',
      endpoint: 'http://127.0.0.1:1/mcp',
      authTokenKey: 'circuit-key',
    });

    // Two failures must advance the circuit failure counter
    await proxy.listTools('circuit-tok');
    await proxy.listTools('circuit-tok');

    const state = (proxy as any).breaker.getState('circuit-tok');
    assert.ok(
      state.failures >= 2,
      `expected circuit failures >= 2 after 2 auth errors; got ${state.failures}`,
    );
  } finally {
    await proxy.shutdown();
  }
});
