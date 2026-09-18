/**
 * DI — branch-coverage gaps in child-manager.ts: listResources + listPrompts
 *
 * Target methods and lines (src-stdio/child-manager.ts):
 *
 * listResources():
 *   319  !config early return
 *   321  !breaker.isAllowed (circuit open) early return
 *   324–326  resourceCache hit
 *   336–340  resResult rejected (listResources call throws) → resources: []
 *   342–346  tmplResult rejected (listResourceTemplates call throws) → templates: []
 *   351–356  spawn fails → recordFailure + return empty
 *
 * listPrompts():
 *   378  !breaker.isAllowed (circuit open) early return
 *   381–383  promptCache hit
 *   404–409  spawn fails → recordFailure + return []
 *
 * Injection pattern: `(cm as unknown as { children: Map<string, unknown> }).children.set(...)`
 * mirrors cm-spawn-resource-status-gaps.test.ts and eeee-calltool-promptargs.test.ts.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { ChildManager } from '../src/child-manager.js';
import type { LocalServerConfig } from '../src/types.js';

// Short timeout keeps spawn-fail tests under ~300 ms each.
process.env.CH1TTY_SPAWN_TIMEOUT_MS ??= '300';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function localCfg(id: string): LocalServerConfig {
  return {
    id, name: id, type: 'local', access: 'readwrite', category: 'code',
    command: `/nonexistent/${id}`, args: [],
  };
}

type InternalCM = {
  children: Map<string, unknown>;
  breaker: { recordFailure: (id: string) => void };
};

function getInternals(cm: ChildManager): InternalCM {
  return cm as unknown as InternalCM;
}

/** Trip the circuit breaker to its open state (threshold = 5). */
function tripBreaker(cm: ChildManager, serverId: string): void {
  const breaker = getInternals(cm).breaker;
  for (let i = 0; i < 5; i++) breaker.recordFailure(serverId);
}

/** Inject a pre-built fake connection, bypassing spawn entirely. */
function injectConn(cm: ChildManager, serverId: string, conn: unknown): void {
  getInternals(cm).children.set(serverId, conn);
}

// ---------------------------------------------------------------------------
// listResources: line 319 — !config early return
// ---------------------------------------------------------------------------

test('listResources: unregistered serverId (no config) → { resources: [], templates: [] }', async () => {
  const cm = new ChildManager();
  // 'ghost' is never registered — configs map has no entry for it
  const result = await cm.listResources('ghost');
  assert.deepEqual(result, { resources: [], templates: [] });
  await cm.shutdown();
});

// ---------------------------------------------------------------------------
// listResources: line 321 — circuit open early return
// ---------------------------------------------------------------------------

test('listResources: circuit open → { resources: [], templates: [] }', async () => {
  const cm = new ChildManager();
  cm.registerServer(localCfg('di-lr-open'));
  tripBreaker(cm, 'di-lr-open');

  const result = await cm.listResources('di-lr-open');
  assert.deepEqual(result, { resources: [], templates: [] });
  await cm.shutdown();
});

// ---------------------------------------------------------------------------
// listResources: lines 324–326 — resourceCache hit
// ---------------------------------------------------------------------------

test('listResources: resourceCache hit → returns cached data without spawning', async () => {
  const cm = new ChildManager();
  cm.registerServer(localCfg('di-lr-cache'));

  const cachedResources = [{ uri: 'res://cached', name: 'cached-res', description: 'a cached resource', mimeType: 'text/plain' }];
  const cachedTemplates = [{ uriTemplate: 'tmpl://cached/{id}', name: 'cached-tmpl', description: 'a cached template', mimeType: undefined }];

  injectConn(cm, 'di-lr-cache', {
    client: {
      // These must NOT be called — any call would indicate a cache miss
      listResources: async () => { throw new Error('should not be called — cache should be hit'); },
      listResourceTemplates: async () => { throw new Error('should not be called — cache should be hit'); },
      close: async () => {},
    },
    transport: {},
    toolCache: null,
    resourceCache: {
      resources: cachedResources,
      templates: cachedTemplates,
      expiresAt: Date.now() + 300_000, // valid for 5 minutes
    },
    promptCache: null,
  });

  const result = await cm.listResources('di-lr-cache');
  assert.deepEqual(result.resources, cachedResources, 'resources from cache');
  assert.deepEqual(result.templates, cachedTemplates, 'templates from cache');
  await cm.shutdown();
});

// ---------------------------------------------------------------------------
// listResources: lines 336–340 — resResult rejected → resources: []
// ---------------------------------------------------------------------------

test('listResources: listResources call rejected → resources: [], templates populated', async () => {
  const cm = new ChildManager();
  cm.registerServer(localCfg('di-lr-res-rej'));

  const tmpl = { uriTemplate: 'tmpl://t/{id}', name: 'tmpl-t', description: 'a template', mimeType: undefined };

  injectConn(cm, 'di-lr-res-rej', {
    client: {
      listResources: () => Promise.reject(new Error('resources unavailable')),
      listResourceTemplates: async () => ({ resourceTemplates: [{ uriTemplate: tmpl.uriTemplate, name: tmpl.name, description: tmpl.description }] }),
      close: async () => {},
    },
    transport: {},
    toolCache: null,
    resourceCache: null,
    promptCache: null,
  });

  const result = await cm.listResources('di-lr-res-rej');
  // resResult rejected → resources []
  assert.deepEqual(result.resources, [], 'resources must be [] when listResources rejects');
  // tmplResult fulfilled → templates mapped
  assert.equal(result.templates.length, 1, 'templates populated from listResourceTemplates');
  assert.equal(result.templates[0].uriTemplate, tmpl.uriTemplate);
  await cm.shutdown();
});

