/**
 * BBB batch — 6 tests covering previously untested branches:
 *
 * 1. handleCast: getRegistry() rejects → callTool rejects (re-throws reason,
 *    not wrapped as isError). Source: aggregator.ts:738–739.
 *
 * 2. handleCast: listAllPrompts rejects → warns and continues with empty prompt
 *    set; cast still resolves to 'executed'. Source: aggregator.ts:744–752.
 *
 * 3. handleCast: listAllResources rejects → warns and continues with empty
 *    resource set; cast still resolves to 'executed'. Source: aggregator.ts:753–758.
 *
 * 4. resolveActiveFocus: per-call focus "" (empty string) → treated as no focus;
 *    no inFocus markers in search results. Source: aggregator.ts:137–138.
 *
 * 5. resolveActiveFocus: defaultFocus "none" → treated as no focus; status
 *    reports no active focus. Source: aggregator.ts:141–142.
 *
 * 6. resolveActiveFocus: defaultFocus "" (empty string) → treated as no focus
 *    via the !def branch; search returns no inFocus markers. Source: aggregator.ts:141–142.
 */

import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig } from '../src/types.js';
import type { FocusProfiles } from '../src/focus.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function baseConfig(id = 'svc', category: ServerConfig['category'] = 'ecosystem'): ServerConfig {
  return {
    id,
    name: `${id}-name`,
    type: 'remote',
    access: 'readwrite',
    category,
    endpoint: `https://${id}.example.com/mcp`,
    lazy: true,
  };
}

function makeAgg(backend: Backend, opts?: { focus?: string; focusProfiles?: FocusProfiles }): Aggregator {
  return new Aggregator([baseConfig()], {
    backendFactory: () => backend,
    embedEnabled: false,
    suggestionsCatalog: {},
    focusProfiles: opts?.focusProfiles ?? { profiles: {} },
    focus: opts?.focus,
    ledgerDlqPath: join(tmpdir(), `ch1tty-bbb-${Date.now()}-${Math.random()}.jsonl`),
  });
}

function codeProfile(): FocusProfiles {
  return {
    profiles: {
      code: { categories: ['code'], servers: [], boost: 0.5 },
    },
  };
}

function parseText(content: Array<{ type: string; text?: string }>): Record<string, unknown> {
  return JSON.parse((content[0] as { type: 'text'; text: string }).text) as Record<string, unknown>;
}

// ── 1. handleCast: getRegistry() rejects → callTool rejects ──────────────────

test('handleCast: getRegistry() rejects → callTool rejects with the same reason', async () => {
  const agg = makeAgg(makeListItemsBackend());
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (agg as any).getRegistry = (): Promise<never> => Promise.reject(new Error('registry bang'));

    await assert.rejects(
      () => agg.callTool('ch1tty/cast', { intent: 'list items' }),
      (err: unknown) => {
        assert.ok(err instanceof Error, 'rejection must be an Error');
        assert.match(err.message, /registry bang/, 'rejection reason preserved');
        return true;
      },
    );
  } finally {
    await agg.shutdown();
  }
});

// ── 2. handleCast: listAllPrompts rejects → warns, cast still executes ────────

test('handleCast: listAllPrompts rejects → warns + continues; cast resolves executed', async () => {
  const agg = makeAgg(makeListItemsBackend());
  try {
    agg.listAllPrompts = (): Promise<never> => Promise.reject(new Error('prompts bang'));

    const result = await agg.callTool('ch1tty/cast', { intent: 'list items' });
    assert.ok(!result.isError, 'cast must not isError when prompts degrade');
    const data = parseText(result.content as Array<{ type: string; text?: string }>);
    assert.equal(data.cast, 'executed', 'cast must still execute when prompts reject');
  } finally {
    await agg.shutdown();
  }
});

// ── 3. handleCast: listAllResources rejects → warns, cast still executes ──────

test('handleCast: listAllResources rejects → warns + continues; cast resolves executed', async () => {
  const agg = makeAgg(makeListItemsBackend());
  try {
    agg.listAllResources = (): Promise<never> => Promise.reject(new Error('resources bang'));

    const result = await agg.callTool('ch1tty/cast', { intent: 'list items' });
    assert.ok(!result.isError, 'cast must not isError when resources degrade');
    const data = parseText(result.content as Array<{ type: string; text?: string }>);
    assert.equal(data.cast, 'executed', 'cast must still execute when resources reject');
  } finally {
    await agg.shutdown();
  }
});

