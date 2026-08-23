// Regression: doConnect() must release the client AND transport when the
// initialize handshake fails.
//
// Before the fix, doConnect() built a StreamableHTTPClientTransport and a Client,
// then awaited client.connect(transport). If that rejected — which is exactly what
// Cloudflare Access does with HTTP 401 when a service token is rejected — neither
// object was ever closed. connect()'s catch block deletes from this.connections,
// but the connection is only STORED on success, so that delete is a no-op and the
// failed pair became unreachable. evict() never sees it.
//
// StreamableHTTPClientTransport registers abort/stream listeners on construction,
// so every failed attempt leaked a set. In production this reached ~1,694 abort
// listeners against a 1,500 MaxListeners ceiling before the process exited 0 —
// and because the unit is Restart=on-failure, systemd correctly declined to
// restart a clean exit. The result was a 13-day silent outage.
//
// Uses a real local HTTP fixture returning 401, matching the no-behaviour-mocks
// convention of the sibling suites. The SDK close() methods are wrapped only to
// COUNT invocations — the code path, the server and the failure are all real.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { RemoteProxy } from '../src/remote-proxy.js';

/** Fixture: rejects every request with 401, as Cloudflare Access does. */
async function start401(): Promise<{ port: number; stop: () => Promise<void> }> {
  const server: HttpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    req.resume();
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// CHARACTERIZATION, not a regression test. It documents SDK behaviour this module
// relies on: @modelcontextprotocol/sdk 1.29.0 closes BOTH the client and the
// transport exactly once when client.connect() rejects. Measured 2026-08-23.
//
// This matters because a code-reading audit claimed doConnect() leaked a
// client/transport pair on every failed connect, and attributed a 13-day outage
// (~1,694 abort listeners vs a 1,500 ceiling) to it. Measurement refuted that:
// 5 failed attempts produce exactly 5 client closes and 5 transport closes with
// no cleanup code of our own. Adding one double-closes and fixes nothing.
//
// If a future SDK upgrade stops cleaning up, this test fails and the leak
// hypothesis becomes live again — at which point cleanup belongs in doConnect().
// The real source of the production listener growth remains UNRESOLVED.
test('SDK closes client and transport exactly once per failed connect', async () => {
  const fixture = await start401();

  const realClientClose = Client.prototype.close;
  const realTransportClose = StreamableHTTPClientTransport.prototype.close;
  let clientCloses = 0;
  let transportCloses = 0;

  Client.prototype.close = function (this: Client) {
    clientCloses++;
    return realClientClose.call(this);
  };
  StreamableHTTPClientTransport.prototype.close = function (this: StreamableHTTPClientTransport) {
    transportCloses++;
    return realTransportClose.call(this);
  };

  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'leak-401', name: 'Leak 401', type: 'remote', access: 'read', category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });

    const ATTEMPTS = 5;
    for (let i = 0; i < ATTEMPTS; i++) {
      // listTools swallows connect errors and returns []; the cleanup is what matters.
      await proxy.listTools('leak-401');
    }

    assert.equal(proxy.getStatus('leak-401').connected, false, 'a 401 must not leave a stored connection');
    // Exactly once — not "at least once". A count above ATTEMPTS means someone
    // added redundant cleanup; below means the SDK stopped cleaning up and a real
    // leak now exists.
    assert.equal(clientCloses, ATTEMPTS,
      `expected exactly ${ATTEMPTS} client closes, got ${clientCloses}`);
    assert.equal(transportCloses, ATTEMPTS,
      `expected exactly ${ATTEMPTS} transport closes, got ${transportCloses}`);
  } finally {
    Client.prototype.close = realClientClose;
    StreamableHTTPClientTransport.prototype.close = realTransportClose;
    await proxy.shutdown();
    await fixture.stop();
  }
});

test('repeated connect failures emit no MaxListenersExceededWarning', async () => {
  const fixture = await start401();
  const warnings: string[] = [];
  const onWarning = (w: Error) => { if (w.name === 'MaxListenersExceededWarning') warnings.push(w.message); };
  process.on('warning', onWarning);

  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'leak-warn', name: 'Leak Warn', type: 'remote', access: 'read', category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    for (let i = 0; i < 25; i++) await proxy.listTools('leak-warn');
    await new Promise((r) => setTimeout(r, 50)); // warnings are emitted asynchronously
    assert.deepEqual(warnings, [], `listener leak detected: ${warnings.join(' | ')}`);
  } finally {
    process.off('warning', onWarning);
    await proxy.shutdown();
    await fixture.stop();
  }
});

test('credential material never appears in connect diagnostics', async () => {
  // The diagnostic logs previously printed 8- and 4-char prefixes of the CF-Access
  // client id, client secret and bearer token. Those prefixes persisted in the
  // service journal and were later used to fingerprint which credentials were live.
  const fixture = await start401();
  const proxy = new RemoteProxy();
  // logger.ts writes with process.stderr.write, NOT console.error. An earlier
  // version of this test hooked console.error, captured nothing, and passed
  // whether or not the prefixes were logged.
  const captured: string[] = [];
  const realWrite = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: unknown }).write = ((chunk: unknown, ...rest: unknown[]) => {
    captured.push(String(chunk));
    return (realWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as unknown as typeof process.stderr.write;
  try {
    proxy.registerServer({
      id: 'leak-log', name: 'Leak Log', type: 'remote', access: 'read', category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
      headers: {
        'CF-Access-Client-Id': 'AAAAAAAAAAAAAAAAAAAAAAAA',
        'CF-Access-Client-Secret': 'BBBBBBBBBBBBBBBBBBBBBBBB',
      },
    });
    await proxy.listTools('leak-log');
    const all = captured.join('\n');
    assert.ok(!all.includes('AAAAAAAA'), 'client id prefix leaked into diagnostics');
    assert.ok(!all.includes('BBBB'), 'client secret prefix leaked into diagnostics');
  } finally {
    (process.stderr as unknown as { write: unknown }).write = realWrite;
    await proxy.shutdown();
    await fixture.stop();
  }
});
