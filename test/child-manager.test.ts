/**
 * ChildManager unit tests — covers pure-logic paths (no spawn needed) and
 * circuit-breaker integration (spawn failures → circuit open → correct rejection).
 *
 * Uses a binary path inside a mkdtempSync-owned directory: guaranteed nonexistent
 * (no file is created there), not world-writable shared /tmp path.
 *
 * Circuit-open tests spy on the private `spawn` method (TypeScript `private` is
 * compile-time only; the method is reachable at runtime) to assert zero spawn
 * attempts were made. This is necessary for listResources and listPrompts whose
 * circuit-open and spawn-failure paths both return the same empty result.
 */
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Must be set before importing child-manager (read at call time, not module load)
process.env.CH1TTY_SPAWN_TIMEOUT_MS = '500';

const { ChildManager } = await import('../src/child-manager.js');
type ChildManagerType = InstanceType<typeof ChildManager>;

import type { LocalServerConfig, ServerConfig } from '../src/types.js';

// Private temp directory — controlled by this process, not world-writable shared space.
// The binary path inside it is guaranteed nonexistent (we never create the file).
const tempDir = mkdtempSync(join(tmpdir(), 'ch1tty-cm-test-'));
after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});
const NONEXISTENT_BIN = join(tempDir, 'nonexistent-binary');

function localConfig(id: string): LocalServerConfig {
  return {
    id,
    name: id,
    type: 'local',
    access: 'readwrite',
    category: 'code',
    command: NONEXISTENT_BIN,
    args: [],
  };
}

/** Open the circuit by triggering 5 spawn failures (DEFAULT_FAILURE_THRESHOLD = 5). */
async function openCircuit(cm: ChildManagerType, serverId: string): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await cm.listTools(serverId).catch(() => {});
  }
}

/**
 * Install a spawn spy AFTER the circuit is already open.
 * TypeScript `private` is compile-time only; the method is reachable at runtime.
 * Returns a function that reports how many times `spawn` was invoked.
 */
function withSpawnSpy(cm: ChildManagerType): { spawnCalls: () => number } {
  let calls = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const target = cm as any;
  const original = target.spawn.bind(cm);
  target.spawn = async (serverId: string) => {
    calls++;
    return original(serverId);
  };
  return { spawnCalls: () => calls };
}

// ── Pure-logic paths ─────────────────────────────────────────────────────────

describe('ChildManager — pure-logic paths', { concurrency: false }, () => {
  test('registerServer ignores non-local type', () => {
    const cm = new ChildManager();
    const remoteConfig: ServerConfig = {
      id: 'r1', name: 'Remote', type: 'remote',
      access: 'readwrite', category: 'ecosystem',
      endpoint: 'https://example.com/mcp',
    };
    cm.registerServer(remoteConfig);
    assert.equal(cm.isRegistered('r1'), false);
  });

  test('registerServer accepts local type', () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('s1'));
    assert.equal(cm.isRegistered('s1'), true);
  });

  test('isRegistered returns false for unknown server', () => {
    const cm = new ChildManager();
    assert.equal(cm.isRegistered('ghost'), false);
  });

  test('getStatus returns disconnected before first spawn', () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('s2'));
    assert.deepEqual(cm.getStatus('s2'), { connected: false, toolCount: 0, toolCacheAge: null });
  });

  test('getStatus returns disconnected for unregistered server', () => {
    const cm = new ChildManager();
    assert.deepEqual(cm.getStatus('nobody'), { connected: false, toolCount: 0, toolCacheAge: null });
  });

  test('listTools returns [] for unregistered server', async () => {
    const cm = new ChildManager();
    assert.deepEqual(await cm.listTools('unregistered'), []);
    await cm.shutdown();
  });

  test('listResources returns empty for unregistered server', async () => {
    const cm = new ChildManager();
    assert.deepEqual(await cm.listResources('unregistered'), { resources: [], templates: [] });
    await cm.shutdown();
  });

  test('listPrompts returns [] for unregistered server', async () => {
    const cm = new ChildManager();
    assert.deepEqual(await cm.listPrompts('unregistered'), []);
    await cm.shutdown();
  });

  test('shutdown with no children resolves cleanly', async () => {
    const cm = new ChildManager();
    await assert.doesNotReject(async () => cm.shutdown());
  });
});

// ── Circuit-breaker integration ───────────────────────────────────────────────
// Opens the circuit via 5 spawn failures, then installs a spawn spy and verifies:
// (a) the correct circuit-open response is returned, AND
// (b) spawn was never called (the circuit check short-circuited before any spawn).
//
// The spawn spy is essential for listResources and listPrompts whose circuit-open
// and spawn-failure paths both return the same empty result — without it the test
// would pass even if the circuit check were removed.

describe('ChildManager — circuit breaker integration', { concurrency: false }, () => {
  test('listTools returns [] and skips spawn when circuit is open', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('bad1'));
    await openCircuit(cm, 'bad1');
    const { spawnCalls } = withSpawnSpy(cm);

    const result = await cm.listTools('bad1');

    assert.deepEqual(result, []);
    assert.equal(spawnCalls(), 0, 'spawn must not be called when circuit is open');
    await cm.shutdown();
  });

  test('callTool returns isError=true and skips spawn when circuit is open', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('bad2'));
    await openCircuit(cm, 'bad2');
    const { spawnCalls } = withSpawnSpy(cm);

    const result = await cm.callTool('bad2', 'some-tool', {});

    assert.equal(result.isError, true);
    const item = result.content[0];
    assert.equal(item.type, 'text');
    assert.ok(
      (item as { type: 'text'; text: string }).text.includes('temporarily unavailable'),
      `unexpected message: ${(item as { type: 'text'; text: string }).text}`,
    );
    assert.equal(spawnCalls(), 0, 'spawn must not be called when circuit is open');
    await cm.shutdown();
  });

  test('listResources returns empty and skips spawn when circuit is open', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('bad3'));
    await openCircuit(cm, 'bad3');
    const { spawnCalls } = withSpawnSpy(cm);

    const result = await cm.listResources('bad3');

    assert.deepEqual(result, { resources: [], templates: [] });
    assert.equal(spawnCalls(), 0, 'spawn must not be called when circuit is open');
    await cm.shutdown();
  });

  test('listPrompts returns [] and skips spawn when circuit is open', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('bad4'));
    await openCircuit(cm, 'bad4');
    const { spawnCalls } = withSpawnSpy(cm);

    const result = await cm.listPrompts('bad4');

    assert.deepEqual(result, []);
    assert.equal(spawnCalls(), 0, 'spawn must not be called when circuit is open');
    await cm.shutdown();
  });
});
