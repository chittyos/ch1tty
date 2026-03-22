import assert from 'node:assert/strict';
import test from 'node:test';
import { RemoteProxy } from '../src/remote-proxy.js';

function registerDefaultServer(proxy: RemoteProxy): void {
  proxy.registerServer({
    id: 'remote',
    name: 'Remote',
    type: 'remote',
    access: 'read',
    category: 'search',
    endpoint: 'https://example.com/mcp',
  });
}

test('callTool returns structured error for failed HTTP responses', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 502, statusText: 'Bad Gateway' });

  try {
    const proxy = new RemoteProxy();
    registerDefaultServer(proxy);

    const result = await proxy.callTool('remote', 'do_work', { foo: 'bar' });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Remote call error:/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('callTool normalizes parse failures into structured MCP errors', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('not-json', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  try {
    const proxy = new RemoteProxy();
    registerDefaultServer(proxy);

    const result = await proxy.callTool('remote', 'do_work', {});
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Remote call error:/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('callTool returns error for unknown server', async () => {
  const proxy = new RemoteProxy();

  const result = await proxy.callTool('nonexistent', 'do_work', {});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Unknown remote server/);
});

test('isRegistered returns false for unregistered servers', () => {
  const proxy = new RemoteProxy();
  assert.equal(proxy.isRegistered('nope'), false);
});

test('isRegistered returns true for registered servers', () => {
  const proxy = new RemoteProxy();
  registerDefaultServer(proxy);
  assert.equal(proxy.isRegistered('remote'), true);
});

test('listTools returns empty array for server without endpoint', async () => {
  const proxy = new RemoteProxy();
  proxy.registerServer({
    id: 'noep',
    name: 'No Endpoint',
    type: 'remote',
    access: 'read',
    category: 'search',
  });

  const tools = await proxy.listTools('noep');
  assert.deepEqual(tools, []);
});

test('getStatus returns disconnected for unconnected server', () => {
  const proxy = new RemoteProxy();
  registerDefaultServer(proxy);

  const status = proxy.getStatus('remote');
  assert.equal(status.connected, false);
  assert.equal(status.toolCount, 0);
  assert.equal(status.toolCacheAge, null);
});