// ---------------------------------------------------------------------------
// listResources: lines 342–346 — tmplResult rejected → templates: []
// ---------------------------------------------------------------------------

test('listResources: listResourceTemplates call rejected → resources populated, templates: []', async () => {
  const cm = new ChildManager();
  cm.registerServer(localCfg('di-lr-tmpl-rej'));

  const res = { uri: 'res://r', name: 'res-r', description: 'a resource', mimeType: 'text/plain' };

  injectConn(cm, 'di-lr-tmpl-rej', {
    client: {
      listResources: async () => ({ resources: [{ uri: res.uri, name: res.name, description: res.description, mimeType: res.mimeType }] }),
      listResourceTemplates: () => Promise.reject(new Error('templates unavailable')),
      close: async () => {},
    },
    transport: {},
    toolCache: null,
    resourceCache: null,
    promptCache: null,
  });

  const result = await cm.listResources('di-lr-tmpl-rej');
  // resResult fulfilled → resources mapped
  assert.equal(result.resources.length, 1, 'resources populated from listResources');
  assert.equal(result.resources[0].uri, res.uri);
  // tmplResult rejected → templates []
  assert.deepEqual(result.templates, [], 'templates must be [] when listResourceTemplates rejects');
  await cm.shutdown();
});

// ---------------------------------------------------------------------------
// listResources: lines 351–356 — spawn fails → recordFailure + empty
// ---------------------------------------------------------------------------

test('listResources: spawn fails → { resources: [], templates: [] } + recordFailure', async () => {
  const savedTimeout = process.env.CH1TTY_SPAWN_TIMEOUT_MS;
  process.env.CH1TTY_SPAWN_TIMEOUT_MS = '200';
  const cm = new ChildManager();
  cm.registerServer(localCfg('di-lr-spawn-fail'));
  // No connection injected — spawnWithReconnect will fail immediately (no retry for fresh server)

  try {
    const result = await cm.listResources('di-lr-spawn-fail');
    assert.deepEqual(result, { resources: [], templates: [] }, 'catch block returns empty on spawn failure');
  } finally {
    process.env.CH1TTY_SPAWN_TIMEOUT_MS = savedTimeout;
    await cm.shutdown();
  }
});

// ---------------------------------------------------------------------------
// listPrompts: line 378 — circuit open early return
// ---------------------------------------------------------------------------

test('listPrompts: circuit open → []', async () => {
  const cm = new ChildManager();
  cm.registerServer(localCfg('di-lp-open'));
  tripBreaker(cm, 'di-lp-open');

  const result = await cm.listPrompts('di-lp-open');
  assert.deepEqual(result, []);
  await cm.shutdown();
});

// ---------------------------------------------------------------------------
// listPrompts: lines 381–383 — promptCache hit
// ---------------------------------------------------------------------------

test('listPrompts: promptCache hit → returns cached prompts without spawning', async () => {
  const cm = new ChildManager();
  cm.registerServer(localCfg('di-lp-cache'));

  const cachedPrompts = [
    {
      name: 'greet',
      description: 'greet someone',
      arguments: [{ name: 'who', description: 'recipient', required: true }],
    },
  ];

  injectConn(cm, 'di-lp-cache', {
    client: {
      listPrompts: async () => { throw new Error('should not be called — cache should be hit'); },
      close: async () => {},
    },
    transport: {},
    toolCache: null,
    resourceCache: null,
    promptCache: {
      prompts: cachedPrompts,
      expiresAt: Date.now() + 300_000, // valid for 5 minutes
    },
  });

  const result = await cm.listPrompts('di-lp-cache');
  assert.deepEqual(result, cachedPrompts, 'prompts from cache');
  await cm.shutdown();
});

// ---------------------------------------------------------------------------
// listPrompts: lines 404–409 — spawn fails → recordFailure + []
// ---------------------------------------------------------------------------

test('listPrompts: spawn fails → [] + recordFailure', async () => {
  const savedTimeout = process.env.CH1TTY_SPAWN_TIMEOUT_MS;
  process.env.CH1TTY_SPAWN_TIMEOUT_MS = '200';
  const cm = new ChildManager();
  cm.registerServer(localCfg('di-lp-spawn-fail'));
  // No connection injected — spawnWithReconnect will fail immediately

  try {
    const result = await cm.listPrompts('di-lp-spawn-fail');
    assert.deepEqual(result, [], 'catch block returns [] on spawn failure');
  } finally {
    process.env.CH1TTY_SPAWN_TIMEOUT_MS = savedTimeout;
    await cm.shutdown();
  }
});
