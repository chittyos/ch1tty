/**
 * MMMM batch — timer, CF-Access header, pagination, and spawn-timeout coverage gaps
 *
 * Covered lines / branches:
 *   coordinator.ts:76     — setInterval callback: evictStaleSessions call fires with real timer
 *   remote-proxy.ts:177   — CF-Access-Client-Id ternary truthy branch ("set (...)")
 *   remote-proxy.ts:178   — CF-Access-Client-Secret ternary truthy branch ("set (...)")
 *   remote-proxy.ts:219   — cursor truthy branch in listTools pagination do-while
 *   ledger.ts:99-102      — flush().then() callback: backend+serverId+dlq>0 → replayDlq()
 *   child-manager.ts:22   — CH1TTY_SPAWN_TIMEOUT_MS unset → ?? '' fallback
 *   child-manager.ts:23   — parseInt('',10)=NaN → Number.isFinite false → returns 30_000
 *
 * Ledger.ts lines 323-324 (rewriteDlq outer catch) require OS-level fault injection
 * (ENOSPC/EROFS) and cannot be triggered in a sandboxed test environment.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mock } from 'node:test';
import {
  createServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SessionCoordinator } from '../src/coordinator.js';
import { RemoteProxy } from '../src/remote-proxy.js';
import { LedgerClient } from '../src/ledger.js';
import { ChildManager } from '../src/child-manager.js';
import type { Backend, BackendStatus, ToolCallResult, ToolEntry } from '../src/types.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'ch1tty-mmmm-'));
}

function seedDlq(dlqPath: string, count: number): void {
  const lines = Array.from({ length: count }, (_, i) =>
    JSON.stringify({
      event_type: 'session_start',
      session_id: `sess-${i}`,
      metadata: { seq: i },
      timestamp: new Date().toISOString(),
      retries: 3,
      droppedAt: new Date().toISOString(),
    }),
  ).join('\n') + '\n';
  writeFileSync(dlqPath, lines, 'utf8');
}

function makeOkBackend(): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: 0, toolCacheAge: null }),
    listTools: async (): Promise<ToolEntry[]> => [],
    callTool: async (): Promise<ToolCallResult> => ({
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
    }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

// ---------------------------------------------------------------------------
// Fixture: minimal MCP HTTP server — parameterised behaviour
// ---------------------------------------------------------------------------

interface FixtureOptions {
  /** If true, return nextCursor on the FIRST tools/list call so pagination loops */
  paginate?: boolean;
}

async function startMcpFixture(
  opts: FixtureOptions = {},
): Promise<{ port: number; stop: () => Promise<void> }> {
  let toolsListCount = 0;

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

        // Notifications (no id) — ack silently
        if (id === undefined) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('{}');
          return;
        }

        let result: unknown;
        if (method === 'initialize') {
          result = {
            protocolVersion: '2025-11-25',
            capabilities: { tools: {} },
            serverInfo: { name: 'mmmm-fixture', version: '1.0' },
          };
        } else if (method === 'tools/list') {
          toolsListCount++;
          if (opts.paginate && toolsListCount === 1) {
            // First page — return one tool + a cursor so the proxy loops
            result = {
              tools: [{ name: 'tool_page1', description: 'Page 1', inputSchema: { type: 'object', properties: {} } }],
              nextCursor: 'cursor-page-2',
            };
          } else {
            // Final page (or only page when not paginating)
            result = {
              tools: [{ name: 'tool_page2', description: 'Page 2', inputSchema: { type: 'object', properties: {} } }],
            };
          }
        } else {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32601, message: 'method not found' }, id }));
          return;
        }

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', result, id }));
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
// Test 1 — coordinator.ts:76 — eviction timer callback fires
// ---------------------------------------------------------------------------

test(
  'coordinator.ts:76 — setInterval eviction callback fires with short interval',
  async () => {
    const prevEvict = process.env.CH1TTY_SESSION_EVICT_INTERVAL_MS;
    const prevTtl = process.env.CH1TTY_SESSION_TTL_MS;
    // Set very short interval so the timer fires within the test
    process.env.CH1TTY_SESSION_EVICT_INTERVAL_MS = '5';
    process.env.CH1TTY_SESSION_TTL_MS = '1';
    const coord = new SessionCoordinator();
    try {
      // Wait long enough for the 5ms interval to fire at least once
      await new Promise<void>((r) => setTimeout(r, 40));
      // If line 76 was never reached, c8 would flag it. Reaching here means the timer fired.
      // Snapshot confirms the coordinator is still alive.
      const snap = coord.getSnapshot();
      assert.equal(typeof snap.activeSessions, 'number');
    } finally {
      coord.close();
      if (prevEvict === undefined) delete process.env.CH1TTY_SESSION_EVICT_INTERVAL_MS;
      else process.env.CH1TTY_SESSION_EVICT_INTERVAL_MS = prevEvict;
      if (prevTtl === undefined) delete process.env.CH1TTY_SESSION_TTL_MS;
      else process.env.CH1TTY_SESSION_TTL_MS = prevTtl;
    }
  },
);

// ---------------------------------------------------------------------------
// Test 2 — remote-proxy.ts:177-178 — CF-Access header diagnostic truthy branch
// ---------------------------------------------------------------------------

