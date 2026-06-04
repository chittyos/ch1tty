/**
 * Covers two uncovered branch groups in remote-proxy.ts:
 *
 * 1. getConnectTimeoutMs / getListTimeoutMs / getCallTimeoutMs DEFAULT-VALUE branches
 *    (lines 31–32, 35–36, 39–40):
 *    When CH1TTY_REMOTE_TIMEOUT_MS is unset, `process.env.CH1TTY_REMOTE_TIMEOUT_MS ?? ''`
 *    yields an empty string, `parseInt('')` becomes NaN, NaN is not finite, so the
 *    15_000 / 120_000 fallbacks execute. A real fixture that responds immediately is used
 *    so the 15_000 ms default never actually fires — we just need the code path.
 *
 * 2. readResource blob content mapping (lines 304–305):
 *    `text: 'text' in c ? c.text : undefined` — FALSE branch when content has no text.
 *    `blob: 'blob' in c ? c.blob : undefined` — TRUE branch when content has a blob.
 *    Existing tests only supply text-only content; this test supplies blob-only and
 *    mixed (text + blob) content to cover both missing branches.
 */

// Delete BEFORE imports — the timeout functions read process.env at call time.
// Unsetting (not just zeroing) exercises the `?? ''` operator branch on line 31/35/39
// and also ensures parseInt('') = NaN → not finite → 15_000/120_000 fallback branches.
delete process.env.CH1TTY_REMOTE_TIMEOUT_MS;

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { RemoteProxy } from '../src/remote-proxy.js';

// ---------------------------------------------------------------------------
// Fixture: minimal Streamable-HTTP JSON-RPC server, supports configurable content.
// ---------------------------------------------------------------------------

type ContentItem =
  | { uri: string; mimeType?: string; text: string }
  | { uri: string; mimeType?: string; blob: string }
  | { uri: string; mimeType?: string; text: string; blob: string };

interface FixtureOpts {
  tools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  readContents?: ContentItem[];
}

interface Fixture {
  port: number;
  stop: () => Promise<void>;
}

function startFixture(opts: FixtureOpts = {}): Promise<Fixture> {
  const tools = opts.tools ?? [];
  const readContents = opts.readContents ?? [];

  const server: HttpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST') {
      req.resume();
      res.writeHead(405);
      res.end();
      return;
    }
    if (req.url !== '/mcp') {
      req.resume();
      res.writeHead(404);
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(
        Buffer.concat(chunks).toString('utf8'),
      ) as { method: string; id?: number | string; params?: Record<string, unknown> };

      if (body.id === undefined) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }

      let result: unknown;
      switch (body.method) {
        case 'initialize':
          result = {
            protocolVersion: '2025-11-25',
            capabilities: { tools: {}, resources: {} },
            serverInfo: { name: 'fixture', version: '1.0' },
          };
          break;
        case 'tools/list':
          result = { tools };
          break;
        case 'tools/call':
          result = { content: [{ type: 'text', text: 'ok' }] };
          break;
        case 'resources/read':
          result = { contents: readContents };
          break;
        default:
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({ jsonrpc: '2.0', error: { code: -32601, message: 'not found' }, id: body.id }),
          );
          return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', result, id: body.id }));
    });
  });

  return new Promise<Fixture>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      const port = (server.address() as AddressInfo).port;
      resolve({
        port,
        stop: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// §1  Timeout DEFAULT-VALUE branches (lines 31–32, 35–36, 39–40)
//     CH1TTY_REMOTE_TIMEOUT_MS unset → `?? ''` → parseInt('') = NaN → fallback 15_000 / 120_000.
//     Fixture responds immediately, so the 15_000 ms default never fires.
// ---------------------------------------------------------------------------

test('listTools with CH1TTY_REMOTE_TIMEOUT_MS unset: connect+list use 15_000 fallback (lines 31-32, 35-36)', async () => {
  const fixture = await startFixture({
    tools: [{ name: 'ping', description: 'Ping', inputSchema: { type: 'object', properties: {} } }],
  });
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'lt-def',
      name: 'LT Defaults',
      type: 'remote',
      access: 'read',
      category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    const tools = await proxy.listTools('lt-def');
    assert.equal(tools.length, 1, 'one tool returned');
    assert.equal(tools[0].name, 'ping');
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});

test('callTool with CH1TTY_REMOTE_TIMEOUT_MS unset: connect+call use 15_000/120_000 fallback (lines 31-32, 39-40)', async () => {
  const fixture = await startFixture();
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'ct-def',
      name: 'CT Defaults',
      type: 'remote',
      access: 'read',
      category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    const result = await proxy.callTool('ct-def', 'run', { q: 1 });
    assert.equal(result.isError, false, 'call should succeed without error');
    assert.ok(result.content.length > 0, 'content returned');
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});

// ---------------------------------------------------------------------------
// §2  readResource blob content mapping (lines 304–305)
//     Line 304 FALSE branch: 'text' not in c → text=undefined
//     Line 305 TRUE branch:  'blob' in c    → blob=c.blob
// ---------------------------------------------------------------------------

test('readResource blob-only content: blob mapped, text is undefined (lines 304-305)', async () => {
  const fixture = await startFixture({
    readContents: [
      { uri: 'image://test.png', mimeType: 'image/png', blob: 'aGVsbG8=' },
    ],
  });
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'blob-rr',
      name: 'Blob RR',
      type: 'remote',
      access: 'read',
      category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    const result = await proxy.readResource('blob-rr', 'image://test.png');
    assert.equal(result.contents.length, 1);
    const c = result.contents[0];
    assert.equal(c.uri, 'image://test.png');
    assert.equal(c.mimeType, 'image/png');
    assert.equal(c.blob, 'aGVsbG8=', 'blob content preserved (line 305 TRUE branch)');
    assert.equal(c.text, undefined, 'no text property → text=undefined (line 304 FALSE branch)');
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});

test('readResource mixed content: text-only item has blob=undefined; blob-only item has text=undefined', async () => {
  const fixture = await startFixture({
    readContents: [
      { uri: 'text://doc', mimeType: 'text/plain', text: 'hello' },
      { uri: 'blob://img', mimeType: 'image/png', blob: 'aGVsbG8=' },
    ],
  });
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'mixed-rr',
      name: 'Mixed RR',
      type: 'remote',
      access: 'read',
      category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });
    const result = await proxy.readResource('mixed-rr', 'any://resource');
    assert.equal(result.contents.length, 2, 'two content items');

    const textItem = result.contents[0];
    assert.equal(textItem.text, 'hello', 'text-only item: text preserved (line 304 TRUE branch)');
    assert.equal(textItem.blob, undefined, 'text-only item: blob=undefined (line 305 FALSE branch)');

    const blobItem = result.contents[1];
    assert.equal(blobItem.blob, 'aGVsbG8=', 'blob-only item: blob preserved (line 305 TRUE branch)');
    assert.equal(blobItem.text, undefined, 'blob-only item: text=undefined (line 304 FALSE branch)');
  } finally {
    await proxy.shutdown();
    await fixture.stop();
  }
});