// ── 4. resolveActiveFocus: per-call "" → no focus active ─────────────────────

test('resolveActiveFocus: per-call focus "" disables the process-default focus', async () => {
  const agg = new Aggregator([baseConfig('code-svc', 'code')], {
    backendFactory: () => makeListItemsBackend(),
    embedEnabled: false,
    suggestionsCatalog: {},
    focusProfiles: codeProfile(),
    focus: 'code',
    ledgerDlqPath: join(tmpdir(), `ch1tty-bbb-4-${Date.now()}.jsonl`),
  });
  try {
    // Prime the registry
    await agg.callTool('ch1tty/search', { query: 'list' });

    // With default focus active, a server-category search should show inFocus
    const withDefault = await agg.callTool('ch1tty/search', { query: 'list' });
    const wd = parseText(withDefault.content as Array<{ type: string; text?: string }>);
    const toolsWithFocus = wd.tools as Array<Record<string, unknown>>;
    assert.ok(
      toolsWithFocus.some((t) => t.inFocus === true),
      'tools must carry inFocus:true when default focus is active',
    );

    // Per-call focus: '' must disable the lens (empty string treated as none)
    const withEmpty = await agg.callTool('ch1tty/search', { query: 'list', focus: '' });
    const we = parseText(withEmpty.content as Array<{ type: string; text?: string }>);
    const toolsNoFocus = we.tools as Array<Record<string, unknown>>;
    assert.ok(
      !toolsNoFocus.some((t) => t.inFocus === true),
      'no inFocus markers when focus is empty string',
    );
    assert.equal(we.focus, undefined, 'focus key absent in response when per-call focus is ""');
  } finally {
    await agg.shutdown();
  }
});

// ── 5. resolveActiveFocus: defaultFocus "none" → no focus active ──────────────

test('resolveActiveFocus: defaultFocus "none" is treated as no focus', async () => {
  const agg = new Aggregator([baseConfig('code-svc', 'code')], {
    backendFactory: () => makeListItemsBackend(),
    embedEnabled: false,
    suggestionsCatalog: {},
    focusProfiles: codeProfile(),
    focus: 'none',
    ledgerDlqPath: join(tmpdir(), `ch1tty-bbb-5-${Date.now()}.jsonl`),
  });
  try {
    const r = await agg.callTool('ch1tty/search', { query: 'list' });
    const data = parseText(r.content as Array<{ type: string; text?: string }>);
    const tools = data.tools as Array<Record<string, unknown>>;
    assert.ok(
      !tools.some((t) => t.inFocus === true),
      'no inFocus markers when defaultFocus is "none"',
    );
    assert.equal(data.focus, undefined, 'focus key absent in search response when defaultFocus is "none"');

    const status = await agg.callTool('ch1tty/status', {});
    const sd = parseText(status.content as Array<{ type: string; text?: string }>);
    assert.equal(sd.focus, null, 'status focus field must be null (not a profile object) when defaultFocus is "none"');
  } finally {
    await agg.shutdown();
  }
});

// ── 6. resolveActiveFocus: defaultFocus "" → no focus active (!def branch) ────

test('resolveActiveFocus: defaultFocus "" is treated as no focus via !def branch', async () => {
  const agg = new Aggregator([baseConfig('code-svc', 'code')], {
    backendFactory: () => makeListItemsBackend(),
    embedEnabled: false,
    suggestionsCatalog: {},
    focusProfiles: codeProfile(),
    focus: '',
    ledgerDlqPath: join(tmpdir(), `ch1tty-bbb-6-${Date.now()}.jsonl`),
  });
  try {
    const r = await agg.callTool('ch1tty/search', { query: 'list' });
    const data = parseText(r.content as Array<{ type: string; text?: string }>);
    const tools = data.tools as Array<Record<string, unknown>>;
    assert.ok(
      !tools.some((t) => t.inFocus === true),
      'no inFocus markers when defaultFocus is ""',
    );
    assert.equal(data.focus, undefined, 'focus key absent in search response when defaultFocus is ""');

    const status = await agg.callTool('ch1tty/status', {});
    const sd = parseText(status.content as Array<{ type: string; text?: string }>);
    assert.equal(sd.focus, null, 'status focus field must be null (not a profile object) when defaultFocus is ""');
  } finally {
    await agg.shutdown();
  }
});
