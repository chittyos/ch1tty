// Tests for RemoteProxy paths not covered by prior suites:
//   callTool success path, callTool circuit-open, listResources with templates,
//   listTools/listResources/listPrompts cache-hit paths.
// All tests use a real local HTTP server — no mocks.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { RemoteProxy } from '../src/remote-proxy.js';

// ---------------------------------------------------------------------------
// Fixture: real Streamable-HTTP MCP server with per-method request counting
// ---------------------------------------------------------------------------

interface FixtureOpts {
  tools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  resources?: Array<{ uri: string; name: string; mimeType?: string }>;
  resourceTemplates?: Array<{ uriTemplate: string; name: string; description?: string; mimeType?: string }>;
  prompts?: Array<{ name: string; description?: string }>;
  callToolFn?: (name: string, args: Record<string, unknown>) => {
    content: Array<{ type: string; text?: string }>;
  };
}

interface McpFixture {
  port: number;
  requestCounts: Map<string, number>;
  stop: () => Promise<void>;
}

async function startMcpFixture(opts: FixtureOpts = {}): Promise<McpFixture> {
  const tools = opts.tools ?? [];
  const resources = opts.resources ?? [];
  const resourceTemplates = opts.resourceTemplates ?? [];
  const prompts = opts.prompts ?? [];
  const requestCounts = new Map<string, number>();

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

      // Notifications (no id) — ack without incrementing counts
      if (id === undefined) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }

      requestCounts.set(method, (requestCounts.get(method) ?? 0) + 1);

      let result: unknown;
      switch (method) {
        case 'initialize':
          result = {
            protocolVersion: '2025-11-25',
            capabilities: { tools: {}, resources: {}, prompts: {} },
            serverInfo: { name: 'fixture-ll', version: '1.0' },
          };
          break;
        case 'tools/list':
          result = { tools };
          break;
        case 'tools/call': {
          const name = String((params as { name: string }).name ?? '');
          const args = ((params as { arguments?: Record<string, unknown> }).arguments ?? {}) as Record<string, unknown>;
          result = opts.callToolFn?.(name, args) ?? { content: [{ type: 'text', text: `called ${name}` }] };
          break;
        }
        case 'resources/list':
          result = { resources };
          break;
        case 'resources/templates/list':
          result = { resourceTemplates };
          break;
        case 'prompts/list':
          result = { prompts };
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
    requestCounts,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// Drive 5 ECONNREFUSED calls to open the circuit breaker (threshold = 5).
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
// callTool success path
// ---------------------------------------------------------------------------

test('callTool success: returns normalized result and sets isError=false', async () => {
  const fixture = await startMcpFixture({
    tools: [{ name: 'ping', description: 'Ping', inputSchema: { type: 'object', properties: {} } }],
    callToolFn: () => ({ content: [{ type: 'text', text: 'pong' }] }),
  });
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'ct', name: 'CT', type: 'remote', access: 'read', category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    const result = await proxy.callTool('ct', 'ping', {});
    assert.equal(result.isError, false);
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].text, 'pong');
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});

test('callTool success: passes arguments through to the remote tool', async () => {
  let capturedArgs: Record<string, unknown> | undefined;
  const fixture = await startMcpFixture({
    tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object', properties: {} } }],
    callToolFn: (_name, args) => {
      capturedArgs = args;
      return { content: [{ type: 'text', text: 'ok' }] };
    },
  });
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'ct2', name: 'CT2', type: 'remote', access: 'read', category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    await proxy.callTool('ct2', 'echo', { foo: 'bar', num: 42 });
    assert.deepEqual(capturedArgs, { foo: 'bar', num: 42 });
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});

test('callTool returns isError when circuit is open', async () => {
  const proxy = new RemoteProxy();
  try {
    await openCircuit(proxy, 'dead-ct');
    const result = await proxy.callTool('dead-ct', 'ping', {});
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /circuit open/);
  } finally {
    await proxy.shutdown();
  }
});

// ---------------------------------------------------------------------------
// listResources with resource templates
// ---------------------------------------------------------------------------

test('listResources returns both resources and templates from real endpoint', async () => {
  const fixture = await startMcpFixture({
    resources: [{ uri: 'file://readme.md', name: 'README', mimeType: 'text/markdown' }],
    resourceTemplates: [
      {
        uriTemplate: 'file://{path}',
        name: 'File by path',
        description: 'Fetch any file by path',
        mimeType: 'text/plain',
      },
    ],
  });
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'lr', name: 'LR', type: 'remote', access: 'read', category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    const result = await proxy.listResources('lr');

    assert.equal(result.resources.length, 1);
    assert.equal(result.resources[0].uri, 'file://readme.md');
    assert.equal(result.resources[0].name, 'README');
    assert.equal(result.resources[0].mimeType, 'text/markdown');

    assert.equal(result.templates.length, 1);
    assert.equal(result.templates[0].uriTemplate, 'file://{path}');
    assert.equal(result.templates[0].name, 'File by path');
    assert.equal(result.templates[0].description, 'Fetch any file by path');
    assert.equal(result.templates[0].mimeType, 'text/plain');
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});

// ---------------------------------------------------------------------------
// Cache-hit paths: listTools, listResources, listPrompts
// ---------------------------------------------------------------------------

test('listTools: second call hits cache — server receives tools/list only once', async () => {
  const fixture = await startMcpFixture({
    tools: [{ name: 'x', description: 'X', inputSchema: { type: 'object', properties: {} } }],
  });
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'cache-lt', name: 'Cache LT', type: 'remote', access: 'read', category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    const first = await proxy.listTools('cache-lt');
    const second = await proxy.listTools('cache-lt');
    assert.deepEqual(first, second);
    assert.equal(
      fixture.requestCounts.get('tools/list'),
      1,
      'tools/list should be fetched once; second call uses cache',
    );
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});

test('listResources: second call hits cache — server receives resources/list only once', async () => {
  const fixture = await startMcpFixture({
    resources: [{ uri: 'res://a', name: 'A' }],
  });
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'cache-lr', name: 'Cache LR', type: 'remote', access: 'read', category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    const first = await proxy.listResources('cache-lr');
    const second = await proxy.listResources('cache-lr');
    assert.equal(first.resources.length, 1);
    assert.deepEqual(first.resources, second.resources);
    assert.equal(
      fixture.requestCounts.get('resources/list'),
      1,
      'resources/list should be fetched once; second call uses cache',
    );
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});

test('listPrompts: second call hits cache — server receives prompts/list only once', async () => {
  const fixture = await startMcpFixture({
    prompts: [{ name: 'greet', description: 'Greet user' }],
  });
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'cache-lp', name: 'Cache LP', type: 'remote', access: 'read', category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    const first = await proxy.listPrompts('cache-lp');
    const second = await proxy.listPrompts('cache-lp');
    assert.equal(first.length, 1);
    assert.deepEqual(first, second);
    assert.equal(
      fixture.requestCounts.get('prompts/list'),
      1,
      'prompts/list should be fetched once; second call uses cache',
    );
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});
