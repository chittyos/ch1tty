/**
 * YY batch — 6 tests covering previously untested branches:
 *
 * 1. loadSuggestionsCatalog path-switch: _cached exists for pathA but caller
 *    passes pathB → cache bypassed, fresh read from pathB; subsequent same-path
 *    call then returns the new cached reference.
 *
 * 2. ChildManager.shutdown: client.close() rejects → error swallowed via
 *    .catch(); shutdown() still resolves cleanly and children map is cleared.
 *
 * 3. aggregator cast: args.args passed as an Array → coerced to {} (line 716);
 *    cast still resolves to 'executed' (no TypeError).
 *
 * 4. aggregator cast: args.args passed as null → coerced to {} (line 716);
 *    same clean resolution.
 *
 * 5. aggregator refreshRegistry: backendFor() returns undefined for an active
 *    config (defensive guard at line 229-231) → that config contributes 0 tools,
 *    no throw; search returns empty tools array.
 *
 * 6. aggregator listAllPrompts: backendFor() returns undefined for a config
 *    (defensive guard at line ~1148) → that config contributes 0 prompts,
 *    no throw; listAllPrompts returns empty prompts array.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ChildManager } from '../src/child-manager.js';
import { Aggregator } from '../src/aggregator.js';
import {
  loadSuggestionsCatalog,
  clearSuggestionsCache,
} from '../src/suggestions.js';
import type { Backend, BackendStatus, ServerConfig } from '../src/types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal Backend that exposes a single tool matching 'list items'. */
function makeListItemsBackend(): Backend {
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
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
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
    ledgerDlqPath: join(tmpdir(), `ch1tty-yy-${Date.now()}.jsonl`),
  });
}

// ── 1. loadSuggestionsCatalog path-switch ────────────────────────────────────

test('loadSuggestionsCatalog: different path bypasses cache and reads fresh', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-yy-sugg-'));
  const pathA = join(dir, 'catA.json');
  const pathB = join(dir, 'catB.json');
  try {
    writeFileSync(pathA, JSON.stringify({ profiles: { alpha: { description: 'A', combos: [], prompts: [] } } }));
    writeFileSync(pathB, JSON.stringify({ profiles: { beta: { description: 'B', combos: [], prompts: [] } } }));

    clearSuggestionsCache();
    const a = loadSuggestionsCatalog(pathA);
    assert.ok('alpha' in a, 'pathA catalog loaded');

    // Different path → cache miss, fresh read from pathB
    const b = loadSuggestionsCatalog(pathB);
    assert.ok('beta' in b, 'pathB catalog loaded fresh');
    assert.ok(!('alpha' in b), 'pathA key must not appear in pathB result');
    assert.notEqual(a, b, 'different paths must produce different objects');

    // Third call with same pathB → cache hit; same reference
    const b2 = loadSuggestionsCatalog(pathB);
    assert.equal(b, b2, 'repeated same-path call must return cached reference');
  } finally {
    clearSuggestionsCache();
    rmSync(dir, { recursive: true });
  }
});

// ── 2. ChildManager.shutdown with client.close() rejection ──────────────────

test('ChildManager.shutdown: client.close() rejection is swallowed; resolves cleanly', async () => {
  const cm = new ChildManager();

  // Inject a fake connection whose client.close() rejects
  const fakeConn = {
    client: { close: () => Promise.reject(new Error('close kaboom')) },
    transport: {},
    toolCache: null,
    resourceCache: null,
    promptCache: null,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (cm as any).children.set('fake-svc', fakeConn);
  assert.equal((cm as any).children.size, 1, 'one fake child before shutdown');

  // shutdown() must resolve even though client.close() rejected
  await assert.doesNotReject(() => cm.shutdown(), 'shutdown must not throw on close rejection');

  // All maps cleared after shutdown
  assert.equal((cm as any).children.size, 0, 'children cleared after shutdown');
  assert.equal((cm as any).connecting.size, 0, 'connecting cleared after shutdown');
});

// ── 3. cast: args.args as Array coerces to {} ────────────────────────────────

test('cast: args.args passed as Array coerces to {} and cast resolves executed', async () => {
  const agg = makeAgg(makeListItemsBackend());
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list items',
      args: [1, 2, 3],   // Array — must coerce to {}
    });
    assert.ok(!result.isError, 'cast must not return isError');
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    const data = JSON.parse(text) as Record<string, unknown>;
    assert.equal(data.cast, 'executed', 'cast mode must be executed (not a plan)');
  } finally {
    await agg.shutdown();
  }
});

// ── 4. cast: args.args as null coerces to {} ─────────────────────────────────

test('cast: args.args passed as null coerces to {} and cast resolves executed', async () => {
  const agg = makeAgg(makeListItemsBackend());
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list items',
      args: null,         // null — must coerce to {}
    });
    assert.ok(!result.isError, 'cast must not return isError');
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    const data = JSON.parse(text) as Record<string, unknown>;
    assert.equal(data.cast, 'executed', 'cast mode must be executed (not a plan)');
  } finally {
    await agg.shutdown();
  }
});

// ── 5. refreshRegistry: backendFor undefined → 0 tools, no throw ─────────────

test('refreshRegistry: orphaned config (backendFor → undefined) contributes 0 tools', async () => {
  const agg = makeAgg(makeListItemsBackend());
  try {
    // Prime the registry first so it is populated
    const primed = await agg.callTool('ch1tty/search', { query: 'list' });
    const primedData = JSON.parse((primed.content[0] as { type: 'text'; text: string }).text) as Record<string, unknown>;
    assert.ok((primedData.tools as unknown[]).length > 0, 'tools present before orphaning');

    // Orphan the backend: config remains active but no entry in backends map
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (agg as any).backends.delete('svc');
    // Force cache expiry so refreshRegistry runs on next search
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (agg as any).registryExpiresAt = 0;

    // Search must not throw; backendFor() returning undefined hits the `if (!backend) return []` guard
    const result = await agg.callTool('ch1tty/search', { query: 'list' });
    assert.ok(!result.isError, 'search must not error with orphaned backend');
    const data = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as Record<string, unknown>;
    assert.equal((data.tools as unknown[]).length, 0, 'orphaned config contributes 0 tools');
  } finally {
    await agg.shutdown();
  }
});

// ── 6. listAllPrompts: backendFor undefined → 0 prompts, no throw ─────────────

test('listAllPrompts: orphaned config (backendFor → undefined) contributes 0 prompts', async () => {
  const promptBackend: Backend = {
    ...makeListItemsBackend(),
    listPrompts: async () => [
      { name: 'intro', description: 'Introduction prompt' },
    ],
  };

  const agg = makeAgg(promptBackend);
  try {
    // Confirm prompts are present with backend intact
    const before = await agg.listAllPrompts();
    assert.equal(before.prompts.length, 1, 'one prompt before orphaning');

    // Orphan the backend from the backends map
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (agg as any).backends.delete('svc');

    // listAllPrompts must not throw; the `if (!backend) return []` guard fires
    const after = await agg.listAllPrompts();
    assert.ok(!('isError' in after), 'listAllPrompts must not throw');
    assert.equal(after.prompts.length, 0, 'orphaned config contributes 0 prompts');
  } finally {
    await agg.shutdown();
  }
});
