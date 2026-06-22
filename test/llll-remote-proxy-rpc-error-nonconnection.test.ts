/**
 * LLLL batch — remote-proxy.ts non-connection RPC error paths
 *
 * Existing fixtures use HTTP 5xx → "Streamable HTTP error:" in the error message, so
 * isConnectionError returns true via line 51 — the `'code' in err` check (lines 52–60)
 * is never reached.
 *
 * New fixture: HTTP 200 + application/json + JSON-RPC error body.
 * The MCP SDK parses the response, calls onmessage with the error, and rejects the
 * pending request with McpError(code, message).  McpError has a numeric `.code` property
 * and its `.message` is "MCP error <code>: <msg>" — none of the earlier isConnectionError
 * string-match guards fire, so the `'code' in err` block is reached.
 *
 * Covered lines:
 *   52–60  isConnectionError `'code' in err` branch (both truthy and falsy sub-branches)
 *   280–281 callTool else → recordSuccess   (code=-32603, isConnectionError false)
 *   328–329 listResources outer catch else → recordSuccess  (init fails with code=-32603)
 *   404–405 listPrompts else → recordSuccess   (code=-32603, isConnectionError false)
 *
 * Bonus:
 *   Lines 52–60 truthy path (code=-32000 → return true → recordFailure + evict)
 */

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
// Fixture A — initialize succeeds; every other RPC call returns HTTP 200 +
// JSON-RPC error body with the supplied error code.
// The SDK parses the 200 body and rejects with McpError(code, …).
// ---------------------------------------------------------------------------
async function startRpcErrorAfterInit(
  errorCode: number,
): Promise<{ port: number; stop: () => Promise<void> }> {
  const server: HttpServer = createServer(
    (req: IncomingMessage, res: ServerResponse) => {
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
        const { method, id } = body;
        // Notifications (no id) — acknowledge silently
        if (id === undefined) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('{}');
          return;
        }
        if (method === 'initialize') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id,
              result: {
                protocolVersion: '2025-11-25',
                capabilities: { tools: {}, resources: {}, prompts: {} },
                serverInfo: { name: 'llll-fixture', version: '1.0' },
              },
            }),
          );
          return;
        }
        // All other RPC calls → HTTP 200 + JSON-RPC error (McpError on client side)
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: errorCode, message: 'forced-rpc-error' },
            id,
          }),
        );
      });
    },
  );

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

// ---------------------------------------------------------------------------
// Fixture B — ALL calls (including initialize) return HTTP 200 + JSON-RPC error
// with code=-32603.  Used to make connectWithReconnect itself throw so that the
// *outer* catch in listResources (lines 328–329) is exercised.
// ---------------------------------------------------------------------------
async function startRpcErrorAlways(): Promise<{ port: number; stop: () => Promise<void> }> {
  const server: HttpServer = createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST') {
        req.resume();
        res.writeHead(405);
        res.end();
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        let body: { id?: number | string };
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body;
        } catch {
          res.writeHead(400);
          res.end();
          return;
        }
        const { id } = body;
        if (id === undefined) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('{}');
          return;
        }
        // Every RPC call (including initialize) fails as a JSON-RPC error
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'forced-init-error' },
            id,
          }),
        );
      });
    },
  );

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

// ---------------------------------------------------------------------------
// Test 1 — isConnectionError code=-32000 → returns true
//           (lines 52–60 truthy branch; callTool evicts connection)
// ---------------------------------------------------------------------------
test(
  'isConnectionError: McpError code=-32000 → returns true → callTool evicts connection (lines 52–60 truthy)',
  async () => {
    const fixture = await startRpcErrorAfterInit(-32000);
    const proxy = new RemoteProxy();
    try {
      proxy.registerServer({
        id: 'llll-32000',
        name: 'LLLL-32000',
        type: 'remote',
        access: 'read',
        category: 'storage',
        endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
      });
      const result = await proxy.callTool('llll-32000', 'any_tool', {});
      assert.equal(result.isError, true);
      assert.ok(result.content.length > 0, 'error result must have content');
      assert.match(result.content[0].text as string, /Remote call error/);
      // code=-32000 → isConnectionError true → recordFailure + evict
      assert.equal(
        proxy.getStatus('llll-32000').connected,
        false,
        'connection must be evicted when McpError code=-32000',
      );
    } finally {
      await proxy.shutdown();
      await fixture.stop();
    }
  },
);

