/**
 * GDW drift guard: freeze `ch1tty/execute` live-path metadata JSON outer key set.
 *
 * When sessionId is active and the tool call succeeds, the Aggregator appends
 * a content item whose `.text` field is JSON with EXACTLY two top-level keys:
 *
 *   { latencyMs: <finite non-negative number>, sessionContext: { ... } }
 *
 * Distinction from prior GD tests in this series:
 *   GDR — froze POSITION of the metadata item (last in content[])
 *   GDS — froze callCount value and recentTools array contents
 *   GDT — froze that NO metadata is appended when sessionId is absent
 *   GDU — froze that recentTools items are strings (namespaced tool names)
 *   GDW — freezes the KEY SETS: outer object and sessionContext sub-object
 *
 * Gaps closed:
 *
 *   GDW-1  outer metadata JSON has EXACTLY the keys {"latencyMs","sessionContext"}
 *          (no extra keys; both required; no omission)
 *   GDW-2  latencyMs is typeof 'number', isFinite, and >= 0
 *   GDW-3  sessionContext WITHOUT active focus has EXACTLY {"callCount","recentTools"}
 *          (no activeSessionFocus, no extras)
 *   GDW-4  sessionContext WITH active focus has EXACTLY
 *          {"callCount","recentTools","activeSessionFocus"} (no extras)
 *   GDW-5  the metadata content item text is valid JSON (parse does not throw)
 *
 * Frozen 2026-09-28.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only)
 *   - buildCastExplanation metric freeze: not applicable (execute, not cast)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-gdw-${label}-${Date.now()}.jsonl`);
}

const NEON_CFG: ServerConfig = {
  id: 'neon',
  name: 'Neon',
  type: 'remote',
  access: 'readwrite',
  category: 'code',
  endpoint: 'https://neon.test/mcp',
};
const STRIPE_CFG: ServerConfig = {
  id: 'stripe',
  name: 'Stripe',
  type: 'remote',
  access: 'readwrite',
  category: 'ecosystem',
  endpoint: 'https://stripe.test/mcp',
};

function makeBackend(tools: ToolEntry[]): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: tools.length, toolCacheAge: 0 }),
    listTools: async () => tools,
    callTool: async (): Promise<ToolCallResult> => ({ content: [{ type: 'text', text: 'tool-output' }] }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

const NEON_TOOLS: ToolEntry[] = [
  { name: 'list_projects', description: 'List Neon projects', inputSchema: { type: 'object', properties: {} } },
];
const STRIPE_TOOLS: ToolEntry[] = [
  { name: 'list_customers', description: 'List Stripe customers', inputSchema: { type: 'object', properties: {} } },
];

const FOCUS_PROFILES = {
  profiles: {
    code: { description: 'Code tools', categories: ['code' as const], servers: ['neon'], boost: 0.5 },
  },
};

const CONFIGS: ServerConfig[] = [NEON_CFG, STRIPE_CFG];

function makeAgg(label: string): Aggregator {
  const backends = new Map<string, Backend>([
    ['neon', makeBackend(NEON_TOOLS)],
    ['stripe', makeBackend(STRIPE_TOOLS)],
  ]);
  return new Aggregator(CONFIGS, {
    focusProfiles: FOCUS_PROFILES,
    backendFactory: (cfg: ServerConfig) => backends.get(cfg.id) ?? makeBackend([]),
    embedEnabled: false,
    ledgerDlqPath: dlqPath(label),
  });
}

function findMetadataJson(result: ToolCallResult): Record<string, unknown> | undefined {
  for (const item of result.content) {
    if (item.type !== 'text') continue;
    try {
      const parsed = JSON.parse((item as { type: string; text: string }).text) as Record<string, unknown>;
      if ('sessionContext' in parsed) return parsed;
    } catch {
      // not JSON or no sessionContext
    }
  }
  return undefined;
}

// ── GDW-1: outer JSON has EXACTLY {latencyMs, sessionContext} ─────────────

test('GDW-1: live execute metadata outer JSON has exactly keys {latencyMs, sessionContext}', async () => {
  const agg = makeAgg('1-outer-keys');
  try {
    const result = await agg.callTool('ch1tty/execute', {
      tool: 'neon/list_projects',
      args: {},
      sessionId: 'gdw-session-1',
    });
    const meta = findMetadataJson(result);
    assert.ok(meta !== undefined, 'metadata JSON item must be present when sessionId is active');
    const actualKeys = Object.keys(meta).sort();
    const expectedKeys = ['latencyMs', 'sessionContext'].sort();
    assert.deepEqual(
      actualKeys,
      expectedKeys,
      `metadata outer key set must be exactly ${JSON.stringify(expectedKeys)}, got ${JSON.stringify(actualKeys)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDW-2: latencyMs is a finite non-negative number ─────────────────────

test('GDW-2: live execute metadata latencyMs is a finite non-negative number', async () => {
  const agg = makeAgg('2-latencyMs');
  try {
    const result = await agg.callTool('ch1tty/execute', {
      tool: 'neon/list_projects',
      args: {},
      sessionId: 'gdw-session-2',
    });
    const meta = findMetadataJson(result);
    assert.ok(meta !== undefined, 'metadata JSON item must be present');
    assert.equal(typeof meta.latencyMs, 'number', `latencyMs must be a number, got ${typeof meta.latencyMs}`);
    assert.ok(
      Number.isFinite(meta.latencyMs as number),
      `latencyMs must be finite, got ${meta.latencyMs}`,
    );
    assert.ok(
      (meta.latencyMs as number) >= 0,
      `latencyMs must be >= 0, got ${meta.latencyMs}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDW-3: sessionContext WITHOUT focus has EXACTLY {recentTools, callCount} ─

test('GDW-3: sessionContext without active focus has exactly keys {recentTools, callCount}', async () => {
  const agg = makeAgg('3-sc-no-focus');
  try {
    const result = await agg.callTool('ch1tty/execute', {
      tool: 'neon/list_projects',
      args: {},
      sessionId: 'gdw-session-3',
    });
    const meta = findMetadataJson(result);
    assert.ok(meta !== undefined, 'metadata JSON item must be present');
    assert.ok(
      typeof meta.sessionContext === 'object' && meta.sessionContext !== null,
      'sessionContext must be an object',
    );
    const sc = meta.sessionContext as Record<string, unknown>;
    const actualKeys = Object.keys(sc).sort();
    const expectedKeys = ['callCount', 'recentTools'].sort();
    assert.deepEqual(
      actualKeys,
      expectedKeys,
      `sessionContext key set without focus must be exactly ${JSON.stringify(expectedKeys)}, got ${JSON.stringify(actualKeys)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDW-4: sessionContext WITH focus has EXACTLY {recentTools, callCount, activeSessionFocus} ─

test('GDW-4: sessionContext with active focus has exactly keys {recentTools, callCount, activeSessionFocus}', async () => {
  const agg = makeAgg('4-sc-with-focus');
  try {
    // Set a sticky focus via a search call with focus param
    await agg.callTool('ch1tty/search', { query: 'projects', sessionId: 'gdw-session-4', focus: 'code' });
    const result = await agg.callTool('ch1tty/execute', {
      tool: 'neon/list_projects',
      args: {},
      sessionId: 'gdw-session-4',
    });
    const meta = findMetadataJson(result);
    assert.ok(meta !== undefined, 'metadata JSON item must be present');
    assert.ok(
      typeof meta.sessionContext === 'object' && meta.sessionContext !== null,
      'sessionContext must be an object',
    );
    const sc = meta.sessionContext as Record<string, unknown>;
    const actualKeys = Object.keys(sc).sort();
    const expectedKeys = ['activeSessionFocus', 'callCount', 'recentTools'].sort();
    assert.deepEqual(
      actualKeys,
      expectedKeys,
      `sessionContext key set with focus must be exactly ${JSON.stringify(expectedKeys)}, got ${JSON.stringify(actualKeys)}`,
    );
    assert.equal(typeof sc.activeSessionFocus, 'string', 'activeSessionFocus must be a string');
    assert.ok((sc.activeSessionFocus as string).length > 0, 'activeSessionFocus must be non-empty');
  } finally {
    await agg.shutdown();
  }
});

// ── GDW-5: metadata content item text is valid JSON ───────────────────────

test('GDW-5: metadata content item text parses as valid JSON', async () => {
  const agg = makeAgg('5-json-valid');
  try {
    const result = await agg.callTool('ch1tty/execute', {
      tool: 'stripe/list_customers',
      args: {},
      sessionId: 'gdw-session-5',
    });
    const metaItem = result.content.find((item) => {
      if (item.type !== 'text') return false;
      try {
        const p = JSON.parse((item as { type: string; text: string }).text) as Record<string, unknown>;
        return 'sessionContext' in p;
      } catch {
        return false;
      }
    });
    assert.ok(metaItem !== undefined, 'metadata content item must be present when sessionId is active');
    assert.doesNotThrow(
      () => JSON.parse((metaItem as { type: string; text: string }).text),
      'metadata content item text must be valid JSON',
    );
  } finally {
    await agg.shutdown();
  }
});
