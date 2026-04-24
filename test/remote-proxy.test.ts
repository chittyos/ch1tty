import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { RemoteProxy } from '../src/remote-proxy.js';

// Real local HTTP server — every remote-proxy test dials this at 127.0.0.1:<ephemeral>.
// No globalThis.fetch monkey-patching, no mocks, no stubs. The SDK sends real HTTP.
interface LocalMcp {
  server: HttpServer;
  port: number;
  received: Array<{ method: string; headers: Record<string, string>; body: string }>;
  stop: () => Promise<void>;
}

async function startLocalMcp(): Promise<LocalMcp> {
  const received: LocalMcp['received'] = [];

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const normalizedHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') normalizedHeaders[k.toLowerCase()] = v;
        else if (Array.isArray(v)) normalizedHeaders[k.toLowerCase()] = v.join(',');
      }
      received.push({ method: req.method ?? 'GET', headers: normalizedHeaders, body });
      // Default: respond with 502 so the SDK raises a structured error.
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('default-502');
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const addr = server.address() as AddressInfo;

  return {
    server,
    port: addr.port,
    received,
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

test('callTool returns error for unknown server', async () => {
  const proxy = new RemoteProxy();
  const result = await proxy.callTool('nonexistent', 'do_work', {});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Unknown remote server/);
  await proxy.shutdown();
});

test('isRegistered returns false for unregistered servers', async () => {
  const proxy = new RemoteProxy();
  assert.equal(proxy.isRegistered('nope'), false);
  await proxy.shutdown();
});

test('isRegistered returns true for registered servers', async () => {
  const proxy = new RemoteProxy();
  proxy.registerServer({
    id: 'remote', name: 'Remote', type: 'remote', access: 'read', category: 'search',
    endpoint: 'http://127.0.0.1:1/mcp',
  });
  assert.equal(proxy.isRegistered('remote'), true);
  await proxy.shutdown();
});

test('listTools returns empty array for server without endpoint', async () => {
  const proxy = new RemoteProxy();
  proxy.registerServer({
    id: 'noep', name: 'No Endpoint', type: 'remote', access: 'read', category: 'search',
  });
  const tools = await proxy.listTools('noep');
  assert.deepEqual(tools, []);
  await proxy.shutdown();
});

test('getStatus returns disconnected for unconnected server', async () => {
  const proxy = new RemoteProxy();
  proxy.registerServer({
    id: 'remote', name: 'Remote', type: 'remote', access: 'read', category: 'search',
    endpoint: 'http://127.0.0.1:1/mcp',
  });
  const status = proxy.getStatus('remote');
  assert.equal(status.connected, false);
  assert.equal(status.toolCount, 0);
  assert.equal(status.toolCacheAge, null);
  await proxy.shutdown();
});

test('callTool returns structured error when real server returns 502', async () => {
  const mcp = await startLocalMcp();
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'remote', name: 'Remote', type: 'remote', access: 'read', category: 'search',
      endpoint: `http://127.0.0.1:${mcp.port}/mcp`,
    });
    const result = await proxy.callTool('remote', 'do_work', { foo: 'bar' });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Remote call error:/);
  } finally {
    await proxy.shutdown();
    await mcp.stop();
  }
});

test('headers from config are sent to the real remote endpoint', async () => {
  const mcp = await startLocalMcp();
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'hdr', name: 'Header Test', type: 'remote', access: 'read', category: 'search',
      endpoint: `http://127.0.0.1:${mcp.port}/mcp`,
      headers: { 'X-Custom-Header': 'static-value' },
    });
    await proxy.callTool('hdr', 'any_tool', {});
    assert.ok(mcp.received.length > 0, 'expected at least one request');
    assert.equal(mcp.received[0].headers['x-custom-header'], 'static-value');
  } finally {
    await proxy.shutdown();
    await mcp.stop();
  }
});

test('envHeaders from config are resolved from environment and sent', async () => {
  const originalEnv = process.env['TEST_PROXY_TOKEN'];
  process.env['TEST_PROXY_TOKEN'] = 'env-resolved-token';
  const mcp = await startLocalMcp();
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'envhdr', name: 'Env Header Test', type: 'remote', access: 'read', category: 'search',
      endpoint: `http://127.0.0.1:${mcp.port}/mcp`,
      envHeaders: { Authorization: 'TEST_PROXY_TOKEN' },
    });
    await proxy.callTool('envhdr', 'any_tool', {});
    assert.ok(mcp.received.length > 0, 'expected at least one request');
    assert.equal(mcp.received[0].headers['authorization'], 'env-resolved-token');
  } finally {
    await proxy.shutdown();
    await mcp.stop();
    if (originalEnv === undefined) delete process.env['TEST_PROXY_TOKEN'];
    else process.env['TEST_PROXY_TOKEN'] = originalEnv;
  }
});

test('explicit Authorization in envHeaders is not overwritten by authTokenKey', async () => {
  process.env['STATIC_AUTH_TOKEN'] = 'explicit-bearer';
  const mcp = await startLocalMcp();
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'nooverwrite', name: 'No Overwrite', type: 'remote', access: 'read', category: 'search',
      endpoint: `http://127.0.0.1:${mcp.port}/mcp`,
      envHeaders: { Authorization: 'STATIC_AUTH_TOKEN' },
    });
    await proxy.callTool('nooverwrite', 'any_tool', {});
    assert.ok(mcp.received.length > 0);
    assert.equal(mcp.received[0].headers['authorization'], 'explicit-bearer');
  } finally {
    await proxy.shutdown();
    await mcp.stop();
    delete process.env['STATIC_AUTH_TOKEN'];
  }
});
