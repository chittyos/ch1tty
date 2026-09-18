/**
 * CZ — remote-proxy.ts readResource + getPrompt non-connection error paths.
 *
 * The llll batch already covers the isConnectionError-false → else → recordSuccess
 * branch for callTool (line 314-316), listResources (line 362-364), and listPrompts
 * (line 438-440). readResource (line 396-397) and getPrompt (line 472-473) have
 * identical else branches that are not yet reached by any test.
 *
 * Fixture: HTTP 200 + JSON-RPC error body (code=-32603) for resources/read and
 * prompts/get. The MCP SDK parses these as McpError(-32603); isConnectionError returns
 * false for -32603 (only -32000 returns true). The else branch therefore calls
 * recordSuccess instead of recordFailure.
 *
 * Verification: 6 consecutive calls (above the default circuit-breaker threshold of 5)
 * all reject with the application-level McpError rather than a "circuit open" error,
 * proving that recordSuccess — not recordFailure — was called on each iteration.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { RemoteProxy } from '../src/remote-proxy.js';

// ---------------------------------------------------------------------------
// Fixture: MCP server that returns a JSON-RPC application-level error for
// resources/read and prompts/get. Uses HTTP 200 + application/json so the SDK
// receives a proper error object (McpError) rather than a transport error.
// ---------------------------------------------------------------------------

interface RpcErrorFixtureOpts {
  /** JSON-RPC error code to send for resources/read and prompts/get (default -32603). */
  errorCode?: number;
  errorMessage?: string;
}

interface RpcErrorFixture {
  port: number;
  /** Number of times resources/read was called. */
  readCallCount: number;
  /** Number of times prompts/get was called. */
  getPromptCallCount: number;
  stop: () => Promise<void>;
}

async function startRpcErrorFixture(opts: RpcErrorFixtureOpts = {}): Promise<RpcErrorFixture> {
  const errorCode = opts.errorCode ?? -32603;
  const errorMessage = opts.errorMessage ?? 'application-level error';
  let readCallCount = 0;
  let getPromptCallCount = 0;

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
      let body: { method: string; id?: number | string };
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body;
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }

      const { method, id } = body;

      // Notifications (no id) — ack silently
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
            serverInfo: { name: 'rpc-error-fixture', version: '1.0' },
          };
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', result, id }));
          return;

        case 'tools/list':
          result = { tools: [] };
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', result, id }));
          return;

        case 'resources/read':
          readCallCount++;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: errorCode, message: errorMessage },
            id,
          }));
          return;

        case 'prompts/get':
          getPromptCallCount++;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: errorCode, message: errorMessage },
            id,
          }));
          return;

        default:
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32601, message: 'method not found' },
            id,
          }));
          return;
      }
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
  const fixture: RpcErrorFixture = {
    port,
    get readCallCount() { return readCallCount; },
    get getPromptCallCount() { return getPromptCallCount; },
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
  return fixture;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const CIRCUIT_THRESHOLD = 5; // matches CircuitBreaker default

describe('CZ — readResource non-connection RPC error → recordSuccess (circuit stays healthy)', { concurrency: false }, () => {
  test('readResource: McpError(-32603) throws AND circuit stays open after 6 calls', async () => {
    const fixture = await startRpcErrorFixture();
    const proxy = new RemoteProxy();
    proxy.registerServer({
      id: 'cz-rr',
      name: 'CZ readResource test',
      type: 'remote',
      access: 'read',
      category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });

    try {
      // 6 calls — above the default threshold of 5. If recordFailure were called each
      // time, the circuit would open after call 5 and call 6 would throw "circuit open".
      // recordSuccess is called instead, so all 6 calls throw the application error.
      for (let i = 0; i < CIRCUIT_THRESHOLD + 1; i++) {
        const err = await proxy.readResource('cz-rr', 'test://resource').catch((e: unknown) => e);
        assert.ok(err instanceof Error, `call ${i + 1}: expected Error, got ${typeof err}`);
        assert.ok(
          !err.message.includes('circuit open'),
          `call ${i + 1}: expected application error but got circuit-open: ${err.message}`,
        );
        assert.ok(
          err.message.includes(String(-32603)) || err.message.includes('application-level error'),
          `call ${i + 1}: expected McpError(-32603) message, got: ${err.message}`,
        );
      }

      assert.equal(fixture.readCallCount, CIRCUIT_THRESHOLD + 1, 'fixture should have received all 6 calls');
    } finally {
      await proxy.shutdown();
      await fixture.stop();
    }
  });
});

describe('CZ — getPrompt non-connection RPC error → recordSuccess (circuit stays healthy)', { concurrency: false }, () => {
  test('getPrompt: McpError(-32603) throws AND circuit stays open after 6 calls', async () => {
    const fixture = await startRpcErrorFixture();
    const proxy = new RemoteProxy();
    proxy.registerServer({
      id: 'cz-gp',
      name: 'CZ getPrompt test',
      type: 'remote',
      access: 'read',
      category: 'storage',
      endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
    });

    try {
      // Same logic as above: 6 calls, recordSuccess keeps circuit healthy throughout.
      for (let i = 0; i < CIRCUIT_THRESHOLD + 1; i++) {
        const err = await proxy.getPrompt('cz-gp', 'test-prompt').catch((e: unknown) => e);
        assert.ok(err instanceof Error, `call ${i + 1}: expected Error, got ${typeof err}`);
        assert.ok(
          !err.message.includes('circuit open'),
          `call ${i + 1}: expected application error but got circuit-open: ${err.message}`,
        );
        assert.ok(
          err.message.includes(String(-32603)) || err.message.includes('application-level error'),
          `call ${i + 1}: expected McpError(-32603) message, got: ${err.message}`,
        );
      }

      assert.equal(fixture.getPromptCallCount, CIRCUIT_THRESHOLD + 1, 'fixture should have received all 6 calls');
    } finally {
      await proxy.shutdown();
      await fixture.stop();
    }
  });
});
