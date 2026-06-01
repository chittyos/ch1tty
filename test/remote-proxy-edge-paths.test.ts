// Tests for RemoteProxy paths not covered by prior suites (NN):
//   1. readResource: unregistered server → throws "Unknown remote server"
//   2. getPrompt: unregistered server → throws "Unknown remote server"
//   3. getPrompt: arguments forwarded to the remote server verbatim
//   4. getStatus: connected via readResource but no tool cache → toolCount=0, toolCacheAge=null
//   5. callTool: circuit-open error message contains the serverId
//   6. listTools: unregistered server → returns [] immediately (config fast-return)
// All tests use a real local HTTP fixture or refused port — no behaviour mocks.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { RemoteProxy } from '../src/remote-proxy.js';

// ---------------------------------------------------------------------------
// Minimal Streamable-HTTP fixture: handles initialize + method dispatch.
// ---------------------------------------------------------------------------

interface FixtureOpts {
  readResourceFn?: (uri: string) => { contents: Array<{ uri: string; mimeType?: string; text?: string }> };
  getPromptFn?: (name: string, args?: Record<string, string>) => {
    description?: string;
    messages: Array<{ role: string; content: { type: string; text: string } }>;
  };
}

async function startMcpFixture(opts: FixtureOpts = {}): Promise<{ port: number; stop: () => Promise<void> }> {
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
            capabilities: { tools: {}, resources: {}, prompts: {} },
            serverInfo: { name: 'nn-fixture', version: '1.0' },
          };
          break;
        case 'tools/list':
          result = { tools: [] };
          break;
        case 'resources/list':
          result = { resources: [], resourceTemplates: [] };
          break;
        case 'prompts/list':
          result = { prompts: [] };
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

// Drive 5 ECONNREFUSED calls on port 1 to open the circuit breaker (threshold=5).
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
// Tests 1–2: unregistered-server throw paths (config fast-path not present)
// ---------------------------------------------------------------------------

test('readResource: unregistered server throws Unknown remote server', async () => {
  const proxy = new RemoteProxy();
  try {
    await assert.rejects(
      () => proxy.readResource('not-registered-rr', 'test://doc'),
      /Unknown remote server/,
    );
  } finally {
    await proxy.shutdown();
  }
});

test('getPrompt: unregistered server throws Unknown remote server', async () => {
  const proxy = new RemoteProxy();
  try {
    await assert.rejects(
      () => proxy.getPrompt('not-registered-gp', 'myPrompt'),
      /Unknown remote server/,
    );
  } finally {
    await proxy.shutdown();
  }
});

// ---------------------------------------------------------------------------
// Test 3: argument passthrough verification
// ---------------------------------------------------------------------------

test('getPrompt: arguments forwarded to the remote server verbatim', async () => {
  let capturedArgs: Record<string, string> | undefined;
  const fixture = await startMcpFixture({
    getPromptFn: (_name, args) => {
      capturedArgs = args;
      return { messages: [{ role: 'user', content: { type: 'text', text: 'ok' } }] };
    },
  });
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'gp-args', name: 'GP Args', type: 'remote', access: 'read', category: 'knowledge',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    await proxy.getPrompt('gp-args', 'myPrompt', { lang: 'fr', format: 'short' });
    assert.deepEqual(capturedArgs, { lang: 'fr', format: 'short' });
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});

// ---------------------------------------------------------------------------
// Test 4: getStatus after connection via readResource (no listTools called)
// ---------------------------------------------------------------------------

test('getStatus: connected via readResource, no listTools → toolCount=0 toolCacheAge=null', async () => {
  const fixture = await startMcpFixture({
    readResourceFn: (uri) => ({ contents: [{ uri, text: 'hello' }] }),
  });
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'status-notoolcache', name: 'No Tool Cache', type: 'remote', access: 'read', category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    await proxy.readResource('status-notoolcache', 'test://doc');
    const status = proxy.getStatus('status-notoolcache');
    assert.equal(status.connected, true);
    assert.equal(status.toolCount, 0);
    assert.equal(status.toolCacheAge, null);
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});

// ---------------------------------------------------------------------------
// Test 5: circuit-open error message contains serverId
// ---------------------------------------------------------------------------

test('callTool: circuit-open error message contains serverId', async () => {
  const proxy = new RemoteProxy();
  try {
    await openCircuit(proxy, 'ct-circuit-id');
    const result = await proxy.callTool('ct-circuit-id', 'ping', {});
    assert.equal(result.isError, true);
    assert.ok(result.content.length > 0, 'error result must have content');
    assert.ok(
      (result.content[0].text as string).includes('ct-circuit-id'),
      `error message should contain serverId, got: ${result.content[0].text as string}`,
    );
    assert.match(result.content[0].text as string, /circuit open/i);
  } finally {
    await proxy.shutdown();
  }
});

// ---------------------------------------------------------------------------
// Test 6: listTools config fast-return for unregistered server
// ---------------------------------------------------------------------------

test('listTools: unregistered server returns empty array immediately', async () => {
  const proxy = new RemoteProxy();
  try {
    const result = await proxy.listTools('not-registered-lt');
    assert.deepEqual(result, []);
  } finally {
    await proxy.shutdown();
  }
});
