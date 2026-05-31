/**
 * ChildManager — spawnWithReconnect + evict + getStatus(connected) + readResource + getPrompt.
 *
 * `spawnWithReconnect` (child-manager.ts:77–90) has two catch branches:
 *  1. No cached entry in `children` when spawn fails → rethrow without retry.
 *  2. Stale cached entry in `children` when spawn fails → evict + retry once.
 *
 * `evict` (child-manager.ts:67–75) removes from `children` and calls client.close()
 * as fire-and-forget (error swallowed via .catch).
 *
 * `getStatus` connected=true path (child-manager.ts:357–363) reports toolCount + cacheAge
 * from the cached connection.
 *
 * `readResource` and `getPrompt` call spawnWithReconnect directly (no circuit-breaker
 * guard) and forward to the client — not covered by other unit tests.
 *
 * All tests monkey-patch the private `spawn` method (TypeScript `private` is compile-time
 * only; the property is reachable at runtime via `as any`).
 */
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.CH1TTY_SPAWN_TIMEOUT_MS = '500';

const { ChildManager } = await import('../src/child-manager.js');
type ChildManagerType = InstanceType<typeof ChildManager>;

import type { LocalServerConfig } from '../src/types.js';

const tempDir = mkdtempSync(join(tmpdir(), 'ch1tty-cm-reconnect-'));
after(() => rmSync(tempDir, { recursive: true, force: true }));

function localConfig(id: string): LocalServerConfig {
  return {
    id, name: id, type: 'local', access: 'readwrite', category: 'code',
    command: join(tempDir, 'nonexistent-' + id),
    args: [],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeFakeConn(toolNames: string[] = []): any {
  return {
    client: {
      listTools: async () => ({ tools: toolNames.map((n) => ({ name: n, description: `desc-${n}`, inputSchema: {} })) }),
      close: async () => {},
      readResource: async ({ uri }: { uri: string }) => ({ contents: [{ uri, text: 'content', mimeType: 'text/plain' }] }),
      getPrompt: async ({ name }: { name: string }) => ({ description: `desc-${name}`, messages: [] }),
    },
    transport: {},
    toolCache: null,
    resourceCache: null,
    promptCache: null,
  };
}

describe('ChildManager — spawnWithReconnect reconnect paths', { concurrency: false }, () => {
  test('reconnects: evicts stale cached conn and retries when first spawn fails', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('r1'));

    let spawnCount = 0;
    const freshConn = makeFakeConn(['fresh-tool']);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cm as any).spawn = async (serverId: string) => {
      spawnCount++;
      if (spawnCount === 1) {
        // Plant a stale entry so children.has(serverId) is true when the catch fires
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (cm as any).children.set(serverId, makeFakeConn(['stale-tool']));
        throw new Error('stale connection timed out');
      }
      return freshConn;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conn = await (cm as any).spawnWithReconnect('r1');

    assert.equal(spawnCount, 2, 'spawn called twice: initial failure + reconnect retry');
    assert.equal(conn, freshConn, 'returns the fresh connection after reconnect');
    // Stale entry was evicted before retry; our patched spawn on 2nd call does not re-add it
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.equal((cm as any).children.has('r1'), false, 'stale entry evicted during reconnect');
    await cm.shutdown();
  });

  test('no-retry: rethrows immediately when first spawn fails with no cached conn', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('r2'));

    let spawnCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cm as any).spawn = async () => {
      spawnCount++;
      throw new Error('spawn failed — no stale conn');
    };

    await assert.rejects(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async () => (cm as any).spawnWithReconnect('r2'),
      /spawn failed — no stale conn/,
    );

    assert.equal(spawnCount, 1, 'spawn called exactly once — no retry without stale conn');
    await cm.shutdown();
  });

  test('reconnect retry also fails: propagates the retry error', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('r3'));

    let spawnCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cm as any).spawn = async (serverId: string) => {
      spawnCount++;
      if (spawnCount === 1) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (cm as any).children.set(serverId, makeFakeConn());
        throw new Error('first spawn failed');
      }
      throw new Error('retry spawn also failed');
    };

    await assert.rejects(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async () => (cm as any).spawnWithReconnect('r3'),
      /retry spawn also failed/,
    );

    assert.equal(spawnCount, 2, 'spawn called twice: initial + retry (which also fails)');
    await cm.shutdown();
  });
});

