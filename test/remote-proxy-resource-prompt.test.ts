// Tests for RemoteProxy paths not covered by remote-proxy.test.ts:
//   readResource, getPrompt, listPrompts, getStatus after connection, circuit-open paths, shutdown.
// All tests use a real local HTTP server or a refused-port endpoint — no behaviour mocks.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { RemoteProxy } from '../src/remote-proxy.js';

// ---------------------------------------------------------------------------
// Minimal JSON-RPC 2.0 / Streamable-HTTP fixture (no SSE — plain application/json)
// ---------------------------------------------------------------------------

interface FixtureOpts {
  tools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  resources?: Array<{ uri: string; name: string; mimeType?: string }>;
  prompts?: Array<{ name: string; description?: string; arguments?: Array<{ name: string; required?: boolean }> }>;
  readResourceFn?: (uri: string) => { contents: Array<{ uri: string; mimeType?: string; text?: string }> };
  getPromptFn?: (name: string, args?: Record<string, string>) => {
    description?: string;
    messages: Array<{ role: string; content: { type: string; text: string } }>;
  };
  /** Return HTTP 500 for every request except initialize (to test error paths). */
  failNonInit?: boolean;
}

interface McpFixture {
  port: number;
  stop: () => Promise<void>;
}

async function startMcpFixture(opts: FixtureOpts = {}): Promise<McpFixture> {
  const tools = opts.tools ?? [];
  const resources = opts.resources ?? [];
  const prompts = opts.prompts ?? [];

  const server: HttpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST') {
      // GET (SSE probe) — return 405; onerror fires but connect() already returned successfully
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

      // Notifications have no id — respond 200 so SDK does NOT trigger SSE reconnect (202 would)
      if (id === undefined) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }

      if (opts.failNonInit && method !== 'initialize') {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'forced-failure' }, id }));
        return;
      }

      let result: unknown;
      switch (method) {
        case 'initialize':
          result = {
            protocolVersion: '2025-11-25',
            capabilities: { tools: {}, resources: {}, prompts: {} },
            serverInfo: { name: 'fixture', version: '1.0' },
          };
          break;
        case 'tools/list':
          result = { tools };
          break;
        case 'resources/list':
          result = { resources, resourceTemplates: [] };
          break;
        case 'prompts/list':
          result = { prompts };
          break;
        case 'resources/read': {
          const uri = String((params as { uri: string }).uri ?? '');
          result = opts.readResourceFn?.(uri) ?? { contents: [] };
          break;
        }
        case 'prompts/get': {
          const name = String((params as { name: string }).name ?? '');
          const args = (params as { arguments?: Record<string, string> }).arguments;
          result = opts.getPromptFn?.(name, args) ?? { messages: [] };
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
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// Open the circuit breaker (threshold=5) by driving 5 failed callTool calls.
// Port 1 gives ECONNREFUSED immediately — fast, no timeouts.
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
// Tests
// ---------------------------------------------------------------------------

test('readResource returns mapped text contents from real endpoint', async () => {
  const fixture = await startMcpFixture({
    readResourceFn: (uri) => ({
      contents: [{ uri, mimeType: 'text/plain', text: 'hello world' }],
    }),
  });
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'rr', name: 'RR', type: 'remote', access: 'read', category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    const result = await proxy.readResource('rr', 'test://doc');
    assert.equal(result.contents.length, 1);
    assert.equal(result.contents[0].uri, 'test://doc');
    assert.equal(result.contents[0].text, 'hello world');
    assert.equal(result.contents[0].mimeType, 'text/plain');
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});

test('readResource throws when circuit is open', async () => {
  const proxy = new RemoteProxy();
  await openCircuit(proxy, 'dead-rr');
  await assert.rejects(
    () => proxy.readResource('dead-rr', 'test://doc'),
    /circuit open/,
  );
  await proxy.shutdown();
});

test('readResource throws on transport error and evicts connection', async () => {
  const fixture = await startMcpFixture({ failNonInit: true });
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'rr-fail', name: 'RR Fail', type: 'remote', access: 'read', category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    await assert.rejects(() => proxy.readResource('rr-fail', 'test://doc'));
    // Connection evicted on error — getStatus reports disconnected
    assert.equal(proxy.getStatus('rr-fail').connected, false);
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});

test('getPrompt returns description and messages from real endpoint', async () => {
  const fixture = await startMcpFixture({
    getPromptFn: (name) => ({
      description: `Prompt: ${name}`,
      messages: [{ role: 'user', content: { type: 'text', text: 'How are you?' } }],
    }),
  });
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'gp', name: 'GP', type: 'remote', access: 'read', category: 'knowledge',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    const result = await proxy.getPrompt('gp', 'greet', { lang: 'en' });
    assert.equal(result.description, 'Prompt: greet');
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].role, 'user');
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});

