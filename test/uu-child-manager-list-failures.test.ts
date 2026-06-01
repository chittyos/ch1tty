/**
 * UU: ChildManager failure catch paths for listPrompts and listResources.
 *
 * Paths covered (not reached by any prior suite):
 *
 * 1. listPrompts (child-manager.ts:337–340) — spawn-ok but client.listPrompts() throws:
 *    catch fires → breaker.recordFailure + evict → connection removed, [] returned.
 *    (TT covered listTools; this is the parallel path for listPrompts.)
 *
 * 2. listPrompts failure increments circuit breaker failure count.
 *    (Distinct assertion on breaker state, not on eviction.)
 *
 * 3. listResources (child-manager.ts:281–286) — spawn itself fails (circuit NOT open):
 *    spawnWithReconnect throws → outer catch fires → recordFailure + evict + return empty.
 *    (circuit-open tests return early at line 251 before spawn; this exercises the catch.)
 *
 * 4. listResources partial allSettled — listResources RPC rejects, listResourceTemplates
 *    succeeds: resources=[], templates populated; breaker records SUCCESS (allSettled never
 *    throws — only spawn failure hits the outer catch).
 *
 * 5. listResources partial allSettled — listResourceTemplates RPC rejects, listResources
 *    succeeds: resources populated, templates=[]; breaker records success, not evicted.
 *
 * 6. listResources allSettled — both RPC calls fail: empty result returned but catch is NOT
 *    reached → breaker records SUCCESS and connection is NOT evicted.
 *    This is the key invariant: allSettled failures → success path, not failure path.
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

const tempDir = mkdtempSync(join(tmpdir(), 'ch1tty-uu-'));
after(() => rmSync(tempDir, { recursive: true, force: true }));

function localConfig(id: string): LocalServerConfig {
  return { id, name: id, type: 'local', access: 'readwrite', category: 'code', command: join(tempDir, `nonexistent-${id}`), args: [] };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeFakeConn(opts: {
  listPromptsFn?: () => Promise<unknown>;
  listResourcesFn?: () => Promise<unknown>;
  listResourceTemplatesFn?: () => Promise<unknown>;
} = {}): any {
  return {
    client: {
      listTools: async () => ({ tools: [] }),
      listResources: opts.listResourcesFn ?? (async () => ({ resources: [] })),
      listResourceTemplates: opts.listResourceTemplatesFn ?? (async () => ({ resourceTemplates: [] })),
      listPrompts: opts.listPromptsFn ?? (async () => ({ prompts: [] })),
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

// ── listPrompts failure paths ─────────────────────────────────────────────────

describe('ChildManager — listPrompts failure catch', { concurrency: false }, () => {
  test('listPrompts: spawn-ok but client.listPrompts throws → [] returned + connection evicted', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('lp-fail-1'));

    const conn = makeFakeConn({
      listPromptsFn: async () => { throw new Error('listPrompts RPC failed'); },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cm as any).doSpawn = async () => conn;

    // spawn succeeds (doSpawn returns conn); children gets populated; then listPrompts
    // throws → catch fires → evict removes the entry → [] returned
    const result = await cm.listPrompts('lp-fail-1');

    assert.deepEqual(result, [], 'listPrompts catch must return [] on RPC failure');
    assert.equal(hasChild(cm, 'lp-fail-1'), false, 'connection must be evicted after listPrompts failure');
    await cm.shutdown();
  });

  test('listPrompts: failure increments circuit breaker failure count', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('lp-fail-2'));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cm as any).doSpawn = async () => makeFakeConn({
      listPromptsFn: async () => { throw new Error('rpc fail'); },
    });

    await cm.listPrompts('lp-fail-2'); // swallows error, returns []

    assert.ok(breakerFailures(cm, 'lp-fail-2') >= 1, 'breaker must record failure after listPrompts throw');
    await cm.shutdown();
  });
});

// ── listResources failure paths ───────────────────────────────────────────────

describe('ChildManager — listResources outer catch (spawn fails)', { concurrency: false }, () => {
  test('listResources: spawn fails (circuit not open) → recordFailure + evict + empty result', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('lr-spawn-fail'));

    // Patch spawn (not doSpawn) so spawnWithReconnect catches and rethrows it,
    // then the outer catch in listResources fires.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cm as any).spawn = async (_serverId: string) => { throw new Error('spawn transport failed'); };

    const result = await cm.listResources('lr-spawn-fail');

    assert.deepEqual(result, { resources: [], templates: [] }, 'listResources must return empty on spawn failure');
    assert.ok(breakerFailures(cm, 'lr-spawn-fail') >= 1, 'breaker must record failure after spawn-fail in listResources');
    await cm.shutdown();
  });
});

// ── listResources partial allSettled (critical invariant) ─────────────────────
//
// allSettled never throws — individual RPC rejections produce empty arrays for
// that leg; the outer try block ALWAYS falls through to recordSuccess + cache.
// The catch (recordFailure + evict) is NOT reachable via allSettled rejections.

describe('ChildManager — listResources partial allSettled (allSettled absorbs RPC errors)', { concurrency: false }, () => {
  test('listResources RPC rejects, listResourceTemplates succeeds → resources=[], templates populated, no failure', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('lr-partial-1'));

    const conn = makeFakeConn({
      listResourcesFn: async () => { throw new Error('listResources RPC failed'); },
      listResourceTemplatesFn: async () => ({
        resourceTemplates: [{ uriTemplate: 'tmpl://{id}', name: 'My Template' }],
      }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cm as any).doSpawn = async () => conn;

    const result = await cm.listResources('lr-partial-1');

    assert.deepEqual(result.resources, [], 'resources must be empty when listResources RPC fails');
    assert.equal(result.templates.length, 1, 'templates must be populated from the successful call');
    assert.equal(result.templates[0].uriTemplate, 'tmpl://{id}');
    // Crucial invariant: allSettled never throws → catch NOT reached → success recorded
    assert.equal(breakerFailures(cm, 'lr-partial-1'), 0, 'no failure recorded — allSettled absorbs RPC errors');
    assert.equal(hasChild(cm, 'lr-partial-1'), true, 'connection must NOT be evicted after partial allSettled failure');
    await cm.shutdown();
  });

  test('listResourceTemplates RPC rejects, listResources succeeds → resources populated, templates=[], no failure', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('lr-partial-2'));

    const conn = makeFakeConn({
      listResourcesFn: async () => ({
        resources: [{ uri: 'res://alpha', name: 'Alpha' }],
      }),
      listResourceTemplatesFn: async () => { throw new Error('listResourceTemplates RPC failed'); },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cm as any).doSpawn = async () => conn;

    const result = await cm.listResources('lr-partial-2');

    assert.equal(result.resources.length, 1, 'resources must be populated from the successful call');
    assert.equal(result.resources[0].uri, 'res://alpha');
    assert.deepEqual(result.templates, [], 'templates must be empty when listResourceTemplates RPC fails');
    assert.equal(breakerFailures(cm, 'lr-partial-2'), 0, 'no failure recorded — allSettled absorbs RPC errors');
    assert.equal(hasChild(cm, 'lr-partial-2'), true, 'connection must NOT be evicted');
    await cm.shutdown();
  });

  test('both allSettled calls fail → empty result returned but catch NOT reached → success recorded, not evicted', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('lr-both-fail'));

    const conn = makeFakeConn({
      listResourcesFn: async () => { throw new Error('resources fail'); },
      listResourceTemplatesFn: async () => { throw new Error('templates fail'); },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cm as any).doSpawn = async () => conn;

    const result = await cm.listResources('lr-both-fail');

    assert.deepEqual(result, { resources: [], templates: [] }, 'both fail → empty result (allSettled absorbs)');
    // Key invariant: both allSettled rejections do NOT hit the outer catch
    assert.equal(breakerFailures(cm, 'lr-both-fail'), 0, 'no failure recorded even when both RPC calls fail via allSettled');
    assert.equal(hasChild(cm, 'lr-both-fail'), true, 'connection must NOT be evicted — allSettled does not reach the catch');
    await cm.shutdown();
  });
});
