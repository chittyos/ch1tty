// Tests for QQ: RemoteProxy withTimeout firing on list/call paths.
//
// Distinct from:
//   - MM (error-paths): backend responds 500 → SDK throw (fast failure)
//   - PP (auth-token-cache): getAuthToken cache / exec unavailable
//
// Here the backend accepts 'initialize' (connection established) but then
// never responds to subsequent requests, so withTimeout fires and the catch
// block runs.  CH1TTY_REMOTE_TIMEOUT_MS is set to 100ms so the suite runs
// in ~1s total instead of waiting for 15s/120s production timeouts.
//
// Observable behaviors under test:
//   listTools   → [] + connection evicted
//   callTool    → isError:true, message contains "timed out" + connection evicted
//   listPrompts → [] + connection evicted
//   listResources → empty (allSettled captures timeouts) + connection SURVIVES (circuit success)
//   readResource → re-throws error with "timed out" + connection evicted
//   getPrompt    → re-throws error with "timed out" + connection evicted
//
// All tests use a real local HTTP fixture — no behaviour mocks.

// CH1TTY_REMOTE_TIMEOUT_MS is read at call time (not module load), so setting it
// here before the first proxy call is sufficient — no dynamic import required.
process.env.CH1TTY_REMOTE_TIMEOUT_MS = '100';

import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { RemoteProxy } from '../src/remote-proxy.js';

// ---------------------------------------------------------------------------
// Fixture: responds to initialize normally; hangs on everything else.
// Sockets are tracked so stop() can destroy them immediately, unblocking
// any pending in-flight requests.
// ---------------------------------------------------------------------------

interface HangFixture {
  readonly port: number;
  stop: () => Promise<void>;
}

async function startHangFixture(): Promise<HangFixture> {
  const sockets = new Set<Socket>();

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

      // Notifications (no id) — ack immediately
      if (body.id === undefined) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }

      if (body.method === 'initialize') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0', id: body.id,
          result: {
            protocolVersion: '2025-11-25',
            capabilities: { tools: {}, resources: {}, prompts: {} },
            serverInfo: { name: 'hang-fixture', version: '1.0' },
          },
        }));
        return;
      }

      // All other methods: intentionally hang — never call res.end().
      // The withTimeout wrapper will fire after CH1TTY_REMOTE_TIMEOUT_MS.
    });
  });

  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
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
    stop: () => new Promise<void>((resolve) => {
      // Destroy pending sockets first so hanging requests are unblocked
      for (const s of sockets) s.destroy();
      server.close(() => resolve());
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('listTools: withTimeout fires → [] + connection evicted', async () => {
  const fixture = await startHangFixture();
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'lt-to', name: 'LT Timeout', type: 'remote', access: 'read', category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    const result = await proxy.listTools('lt-to');
    assert.deepEqual(result, [], 'listTools must return [] on timeout');
    assert.equal(proxy.getStatus('lt-to').connected, false, 'connection must be evicted after listTools timeout');
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});

test('callTool: withTimeout fires → isError:true with "timed out" message + connection evicted', async () => {
  const fixture = await startHangFixture();
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'ct-to', name: 'CT Timeout', type: 'remote', access: 'read', category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    const result = await proxy.callTool('ct-to', 'run', { q: 1 });
    assert.equal(result.isError, true, 'callTool must return isError:true on timeout');
    assert.ok(result.content.length > 0, 'content must be populated');
    assert.match(
      result.content[0].text as string,
      /timed out/,
      'error content must reference timeout',
    );
    assert.equal(proxy.getStatus('ct-to').connected, false, 'connection must be evicted after callTool timeout');
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});

test('listResources: withTimeout fires inside allSettled → empty + connection SURVIVES (circuit success)', async () => {
  // listResources wraps both listResources and listResourceTemplates in Promise.allSettled.
  // When both withTimeout calls reject (timeout), allSettled captures them gracefully —
  // the outer catch is NOT reached, so the circuit records SUCCESS and the connection is
  // not evicted.
  const fixture = await startHangFixture();
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'lr-to', name: 'LR Timeout', type: 'remote', access: 'read', category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    const result = await proxy.listResources('lr-to');
    assert.deepEqual(result.resources, [], 'resources must be [] when both timeout');
    assert.deepEqual(result.templates, [], 'templates must be [] when both timeout');
    // The connection must survive — allSettled never reaches the outer catch
    assert.equal(
      proxy.getStatus('lr-to').connected,
      true,
      'connection must survive allSettled timeout (circuit records success)',
    );
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});

test('listPrompts: withTimeout fires → [] + connection evicted', async () => {
  const fixture = await startHangFixture();
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'lp-to', name: 'LP Timeout', type: 'remote', access: 'read', category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    const result = await proxy.listPrompts('lp-to');
    assert.deepEqual(result, [], 'listPrompts must return [] on timeout');
    assert.equal(proxy.getStatus('lp-to').connected, false, 'connection must be evicted after listPrompts timeout');
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});

test('readResource: withTimeout fires → re-throws error with "timed out" + connection evicted', async () => {
  const fixture = await startHangFixture();
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'rr-to', name: 'RR Timeout', type: 'remote', access: 'read', category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    // readResource re-throws on error; assert that the thrown error mentions "timed out"
    await assert.rejects(
      () => proxy.readResource('rr-to', 'file:///test.txt'),
      (err: Error) => {
        assert.match(err.message, /timed out/, 'thrown error must reference timeout');
        return true;
      },
    );
    assert.equal(proxy.getStatus('rr-to').connected, false, 'connection must be evicted after readResource timeout');
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});

test('getPrompt: withTimeout fires → re-throws error with "timed out" + connection evicted', async () => {
  const fixture = await startHangFixture();
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'gp-to', name: 'GP Timeout', type: 'remote', access: 'read', category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    await assert.rejects(
      () => proxy.getPrompt('gp-to', 'system-prompt', {}),
      (err: Error) => {
        assert.match(err.message, /timed out/, 'thrown error must reference timeout');
        return true;
      },
    );
    assert.equal(proxy.getStatus('gp-to').connected, false, 'connection must be evicted after getPrompt timeout');
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});

test('callTool: explicit options.timeoutMs is used (covers remote-proxy.ts:229 left side)', async () => {
  // Existing callTool test calls without options → getCallTimeoutMs() right side of ??.
  // This test passes options: { timeoutMs } → exercises the options?.timeoutMs left side.
  const fixture = await startHangFixture();
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'ct-opts', name: 'CT Options', type: 'remote', access: 'read', category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    const result = await proxy.callTool('ct-opts', 'run', { q: 1 }, { timeoutMs: 50 });
    assert.equal(result.isError, true, 'must be isError:true on timeout');
    assert.match(result.content[0].text as string, /timed out after 50ms/, 'error must reference the per-call timeout (50ms, not the env 100ms fallback)');
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});
