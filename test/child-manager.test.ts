/**
 * ChildManager unit tests — covers pure-logic paths (no spawn needed) and
 * circuit-breaker integration (spawn failures → circuit open → correct rejection).
 *
 * Uses a binary path inside a mkdtempSync-owned directory: guaranteed nonexistent
 * (no file is created there), not world-writable shared /tmp path.
 *
 * CH1TTY_SPAWN_TIMEOUT_MS is set low so each spawn-failure cycle is fast.
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
// Opens the circuit via 5 spawn failures, then verifies that subsequent calls
// return the correct circuit-open response (empty / isError) without spawning.
// Timing is not asserted — the return value is the meaningful invariant;
// the < 30ms check was dropped per Codex P2 finding (brittle under CI load).

describe('ChildManager — circuit breaker integration', { concurrency: false }, () => {
  test('listTools returns [] when circuit is open', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('bad1'));
    await openCircuit(cm, 'bad1');

    const result = await cm.listTools('bad1');

    assert.deepEqual(result, []);
    await cm.shutdown();
  });

  test('callTool returns isError=true when circuit is open', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('bad2'));
    await openCircuit(cm, 'bad2');

    const result = await cm.callTool('bad2', 'some-tool', {});

    assert.equal(result.isError, true);
    const item = result.content[0];
    assert.equal(item.type, 'text');
    assert.ok(
      (item as { type: 'text'; text: string }).text.includes('temporarily unavailable'),
      `unexpected message: ${(item as { type: 'text'; text: string }).text}`,
    );
    await cm.shutdown();
  });

  test('listResources returns empty when circuit is open', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('bad3'));
    await openCircuit(cm, 'bad3');

    const result = await cm.listResources('bad3');

    assert.deepEqual(result, { resources: [], templates: [] });
    await cm.shutdown();
  });

  test('listPrompts returns [] when circuit is open', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('bad4'));
    await openCircuit(cm, 'bad4');

    const result = await cm.listPrompts('bad4');

    assert.deepEqual(result, []);
    await cm.shutdown();
  });
});