// ---------------------------------------------------------------------------
// Test 2 — callTool non-connection error → recordSuccess (lines 52–60 falsy + 280–281)
// ---------------------------------------------------------------------------
test(
  'callTool: McpError code=-32603 → isConnectionError false → recordSuccess, connection survives (lines 52–60 falsy, 280–281)',
  async () => {
    const fixture = await startRpcErrorAfterInit(-32603);
    const proxy = new RemoteProxy();
    try {
      proxy.registerServer({
        id: 'llll-ct-603',
        name: 'LLLL-CT-603',
        type: 'remote',
        access: 'read',
        category: 'storage',
        endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
      });
      const result = await proxy.callTool('llll-ct-603', 'any_tool', {});
      assert.equal(result.isError, true);
      assert.match(result.content[0].text as string, /Remote call error/);
      // code=-32603 → isConnectionError false → recordSuccess → connection survives
      assert.equal(
        proxy.getStatus('llll-ct-603').connected,
        true,
        'connection must survive when McpError code=-32603 (non-connection error)',
      );
    } finally {
      await proxy.shutdown();
      await fixture.stop();
    }
  },
);

// ---------------------------------------------------------------------------
// Test 3 — listPrompts non-connection error → recordSuccess (lines 404–405)
// ---------------------------------------------------------------------------
test(
  'listPrompts: McpError code=-32603 → isConnectionError false → recordSuccess, connection survives (lines 404–405)',
  async () => {
    const fixture = await startRpcErrorAfterInit(-32603);
    const proxy = new RemoteProxy();
    try {
      proxy.registerServer({
        id: 'llll-lp-603',
        name: 'LLLL-LP-603',
        type: 'remote',
        access: 'read',
        category: 'storage',
        endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
      });
      const result = await proxy.listPrompts('llll-lp-603');
      assert.deepEqual(result, []);
      // code=-32603 → isConnectionError false → recordSuccess → connection survives
      assert.equal(
        proxy.getStatus('llll-lp-603').connected,
        true,
        'connection must survive listPrompts McpError code=-32603',
      );
    } finally {
      await proxy.shutdown();
      await fixture.stop();
    }
  },
);

// ---------------------------------------------------------------------------
// Test 4 — listResources outer catch non-connection error → recordSuccess (lines 328–329)
//
// Fixture B causes initialize itself to fail with McpError(-32603), which makes
// connectWithReconnect throw.  The *outer* catch in listResources (not the allSettled
// inner path) fires.  isConnectionError(-32603) = false → else branch → recordSuccess.
// ---------------------------------------------------------------------------
test(
  'listResources outer catch: connectWithReconnect throws McpError(-32603) → isConnectionError false → recordSuccess (lines 328–329)',
  async () => {
    const fixture = await startRpcErrorAlways();
    const proxy = new RemoteProxy();
    try {
      proxy.registerServer({
        id: 'llll-lr-init-fail',
        name: 'LLLL-LR-INIT-FAIL',
        type: 'remote',
        access: 'read',
        category: 'storage',
        endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
      });
      // connectWithReconnect throws (initialize → McpError(-32603))
      // outer catch: isConnectionError=false → recordSuccess (lines 328–329)
      const result = await proxy.listResources('llll-lr-init-fail');
      assert.deepEqual(result.resources, []);
      assert.deepEqual(result.templates, []);
      // Connection was never established (init failed), not in connections map
      assert.equal(
        proxy.getStatus('llll-lr-init-fail').connected,
        false,
        'connection not established when initialize fails',
      );
    } finally {
      await proxy.shutdown();
      await fixture.stop();
    }
  },
);
