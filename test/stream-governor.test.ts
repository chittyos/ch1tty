/**
 * StreamGovernor — throttles how fast a remote backend's event stream is reopened.
 *
 * The first test drives the real RemoteProxy and the real MCP SDK transport against a
 * local HTTP fixture whose event stream closes straight away, which is the condition
 * that made one ch1tty process send several GET /mcp per second to one backend. The
 * remaining tests pin the delay arithmetic with an injected clock.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { RemoteProxy } from '../src/remote-proxy.js';
import { StreamGovernor, abortableSleep } from '../src-stdio/stream-governor.js';
import type { FetchLike } from '../src-stdio/stream-governor.js';

/** A minimal MCP server: JSON replies to POST, and an event stream that ends at once. */
function startClosingStreamFixture(): Promise<{ url: string; gets: () => number; close: () => Promise<void> }> {
  let gets = 0;
  const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
      gets += 1;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      // Ask the client to come back in 10ms, then end the stream cleanly.
      res.end('retry: 10\n\n');
      return;
    }
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const msg = JSON.parse(body) as { id?: number; method: string };
      if (msg.id === undefined) {
        res.writeHead(202).end();
        return;
      }
      const result =
        msg.method === 'initialize'
          ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '0' } }
          : { tools: [] };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/mcp`,
        gets: () => gets,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

test('RemoteProxy does not reopen a closing event stream in a tight loop', async () => {
  const fixture = await startClosingStreamFixture();
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'closing-stream',
      name: 'Closing Stream',
      type: 'remote',
      access: 'read',
      category: 'code',
      endpoint: fixture.url,
    });
    await proxy.listTools('closing-stream');
    await new Promise((r) => setTimeout(r, 2_500));

    // Throttled: opens at ~0s and ~1s, the third is held until ~3s.
    // Unthrottled, the SDK reopens every ~10ms: well over 50 opens in this window.
    assert.ok(fixture.gets() >= 1, 'the event stream must still be opened');
    assert.ok(fixture.gets() <= 3, `expected at most 3 stream opens in 2.5s, saw ${fixture.gets()}`);
  } finally {
    await proxy.shutdown();
    await fixture.close();
  }
});

function harness(options: { minHealthyLifetimeMs?: number; initialDelayMs?: number; maxDelayMs?: number; growFactor?: number } = {}) {
  let clock = 0;
  const sleeps: number[] = [];
  const calls: Array<string | undefined> = [];
  const governor = new StreamGovernor('unit', {
    ...options,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
  });
  const base: FetchLike = async (_url, init) => {
    calls.push(init?.method);
    return new Response(null, { status: 200 });
  };
  return { governor, fetch: governor.wrap(base), sleeps, calls, advance: (ms: number) => (clock += ms) };
}

test('first stream open is not delayed', async () => {
  const h = harness();
  await h.fetch('http://x/mcp', { method: 'GET' });
  assert.deepEqual(h.sleeps, []);
  assert.equal(h.governor.consecutiveShortStreams, 0);
});

test('short-lived streams back off exponentially up to the ceiling', async () => {
  const h = harness({ initialDelayMs: 1_000, maxDelayMs: 8_000 });
  for (let i = 0; i < 7; i++) {
    await h.fetch('http://x/mcp', { method: 'GET' });
    h.advance(50); // stream lived 50ms
  }
  assert.deepEqual(h.sleeps, [1_000, 2_000, 4_000, 8_000, 8_000, 8_000]);
  assert.equal(h.governor.consecutiveShortStreams, 6);
});

test('a stream that stays up resets the throttle', async () => {
  const h = harness({ minHealthyLifetimeMs: 30_000 });
  await h.fetch('http://x/mcp', { method: 'GET' });
  h.advance(10);
  await h.fetch('http://x/mcp', { method: 'GET' });
  h.advance(10);
  await h.fetch('http://x/mcp', { method: 'GET' });
  assert.deepEqual(h.sleeps, [1_000, 2_000]);

  h.advance(30_000); // this one stayed up
  await h.fetch('http://x/mcp', { method: 'GET' });
  assert.deepEqual(h.sleeps, [1_000, 2_000], 'no delay after a healthy stream');
  assert.equal(h.governor.consecutiveShortStreams, 0);

  h.advance(10);
  await h.fetch('http://x/mcp', { method: 'GET' });
  assert.deepEqual(h.sleeps, [1_000, 2_000, 1_000], 'backoff starts again from the initial delay');
});

test('requests that are not a stream open are never delayed or counted', async () => {
  const h = harness();
  await h.fetch('http://x/mcp', { method: 'GET' });
  for (let i = 0; i < 5; i++) await h.fetch('http://x/mcp', { method: 'POST', body: '{}' });
  await h.fetch('http://x/mcp', { method: 'DELETE' });
  assert.deepEqual(h.sleeps, []);
  assert.equal(h.governor.consecutiveShortStreams, 0);
  assert.equal(h.calls.length, 7);
});

test('a request with no init, or a lower-case method, counts as a stream open', async () => {
  const h = harness();
  await h.fetch('http://x/mcp');
  await h.fetch('http://x/mcp', { method: 'get' });
  assert.deepEqual(h.sleeps, [1_000]);
});

test('the delay is abandoned when the transport aborts', async () => {
  const governor = new StreamGovernor('abort', { initialDelayMs: 60_000 });
  let fetched = 0;
  const wrapped = governor.wrap(async () => {
    fetched += 1;
    return new Response(null, { status: 200 });
  });
  await wrapped('http://x/mcp', { method: 'GET' });
  const controller = new AbortController();
  const pending = wrapped('http://x/mcp', { method: 'GET', signal: controller.signal });
  controller.abort(new Error('closed'));
  await assert.rejects(pending, /closed/);
  assert.equal(fetched, 1, 'the held stream open must not be sent after abort');
});

test('abortableSleep resolves, and rejects for an already-aborted signal', async () => {
  await abortableSleep(1);
  await abortableSleep(1, null);
  await abortableSleep(1, new AbortController().signal);
  await assert.rejects(abortableSleep(60_000, AbortSignal.abort(new Error('gone'))), /gone/);
});