describe('ChildManager — evict', { concurrency: false }, () => {
  test('evict: removes entry from children map and calls close() as fire-and-forget', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('e1'));

    let closeCalled = false;
    const conn = makeFakeConn();
    conn.client.close = async () => { closeCalled = true; };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cm as any).children.set('e1', conn);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.equal((cm as any).children.has('e1'), true, 'precondition: entry present');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cm as any).evict('e1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.equal((cm as any).children.has('e1'), false, 'entry removed synchronously on evict');

    // close() is fire-and-forget — flush the microtask queue
    await new Promise<void>((r) => setTimeout(r, 10));
    assert.equal(closeCalled, true, 'client.close() invoked by evict');
    await cm.shutdown();
  });

  test('evict: safe no-op when no connection is cached for the server', () => {
    const cm = new ChildManager();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.doesNotThrow(() => (cm as any).evict('nobody'));
  });
});

describe('ChildManager — getStatus connected path', { concurrency: false }, () => {
  test('getStatus: connected=true reports toolCount and cacheAge from cached connection', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('s1'));

    const TOOL_CACHE_TTL = 5 * 60 * 1_000;
    const now = Date.now();
    const conn = makeFakeConn(['alpha', 'beta']);
    conn.toolCache = {
      tools: [
        { name: 'alpha', description: 'a', inputSchema: {} },
        { name: 'beta', description: 'b', inputSchema: {} },
      ],
      expiresAt: now + TOOL_CACHE_TTL, // freshly created (age ≈ 0)
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cm as any).children.set('s1', conn);

    const status = cm.getStatus('s1');

    assert.equal(status.connected, true, 'connected=true when child is present');
    assert.equal(status.toolCount, 2, 'toolCount matches cached tool list length');
    assert.ok(typeof status.toolCacheAge === 'number', 'toolCacheAge is a number');
    assert.ok(status.toolCacheAge! >= 0, 'toolCacheAge is non-negative');
    assert.ok(status.toolCacheAge! < 200, 'toolCacheAge is near-zero — cache was just set');
    await cm.shutdown();
  });
});

describe('ChildManager — readResource + getPrompt routing', { concurrency: false }, () => {
  test('readResource: calls spawnWithReconnect and delegates to client.readResource', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('rr1'));

    let readCalled = false;
    let capturedUri = '';
    const conn = makeFakeConn();
    conn.client.readResource = async ({ uri }: { uri: string }) => {
      readCalled = true;
      capturedUri = uri;
      return { contents: [{ uri, text: 'hello-resource', mimeType: 'text/plain' }] };
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cm as any).spawn = async () => conn;

    const result = await cm.readResource('rr1', 'test://my-resource');

    assert.equal(readCalled, true, 'client.readResource was invoked');
    assert.equal(capturedUri, 'test://my-resource', 'correct URI forwarded to client');
    assert.equal(result.contents[0].text, 'hello-resource', 'content returned from client');
    assert.equal(result.contents[0].uri, 'test://my-resource', 'URI preserved in result');
    await cm.shutdown();
  });

  test('getPrompt: calls spawnWithReconnect and delegates to client.getPrompt', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('gp1'));

    let promptCalled = false;
    let capturedName = '';
    let capturedArgs: Record<string, string> | undefined;
    const conn = makeFakeConn();
    conn.client.getPrompt = async ({ name, arguments: args }: { name: string; arguments?: Record<string, string> }) => {
      promptCalled = true;
      capturedName = name;
      capturedArgs = args;
      return {
        description: `desc-${name}`,
        messages: [{ role: 'user', content: { type: 'text', text: `prompt-${name}` } }],
      };
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cm as any).spawn = async () => conn;

    const result = await cm.getPrompt('gp1', 'my-prompt', { key: 'val' });

    assert.equal(promptCalled, true, 'client.getPrompt was invoked');
    assert.equal(capturedName, 'my-prompt', 'correct prompt name forwarded');
    assert.deepEqual(capturedArgs, { key: 'val' }, 'prompt arguments forwarded');
    assert.equal(result.description, 'desc-my-prompt', 'description returned from client');
    assert.equal(result.messages.length, 1, 'messages returned from client');
    await cm.shutdown();
  });
});
