/**
 * ChildManager concurrent spawn deduplication + tool-cache tests.
 *
 * The `spawn()` method coalesces concurrent calls via `this.connecting`: if a
 * spawn is in flight, subsequent callers return the same promise instead of
 * starting a new child process. This file verifies that invariant and the
 * adjacent tool-cache hit path, using a monkey-patched `doSpawn` that returns
 * a fake ChildConnection without touching real binaries.
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

const tempDir = mkdtempSync(join(tmpdir(), 'ch1tty-cm-dedup-'));
after(() => rmSync(tempDir, { recursive: true, force: true }));

function localConfig(id: string): LocalServerConfig {
  return {
    id, name: id, type: 'local', access: 'readwrite', category: 'code',
    command: join(tempDir, 'nonexistent-' + id),
    args: [],
  };
}

/**
 * Install a fake `doSpawn` that resolves after `delayMs` with a stub
 * ChildConnection whose `client.listTools()` returns the supplied tool names.
 * Returns counters so tests can assert spawn and listTools call counts.
 */
function installFakeSpawn(
  cm: ChildManagerType,
  toolNames: string[] = ['tool-a'],
  delayMs = 30,
): { spawnCalls: () => number; listToolsCalls: () => number } {
  let spawnCount = 0;
  let listToolsCount = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (cm as any).doSpawn = async (_config: LocalServerConfig) => {
    spawnCount++;
    await new Promise<void>((r) => setTimeout(r, delayMs));
    return {
      client: {
        listTools: async () => {
          listToolsCount++;
          return { tools: toolNames.map((name) => ({ name, description: `desc-${name}`, inputSchema: {} })) };
        },
        close: async () => {},
      },
      transport: {},
      toolCache: null,
      resourceCache: null,
      promptCache: null,
    };
  };
  return { spawnCalls: () => spawnCount, listToolsCalls: () => listToolsCount };
}

describe('ChildManager — concurrent spawn deduplication', { concurrency: false }, () => {
  test('two concurrent listTools produce exactly one doSpawn call', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('c1'));
    const { spawnCalls } = installFakeSpawn(cm, ['tool-x']);

    // Fire both without awaiting the first — they race into spawn() simultaneously
    const [r1, r2] = await Promise.all([cm.listTools('c1'), cm.listTools('c1')]);

    assert.equal(spawnCalls(), 1, 'doSpawn must be called exactly once');
    assert.equal(r1.length, 1);
    assert.equal(r2.length, 1);
    assert.equal(r1[0].name, 'tool-x');
    assert.equal(r2[0].name, 'tool-x');
    await cm.shutdown();
  });

  test('three concurrent listTools produce exactly one doSpawn call', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('c2'));
    const { spawnCalls } = installFakeSpawn(cm, ['alpha', 'beta'], 40);

    const results = await Promise.all([
      cm.listTools('c2'),
      cm.listTools('c2'),
      cm.listTools('c2'),
    ]);

    assert.equal(spawnCalls(), 1, 'only one spawn despite three concurrent callers');
    for (const r of results) {
      assert.equal(r.length, 2);
      assert.equal(r[0].name, 'alpha');
      assert.equal(r[1].name, 'beta');
    }
    await cm.shutdown();
  });

  test('all concurrent callers receive identical tool lists', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('c3'));
    installFakeSpawn(cm, ['p', 'q', 'r']);

    const [a, b, c] = await Promise.all([
      cm.listTools('c3'),
      cm.listTools('c3'),
      cm.listTools('c3'),
    ]);

    assert.deepEqual(a.map((t) => t.name), ['p', 'q', 'r']);
    assert.deepEqual(b.map((t) => t.name), ['p', 'q', 'r']);
    assert.deepEqual(c.map((t) => t.name), ['p', 'q', 'r']);
    await cm.shutdown();
  });

  test('sequential second listTools uses tool cache — no additional doSpawn', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('c4'));
    const { spawnCalls } = installFakeSpawn(cm, ['cached-tool']);

    // First call spawns and populates the cache
    const first = await cm.listTools('c4');
    assert.equal(spawnCalls(), 1);
    assert.equal(first[0].name, 'cached-tool');

    // Second call must hit the cache — no additional spawn
    const second = await cm.listTools('c4');
    assert.equal(spawnCalls(), 1, 'doSpawn must not be called again within cache TTL');
    assert.equal(second[0].name, 'cached-tool');
    await cm.shutdown();
  });

  test('force-expired tool cache re-calls client.listTools but reuses the connection (no new doSpawn)', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('c5'));
    const { spawnCalls, listToolsCalls } = installFakeSpawn(cm, ['stale-tool']);

    // First call — spawns once, calls client.listTools once, populates cache
    await cm.listTools('c5');
    assert.equal(spawnCalls(), 1);
    assert.equal(listToolsCalls(), 1);

    // Manually expire the cache on the stored connection
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const children = (cm as any).children as Map<string, { toolCache: { expiresAt: number } | null }>;
    const conn = children.get('c5');
    assert.ok(conn?.toolCache, 'tool cache must be populated after first call');
    conn.toolCache!.expiresAt = Date.now() - 1; // expire immediately

    // Second call: cache miss → goes to spawnWithReconnect → spawn() finds existing
    // connection and returns it immediately (no new doSpawn), then re-calls client.listTools()
    await cm.listTools('c5');
    assert.equal(spawnCalls(), 1, 'doSpawn must NOT fire again — same connection is reused');
    assert.equal(listToolsCalls(), 2, 'client.listTools must be called again after cache expiry');
    await cm.shutdown();
  });

  test('independent servers have independent spawn promises', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('d1'));
    cm.registerServer(localConfig('d2'));
    const { spawnCalls } = installFakeSpawn(cm, ['shared-tool'], 20);

    // Concurrent calls across TWO different servers — each must spawn independently
    await Promise.all([cm.listTools('d1'), cm.listTools('d2')]);

    assert.equal(spawnCalls(), 2, 'each server spawns exactly once');
    await cm.shutdown();
  });
});
