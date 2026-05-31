/**
 * ChildManager unit tests — covers pure-logic paths (no spawn needed) and
 * circuit-breaker integration (spawn failures → circuit open → fast rejection).
 *
 * Uses a guaranteed-nonexistent binary so spawn attempts fail immediately
 * (ENOENT) without leaving dangling child processes.
 *
 * CH1TTY_SPAWN_TIMEOUT_MS is set low so any timeout path is also fast.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

// Must be set before importing child-manager (read at call time, not module load)
process.env.CH1TTY_SPAWN_TIMEOUT_MS = '500';

const { ChildManager } = await import('../src/child-manager.js');
type ChildManagerType = InstanceType<typeof ChildManager>;

import type { LocalServerConfig, ServerConfig } from '../src/types.js';

function localConfig(id: string): LocalServerConfig {
  return {
    id,
    name: id,
    type: 'local',
    access: 'readwrite',
    category: 'code',
    command: '/tmp/__nonexistent_binary_ch1tty_unit_test__',
    args: [],
  };
}

/** Open the circuit for a registered server by triggering 5 spawn failures. */
async function openCircuit(cm: ChildManagerType, serverId: string): Promise<void> {
  // listTools throws on spawn failure; 5 throws → breaker open
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
// Forces the circuit open via spawn failures, then validates that subsequent
// calls are rejected immediately (< 30ms) without attempting another spawn.

describe('ChildManager — circuit breaker integration', { concurrency: false }, () => {
  test('listTools returns [] immediately when circuit is open', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('bad1'));
    await openCircuit(cm, 'bad1');

    const t0 = Date.now();
    const result = await cm.listTools('bad1');
    const elapsed = Date.now() - t0;

    assert.deepEqual(result, []);
    assert.ok(elapsed < 30, `expected <30ms, got ${elapsed}ms`);
    await cm.shutdown();
  });

  test('callTool returns isError=true immediately when circuit is open', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('bad2'));
    await openCircuit(cm, 'bad2');

    const t0 = Date.now();
    const result = await cm.callTool('bad2', 'some-tool', {});
    const elapsed = Date.now() - t0;

    assert.equal(result.isError, true);
    const item = result.content[0];
    assert.equal(item.type, 'text');
    assert.ok(
      (item as { type: 'text'; text: string }).text.includes('temporarily unavailable'),
      `unexpected message: ${(item as { type: 'text'; text: string }).text}`,
    );
    assert.ok(elapsed < 30, `expected <30ms, got ${elapsed}ms`);
    await cm.shutdown();
  });

  test('listResources returns empty immediately when circuit is open', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('bad3'));
    await openCircuit(cm, 'bad3');

    const t0 = Date.now();
    const result = await cm.listResources('bad3');
    const elapsed = Date.now() - t0;

    assert.deepEqual(result, { resources: [], templates: [] });
    assert.ok(elapsed < 30, `expected <30ms, got ${elapsed}ms`);
    await cm.shutdown();
  });

  test('listPrompts returns [] immediately when circuit is open', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('bad4'));
    await openCircuit(cm, 'bad4');

    const t0 = Date.now();
    const result = await cm.listPrompts('bad4');
    const elapsed = Date.now() - t0;

    assert.deepEqual(result, []);
    assert.ok(elapsed < 30, `expected <30ms, got ${elapsed}ms`);
    await cm.shutdown();
  });
});