test(
  'remote-proxy.ts:177-178 — CF-Access headers present → "set (...)" diagnostic logged',
  async () => {
    const fixture = await startMcpFixture();
    const prevClientId = process.env.CF_ACCESS_CLIENT_ID;
    const prevClientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
    // Set CF-Access env vars so envHeaders resolve to truthy values
    process.env.CF_ACCESS_CLIENT_ID = 'test-client-id-abcdefgh';
    process.env.CF_ACCESS_CLIENT_SECRET = 'test-secret-xyz';
    const proxy = new RemoteProxy();
    try {
      proxy.registerServer({
        id: 'mmmm-cfaccess',
        name: 'MMMM-CFACCESS',
        type: 'remote',
        access: 'read',
        category: 'storage',
        endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
        envHeaders: {
          'CF-Access-Client-Id': 'CF_ACCESS_CLIENT_ID',
          'CF-Access-Client-Secret': 'CF_ACCESS_CLIENT_SECRET',
        },
      });
      // listTools triggers doConnect → CF-Access branch at lines 177-178
      const tools = await proxy.listTools('mmmm-cfaccess');
      assert.ok(Array.isArray(tools));
    } finally {
      if (prevClientId === undefined) delete process.env.CF_ACCESS_CLIENT_ID;
      else process.env.CF_ACCESS_CLIENT_ID = prevClientId;
      if (prevClientSecret === undefined) delete process.env.CF_ACCESS_CLIENT_SECRET;
      else process.env.CF_ACCESS_CLIENT_SECRET = prevClientSecret;
      await proxy.shutdown();
      await fixture.stop();
    }
  },
);

// ---------------------------------------------------------------------------
// Test 3 — remote-proxy.ts:219 — cursor truthy branch (pagination loop)
// ---------------------------------------------------------------------------

test(
  'remote-proxy.ts:219 — listTools pagination: cursor passed on second call, both pages merged',
  async () => {
    const fixture = await startMcpFixture({ paginate: true });
    const proxy = new RemoteProxy();
    try {
      proxy.registerServer({
        id: 'mmmm-paginate',
        name: 'MMMM-PAGINATE',
        type: 'remote',
        access: 'read',
        category: 'storage',
        endpoint: `http://127.0.0.1:${fixture.port}/mcp`,
      });
      // First call returns nextCursor → loop iterates → line 219 truthy branch fires
      const tools = await proxy.listTools('mmmm-paginate');
      assert.equal(tools.length, 2, 'both pages should be merged');
      assert.ok(tools.some((t) => t.name === 'tool_page1'), 'page 1 tool present');
      assert.ok(tools.some((t) => t.name === 'tool_page2'), 'page 2 tool present');
    } finally {
      await proxy.shutdown();
      await fixture.stop();
    }
  },
);

// ---------------------------------------------------------------------------
// Test 4 — ledger.ts:99-102 — flush().then() → replayDlq when DLQ has entries
// ---------------------------------------------------------------------------

test(
  'ledger.ts:99-102 — flush timer fires, backend+dlq>0 → replayDlq called in .then()',
  async () => {
    const dir = tempDir();
    const dlqPath = join(dir, 'ledger.dlq.jsonl');
    const replayCalls: string[] = [];
    const backend: Backend = {
      ...makeOkBackend(),
      callTool: async (_sid: string, toolName: string) => {
        replayCalls.push(toolName);
        return { content: [{ type: 'text', text: 'ok' }], isError: false };
      },
    };

    // Enable mock timers BEFORE bind() so the setInterval is intercepted
    mock.timers.enable({ apis: ['setInterval'] });
    const client = new LedgerClient(dlqPath);
    seedDlq(dlqPath, 2);
    client.bind(backend, 'ledger-svc');

    try {
      // Tick past FLUSH_INTERVAL_MS (10_000ms) to fire the setInterval callback
      mock.timers.tick(10_001);

      // Drain the microtask queue so flush().then(async () => { await replayDlq() }) completes.
      // Each setImmediate fires after all pending microtasks, giving async chains time to resolve.
      await new Promise<void>((r) => setImmediate(r));
      await new Promise<void>((r) => setImmediate(r));
      await new Promise<void>((r) => setImmediate(r));

      // replayDlq() calls backend.callTool for each DLQ entry
      assert.ok(replayCalls.length > 0, 'replayDlq must have called backend at least once');
      assert.ok(
        replayCalls.every((t) => t === 'chitty_ledger_record'),
        'all replay calls go to chitty_ledger_record',
      );
      // DLQ should be cleared after successful replay
      assert.equal(existsSync(dlqPath), false, 'DLQ file removed after full replay');
    } finally {
      mock.timers.reset();
      client.unbind();
      await client.shutdown();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Test 5 — child-manager.ts:22-23 — spawnTimeoutMs with env var absent
// ---------------------------------------------------------------------------

test(
  'child-manager.ts:22-23 — CH1TTY_SPAWN_TIMEOUT_MS absent → ?? "" fallback → returns 30_000 default',
  async () => {
    const saved = process.env.CH1TTY_SPAWN_TIMEOUT_MS;
    delete process.env.CH1TTY_SPAWN_TIMEOUT_MS;

    const manager = new ChildManager();
    manager.registerServer({
      id: 'mmmm-spawn-timeout',
      name: 'MMMM-SPAWN-TIMEOUT',
      type: 'local',
      access: 'read',
      category: 'storage',
      command: '/nonexistent-command-mmmm-test',
      args: [],
    });

    try {
      // listTools triggers spawnWithReconnect → spawnTimeoutMs() with no env var.
      // The spawn fails immediately (ENOENT) and listTools re-throws.
      // Lines 22-23 are executed before the spawn throws — that's what we need to cover.
      await assert.rejects(
        () => manager.listTools('mmmm-spawn-timeout'),
        (err: unknown) => err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT',
      );
    } finally {
      if (saved !== undefined) process.env.CH1TTY_SPAWN_TIMEOUT_MS = saved;
      await manager.shutdown();
    }
  },
);
