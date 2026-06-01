/**
 * ChildManager cache-hit paths for listResources, listPrompts, and getStatus.
 *
 * These paths exist in child-manager.ts but are not reached by child-manager.test.ts
 * (which tests pure-logic and circuit-open) or child-manager-spawn-dedup.test.ts
 * (which only wires up client.listTools).
 *
 * Strategy: monkey-patch `doSpawn` on each ChildManager instance to return a fake
 * ChildConnection whose client methods include listTools, listResources,
 * listResourceTemplates, and listPrompts with per-call counters.
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

const tempDir = mkdtempSync(join(tmpdir(), 'ch1tty-cm-cache-'));
after(() => rmSync(tempDir, { recursive: true, force: true }));

function localConfig(id: string): LocalServerConfig {
  return {
    id, name: id, type: 'local', access: 'readwrite', category: 'code',
    command: join(tempDir, 'nonexistent-' + id),
    args: [],
  };
}

interface FakeClient {
  listTools: () => Promise<{ tools: Array<{ name: string; description: string; inputSchema: object }> }>;
  listResources: () => Promise<{ resources: Array<{ uri: string; name: string }> }>;
  listResourceTemplates: () => Promise<{ resourceTemplates: Array<{ uriTemplate: string; name: string }> }>;
  listPrompts: () => Promise<{ prompts: Array<{ name: string; description: string; arguments?: unknown[] }> }>;
  close: () => Promise<void>;
}

interface FakeCounters {
  listToolsCalls: () => number;
  listResourcesCalls: () => number;
  listResourceTemplatesCalls: () => number;
  listPromptsCalls: () => number;
  spawnCalls: () => number;
}

function installFullFakeSpawn(
  cm: ChildManagerType,
  opts: {
    tools?: string[];
    resources?: Array<{ uri: string; name: string }>;
    prompts?: Array<{ name: string; description: string }>;
    delayMs?: number;
  } = {},
): FakeCounters {
  const tools = opts.tools ?? ['tool-a'];
  const resources = opts.resources ?? [{ uri: 'res://foo', name: 'Foo' }];
  const prompts = opts.prompts ?? [{ name: 'my-prompt', description: 'A prompt' }];
  const delayMs = opts.delayMs ?? 20;

  let spawnCount = 0;
  let listToolsCount = 0;
  let listResourcesCount = 0;
  let listResourceTemplatesCount = 0;
  let listPromptsCount = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (cm as any).doSpawn = async (_config: LocalServerConfig) => {
    spawnCount++;
    await new Promise<void>((r) => setTimeout(r, delayMs));

    const client: FakeClient = {
      listTools: async () => {
        listToolsCount++;
        return { tools: tools.map((name) => ({ name, description: `desc-${name}`, inputSchema: {} })) };
      },
      listResources: async () => {
        listResourcesCount++;
        return { resources };
      },
      listResourceTemplates: async () => {
        listResourceTemplatesCount++;
        return { resourceTemplates: [] };
      },
      listPrompts: async () => {
        listPromptsCount++;
        return { prompts };
      },
      close: async () => {},
    };

    return { client, transport: {}, toolCache: null, resourceCache: null, promptCache: null };
  };

  return {
    spawnCalls: () => spawnCount,
    listToolsCalls: () => listToolsCount,
    listResourcesCalls: () => listResourcesCount,
    listResourceTemplatesCalls: () => listResourceTemplatesCount,
    listPromptsCalls: () => listPromptsCount,
  };
}

describe('ChildManager — getStatus after successful spawn', { concurrency: false }, () => {
  test('getStatus returns connected=true, toolCount, and numeric toolCacheAge after listTools', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('gs1'));
    installFullFakeSpawn(cm, { tools: ['alpha', 'beta', 'gamma'] });

    await cm.listTools('gs1');
    const status = cm.getStatus('gs1');

    assert.equal(status.connected, true);
    assert.equal(status.toolCount, 3);
    assert.ok(typeof status.toolCacheAge === 'number', 'toolCacheAge must be a number');
    assert.ok(status.toolCacheAge >= 0, `toolCacheAge should be >= 0, got ${status.toolCacheAge}`);
    assert.ok(status.toolCacheAge < 5000, `toolCacheAge should be small, got ${status.toolCacheAge}`);
    await cm.shutdown();
  });

  test('getStatus connected=false before any spawn, connected=true after', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('gs2'));
    installFullFakeSpawn(cm, { tools: ['x'] });

    assert.equal(cm.getStatus('gs2').connected, false);

    await cm.listTools('gs2');

    assert.equal(cm.getStatus('gs2').connected, true);
    assert.equal(cm.getStatus('gs2').toolCount, 1);
    await cm.shutdown();
  });
});

describe('ChildManager — listResources cache-hit path', { concurrency: false }, () => {
  test('second listResources call returns cached result without additional client.listResources call', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('rc1'));
    const counters = installFullFakeSpawn(cm, {
      resources: [{ uri: 'res://a', name: 'A' }, { uri: 'res://b', name: 'B' }],
    });

    const first = await cm.listResources('rc1');
    assert.equal(counters.spawnCalls(), 1);
    assert.equal(counters.listResourcesCalls(), 1);
    assert.equal(first.resources.length, 2);
    assert.equal(first.resources[0].uri, 'res://a');

    // Second call: cache hit — must not call listResources again
    const second = await cm.listResources('rc1');
    assert.equal(counters.spawnCalls(), 1, 'no new spawn on cache hit');
    assert.equal(counters.listResourcesCalls(), 1, 'listResources must not be called again');
    assert.equal(second.resources.length, 2);
    assert.equal(second.resources[0].uri, 'res://a');
    await cm.shutdown();
  });

  test('listResources cache-hit returns same templates (empty) as initial call', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('rc2'));
    const counters = installFullFakeSpawn(cm, { resources: [{ uri: 'res://x', name: 'X' }] });

    await cm.listResources('rc2');
    const second = await cm.listResources('rc2');

    assert.equal(counters.listResourceTemplatesCalls(), 1, 'listResourceTemplates called only once');
    assert.deepEqual(second.templates, [], 'templates empty from fake');
    await cm.shutdown();
  });
});

describe('ChildManager — listPrompts cache-hit path', { concurrency: false }, () => {
  test('second listPrompts call returns cached result without additional client.listPrompts call', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('pc1'));
    const counters = installFullFakeSpawn(cm, {
      prompts: [
        { name: 'prompt-a', description: 'First prompt' },
        { name: 'prompt-b', description: 'Second prompt' },
      ],
    });

    const first = await cm.listPrompts('pc1');
    assert.equal(counters.listPromptsCalls(), 1);
    assert.equal(first.length, 2);
    assert.equal(first[0].name, 'prompt-a');

    // Second call: cache hit
    const second = await cm.listPrompts('pc1');
    assert.equal(counters.listPromptsCalls(), 1, 'listPrompts must not be called again on cache hit');
    assert.equal(second.length, 2);
    assert.equal(second[0].name, 'prompt-a');
    await cm.shutdown();
  });

  test('listPrompts cache hit does not trigger a new spawn', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('pc2'));
    const counters = installFullFakeSpawn(cm, {
      prompts: [{ name: 'p', description: 'desc' }],
    });

    await cm.listPrompts('pc2');
    await cm.listPrompts('pc2');

    assert.equal(counters.spawnCalls(), 1, 'only one spawn across both calls');
    await cm.shutdown();
  });
});