test('getPrompt throws when circuit is open', async () => {
  const proxy = new RemoteProxy();
  await openCircuit(proxy, 'dead-gp');
  await assert.rejects(
    () => proxy.getPrompt('dead-gp', 'test'),
    /circuit open/,
  );
  await proxy.shutdown();
});

test('getPrompt throws on transport error and evicts connection', async () => {
  const fixture = await startMcpFixture({ failNonInit: true });
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'gp-fail', name: 'GP Fail', type: 'remote', access: 'read', category: 'knowledge',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    await assert.rejects(() => proxy.getPrompt('gp-fail', 'test'));
    assert.equal(proxy.getStatus('gp-fail').connected, false);
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});

test('getStatus reports connected=true and toolCount after successful listTools', async () => {
  const fixture = await startMcpFixture({
    tools: [
      { name: 'search', description: 'Search docs', inputSchema: { type: 'object', properties: {} } },
      { name: 'create', description: 'Create item', inputSchema: { type: 'object', properties: {} } },
    ],
  });
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'status-test', name: 'Status Test', type: 'remote', access: 'read', category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    const tools = await proxy.listTools('status-test');
    assert.equal(tools.length, 2);

    const status = proxy.getStatus('status-test');
    assert.equal(status.connected, true);
    assert.equal(status.toolCount, 2);
    assert.ok(
      typeof status.toolCacheAge === 'number' && status.toolCacheAge >= 0,
      `toolCacheAge should be a non-negative number, got ${String(status.toolCacheAge)}`,
    );
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});

test('listTools returns [] when circuit is open', async () => {
  const proxy = new RemoteProxy();
  await openCircuit(proxy, 'dead-lt');
  const tools = await proxy.listTools('dead-lt');
  assert.deepEqual(tools, []);
  await proxy.shutdown();
});

test('listPrompts returns mapped prompts from real endpoint', async () => {
  const fixture = await startMcpFixture({
    prompts: [
      {
        name: 'summarize',
        description: 'Summarize text',
        arguments: [{ name: 'text', required: true }],
      },
    ],
  });
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'lp', name: 'LP', type: 'remote', access: 'read', category: 'knowledge',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    const prompts = await proxy.listPrompts('lp');
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].name, 'summarize');
    assert.equal(prompts[0].description, 'Summarize text');
    assert.ok(prompts[0].arguments, 'arguments present');
    assert.equal(prompts[0].arguments!.length, 1);
    assert.equal(prompts[0].arguments![0].name, 'text');
    assert.equal(prompts[0].arguments![0].required, true);
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});

test('shutdown closes all connections: getStatus returns disconnected afterward', async () => {
  const fixture = await startMcpFixture({
    tools: [{ name: 'ping', description: 'Ping', inputSchema: { type: 'object', properties: {} } }],
  });
  const proxy = new RemoteProxy();
  proxy.registerServer({
    id: 'shutdown-test', name: 'Shutdown Test', type: 'remote', access: 'read', category: 'storage',
    endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
  });

  // Establish a real connection
  await proxy.listTools('shutdown-test');
  assert.equal(proxy.getStatus('shutdown-test').connected, true);

  // After shutdown all connections are cleared
  await proxy.shutdown();
  assert.equal(proxy.getStatus('shutdown-test').connected, false);

  await fixture.stop();
});
