/**
 * ZZ batch — 6 tests covering previously untested branches:
 *
 * 1. ChildManager.evict: client.close() rejects → error absorbed via .catch();
 *    child is still deleted from the children map (eviction completes cleanly).
 *
 * 2. ChildManager.evict: serverId not in children map → no-op (conn undefined,
 *    if (conn) block skipped, children map unchanged).
 *
 * 3. cast confirm: true + args.args as Array → toolArgs coerced to {};
 *    plan JSON includes `args: {}` (not the raw array).
 *
 * 4. cast confirm: true + args.args as null → toolArgs coerced to {};
 *    plan JSON includes `args: {}`.
 *
 * 5. listAllResources: backendFor() returns undefined for an active config
 *    (defensive guard at aggregator.ts:1071-1072) → contributes 0 resources,
 *    no throw.
 *
 * 6. listAllResourceTemplates: backendFor() returns undefined for an active
 *    config (defensive guard at aggregator.ts:1098-1099) → contributes 0
 *    resource templates, no throw.
 */

import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ChildManager } from '../src/child-manager.js';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig } from '../src/types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal Backend with one tool matching 'list items'. */
function makeListBackend(): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: 1, toolCacheAge: null }),
    listTools: async () => [
      {
        name: 'list_items',
        description: 'list items in the collection',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
    callTool: async () => ({ content: [{ type: 'text', text: '{"items":[]}' }] }),
    listResources: async () => ({
      resources: [{ uri: 'items', name: 'Item list' }],
      templates: [{ uriTemplate: 'items/{id}', name: 'Item by id' }],
    }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

function makeAgg(backend: Backend): Aggregator {
  const config: ServerConfig = {
    id: 'svc',
    name: 'Svc',
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: 'https://svc.example.com/mcp',
    lazy: true,
  };
  return new Aggregator([config], {
    backendFactory: () => backend,
    embedEnabled: false,
    suggestionsCatalog: {},
    focusProfiles: { profiles: {} },
    ledgerDlqPath: join(tmpdir(), `ch1tty-zz-${Date.now()}.jsonl`),
  });
}

// ── 1. ChildManager.evict: client.close() rejects → absorbed; child deleted ──

test('ChildManager.evict: client.close() rejection absorbed; child deleted from map', () => {
  const cm = new ChildManager();

  const fakeConn = {
    client: { close: () => Promise.reject(new Error('evict close kaboom')) },
    transport: {},
    toolCache: null,
    resourceCache: null,
    promptCache: null,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (cm as any).children.set('svc-a', fakeConn);
  assert.equal((cm as any).children.size, 1, 'one entry before evict');

  // evict() must not throw even when close() rejects
  assert.doesNotThrow(() => (cm as any).evict('svc-a'), 'evict must not throw');

  // child must be removed from the map regardless of close() rejection
  assert.equal((cm as any).children.has('svc-a'), false, 'child deleted after evict');
  assert.equal((cm as any).children.size, 0, 'children map empty after evict');
});

// ── 2. ChildManager.evict: serverId absent → no-op ──────────────────────────

test('ChildManager.evict: absent serverId is a no-op; children map unchanged', () => {
  const cm = new ChildManager();

  // Pre-populate an unrelated entry to verify it's untouched
  const otherConn = {
    client: { close: async () => {} },
    transport: {},
    toolCache: null,
    resourceCache: null,
    promptCache: null,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (cm as any).children.set('other-svc', otherConn);

  // Evict a serverId that doesn't exist — must be a silent no-op
  assert.doesNotThrow(() => (cm as any).evict('nonexistent'), 'evict of absent id must not throw');

  assert.equal((cm as any).children.size, 1, 'unrelated entry untouched');
  assert.ok((cm as any).children.has('other-svc'), 'other-svc still present');
});

// ── 3. cast confirm: true + args.args as Array → plan `args: {}` ─────────────

test('cast confirm:true + args.args as Array → plan JSON shows args: {}', async () => {
  const agg = makeAgg(makeListBackend());
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list items',
      args: [1, 2, 3],  // Array — must coerce to {}
      confirm: true,
    });
    assert.ok(!result.isError, 'cast must not return isError');
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    const data = JSON.parse(text) as Record<string, unknown>;
    assert.equal(data.cast, 'plan', 'confirm:true returns plan mode');
    // toolArgs coerced to {} — `args` field in plan must be an empty object
    assert.deepEqual(data.args, {}, 'coerced args must be {} in plan, not the raw array');
  } finally {
    await agg.shutdown();
  }
});

// ── 4. cast confirm: true + args.args as null → plan `args: {}` ──────────────

test('cast confirm:true + args.args as null → plan JSON shows args: {}', async () => {
  const agg = makeAgg(makeListBackend());
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list items',
      args: null,   // null — must coerce to {}
      confirm: true,
    });
    assert.ok(!result.isError, 'cast must not return isError');
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    const data = JSON.parse(text) as Record<string, unknown>;
    assert.equal(data.cast, 'plan', 'confirm:true returns plan mode');
    assert.deepEqual(data.args, {}, 'null args must coerce to {} in plan JSON');
  } finally {
    await agg.shutdown();
  }
});

// ── 5. listAllResources: backendFor undefined → 0 resources, no throw ─────────

test('listAllResources: orphaned backend (backendFor → undefined) contributes 0 resources', async () => {
  const agg = makeAgg(makeListBackend());
  try {
    // Prime by calling listAllResources with backend intact
    const before = await agg.listAllResources();
    assert.equal(before.resources.length, 1, 'one resource before orphaning');

    // Orphan the backend
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (agg as any).backends.delete('svc');

    const after = await agg.listAllResources();
    assert.equal(after.resources.length, 0, 'orphaned backend contributes 0 resources');
  } finally {
    await agg.shutdown();
  }
});

// ── 6. listAllResourceTemplates: backendFor undefined → 0 templates ───────────

test('listAllResourceTemplates: orphaned backend (backendFor → undefined) contributes 0 templates', async () => {
  const agg = makeAgg(makeListBackend());
  try {
    // Prime by calling listAllResourceTemplates with backend intact
    const before = await agg.listAllResourceTemplates();
    assert.equal(before.resourceTemplates.length, 1, 'one template before orphaning');

    // Orphan the backend
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (agg as any).backends.delete('svc');

    const after = await agg.listAllResourceTemplates();
    assert.equal(after.resourceTemplates.length, 0, 'orphaned backend contributes 0 templates');
  } finally {
    await agg.shutdown();
  }
});
