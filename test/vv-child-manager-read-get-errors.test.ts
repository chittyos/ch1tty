/**
 * VV: ChildManager.readResource + getPrompt error propagation invariants.
 *
 * Unlike callTool (circuit-breaker + eviction on failure) and listTools/listPrompts
 * (try/catch → [] + recordFailure + evict), readResource and getPrompt have NO try/catch.
 * Errors propagate to the caller as thrown exceptions. Critically:
 *
 *   1. readResource: client.readResource() throws → error propagates to caller
 *   2. readResource: spawnWithReconnect() throws → error propagates (spawn failure)
 *   3. readResource: error does NOT record circuit breaker failure
 *   4. readResource: error does NOT evict the connection
 *   5. getPrompt: client.getPrompt() throws → error propagates to caller
 *   6. getPrompt: error does NOT record circuit breaker failure or evict connection
 */

import assert from 'node:assert/strict';
import { describe, test, after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.CH1TTY_SPAWN_TIMEOUT_MS = '500';

const { ChildManager } = await import('../src/child-manager.js');
type ChildManagerType = InstanceType<typeof ChildManager>;

import type { LocalServerConfig } from '../src/types.js';

const tempDir = mkdtempSync(join(tmpdir(), 'ch1tty-vv-'));
after(() => rmSync(tempDir, { recursive: true, force: true }));

function localConfig(id: string): LocalServerConfig {
  return {
    id,
    name: id,
    type: 'local',
    access: 'readwrite',
    category: 'code',
    command: join(tempDir, `nonexistent-${id}`),
    args: [],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeFakeConn(opts: {
  readResourceFn?: (args: { uri: string }) => Promise<unknown>;
  getPromptFn?: (args: { name: string; arguments?: Record<string, string> }) => Promise<unknown>;
} = {}): any {
  return {
    client: {
      listTools: async () => ({ tools: [] }),
      readResource: opts.readResourceFn ?? (async () => ({ contents: [] })),
      getPrompt: opts.getPromptFn ?? (async () => ({ description: '', messages: [] })),
      close: async () => {},
    },
    transport: {},
    toolCache: null,
    resourceCache: null,
    promptCache: null,
  };
}

function breakerFailures(cm: ChildManagerType, serverId: string): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (cm as any).breaker.getState(serverId).failures as number;
}

function hasChild(cm: ChildManagerType, serverId: string): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (cm as any).children.has(serverId);
}

// ── readResource error propagation ───────────────────────────────────────────

describe('ChildManager — readResource error propagation (no try/catch)', { concurrency: false }, () => {
  test('readResource: client.readResource throws → error propagates to caller', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('rr-throw-1'));

    const conn = makeFakeConn({
      readResourceFn: async () => { throw new Error('transport read failure'); },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cm as any).doSpawn = async () => conn;

    await assert.rejects(
      () => cm.readResource('rr-throw-1', 'test://resource'),
      /transport read failure/,
      'readResource must propagate the thrown error without swallowing it',
    );
    await cm.shutdown();
  });

  test('readResource: error does NOT record circuit breaker failure', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('rr-throw-2'));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cm as any).doSpawn = async () => makeFakeConn({
      readResourceFn: async () => { throw new Error('rpc failed'); },
    });

    await assert.rejects(() => cm.readResource('rr-throw-2', 'test://x'));

    assert.equal(
      breakerFailures(cm, 'rr-throw-2'),
      0,
      'readResource has no try/catch — it never calls breaker.recordFailure',
    );
    await cm.shutdown();
  });

  test('readResource: error does NOT evict the connection', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('rr-throw-3'));

    const conn = makeFakeConn({
      readResourceFn: async () => { throw new Error('rpc failed'); },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cm as any).doSpawn = async () => conn;

    await assert.rejects(() => cm.readResource('rr-throw-3', 'test://x'));

    assert.equal(
      hasChild(cm, 'rr-throw-3'),
      true,
      'readResource error must NOT evict the connection — caller handles re-throw',
    );
    await cm.shutdown();
  });

  test('readResource: spawnWithReconnect failure propagates (no cached child → no reconnect retry)', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('rr-spawn-fail'));

    // Patch spawn so spawnWithReconnect throws — no cached child so no retry leg
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cm as any).spawn = async () => { throw new Error('spawn failed'); };

    await assert.rejects(
      () => cm.readResource('rr-spawn-fail', 'test://resource'),
      /spawn failed/,
      'readResource must propagate spawn failure',
    );
    await cm.shutdown();
  });
});

// ── getPrompt error propagation ───────────────────────────────────────────────

describe('ChildManager — getPrompt error propagation (no try/catch)', { concurrency: false }, () => {
  test('getPrompt: client.getPrompt throws → error propagates to caller', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('gp-throw-1'));

    const conn = makeFakeConn({
      getPromptFn: async () => { throw new Error('prompt rpc failed'); },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cm as any).doSpawn = async () => conn;

    await assert.rejects(
      () => cm.getPrompt('gp-throw-1', 'my-prompt'),
      /prompt rpc failed/,
      'getPrompt must propagate the thrown error without swallowing it',
    );
    await cm.shutdown();
  });

  test('getPrompt: error does NOT record circuit breaker failure or evict connection', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('gp-throw-2'));

    const conn = makeFakeConn({
      getPromptFn: async () => { throw new Error('prompt rpc failed'); },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cm as any).doSpawn = async () => conn;

    await assert.rejects(() => cm.getPrompt('gp-throw-2', 'test-prompt'));

    assert.equal(
      breakerFailures(cm, 'gp-throw-2'),
      0,
      'getPrompt has no try/catch — it never calls breaker.recordFailure',
    );
    assert.equal(
      hasChild(cm, 'gp-throw-2'),
      true,
      'getPrompt error must NOT evict the connection',
    );
    await cm.shutdown();
  });
});
