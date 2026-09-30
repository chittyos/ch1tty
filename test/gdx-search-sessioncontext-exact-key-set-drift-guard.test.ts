/**
 * GDX drift guard: freeze the exact key set of `sessionContext` in
 * ch1tty/search responses when a sessionId is active.
 *
 * The FF workstream (search-session-context.test.ts) froze individual
 * sessionContext FIELDS (recentTools, callCount, activeSessionFocus) and
 * their presence/absence, but never asserted the exact key set — a new key
 * could be silently added (or an existing one renamed) without any merged
 * test catching it.
 *
 * FI froze the top-level search response envelope key sets but only for
 * calls WITHOUT sessionId, so the exact shape of the envelope including
 * `sessionContext` and `sessionId` together was also never frozen.
 *
 * GDX closes those gaps across both the keyword path and the server-summary
 * path (no-query, no-filter → server list), and for both the no-focus and
 * with-focus variants.
 *
 *   GDX-1  keyword-path sessionContext EXACTLY {callCount, recentTools}
 *           when sessionId is active and no focus is set
 *   GDX-2  keyword-path sessionContext EXACTLY {activeSessionFocus, callCount, recentTools}
 *           when sessionId is active and a sticky focus is set
 *   GDX-3  server-summary-path sessionContext EXACTLY {callCount, recentTools}
 *           when sessionId is active and no focus is set
 *   GDX-4  server-summary-path sessionContext EXACTLY {activeSessionFocus, callCount, recentTools}
 *           when sessionId is active and a sticky focus is set
 *   GDX-5  keyword-path top-level envelope key set EXACTLY
 *           {latencyMs, matches, sessionContext, sessionId, total, tools}
 *           when sessionId is active and no extras (explain/focus/partial)
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only)
 *   - buildCastExplanation metric freeze: not applicable (search, not cast)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;

function dlqPath(): string {
  return join(tmpdir(), `ch1tty-gdx-${Date.now()}-${++_seq}.jsonl`);
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

const NEON_TOOLS: ToolEntry[] = [
  { name: 'list_projects', description: 'List Neon database projects', inputSchema: { type: 'object', properties: {} } },
  { name: 'run_query', description: 'Run a SQL query on a Neon database', inputSchema: { type: 'object', properties: {} } },
];
const STRIPE_TOOLS: ToolEntry[] = [
  { name: 'list_customers', description: 'List Stripe billing customers', inputSchema: { type: 'object', properties: {} } },
];

function makeBackend(tools: ToolEntry[]): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: tools.length, toolCacheAge: 0 }),
    listTools: async () => tools,
    callTool: async (): Promise<ToolCallResult> => ({ content: [{ type: 'text', text: 'ok' }] }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

const FOCUS_PROFILES = {
  profiles: {
    code: { description: 'Code tools', categories: ['code' as const], servers: ['neon'], boost: 0.5 },
  },
};

const CONFIGS = [NEON_CFG, STRIPE_CFG];

function makeAgg(): Aggregator {
  const backends = new Map<string, Backend>([
    ['neon', makeBackend(NEON_TOOLS)],
    ['stripe', makeBackend(STRIPE_TOOLS)],
  ]);
  return new Aggregator(CONFIGS, {
    focusProfiles: FOCUS_PROFILES,
    backendFactory: (cfg: ServerConfig) => backends.get(cfg.id) ?? makeBackend([]),
    embedEnabled: false,
    ledgerDlqPath: dlqPath(),
  });
}

function parseBody(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const item = result.content.find((c) => c.type === 'text');
  assert.ok(item && 'text' in item && typeof (item as { text: string }).text === 'string', 'Expected text content item');
  return JSON.parse((item as { text: string }).text) as Record<string, unknown>;
}

// ── GDX-1: keyword-path sessionContext key set — no focus ─────────────────────

test('GDX-1: keyword-path sessionContext has EXACTLY {callCount, recentTools} when no focus is active', async () => {
  const agg = makeAgg();
  try {
    const SESSION = 'gdx-session-1';
    const result = await agg.callTool('ch1tty/search', { query: 'list', sessionId: SESSION });
    const body = parseBody(result);
    assert.ok('sessionContext' in body, 'sessionContext must be present when sessionId is given');
    const sc = body.sessionContext as Record<string, unknown>;
    const actualKeys = Object.keys(sc).sort();
    const expectedKeys = ['callCount', 'recentTools'].sort();
    assert.deepEqual(
      actualKeys,
      expectedKeys,
      `keyword-path sessionContext key set must be exactly ${JSON.stringify(expectedKeys)}, got ${JSON.stringify(actualKeys)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDX-2: keyword-path sessionContext key set — with sticky focus ────────────

test('GDX-2: keyword-path sessionContext has EXACTLY {activeSessionFocus, callCount, recentTools} when focus is active', async () => {
  const agg = makeAgg();
  try {
    const SESSION = 'gdx-session-2';
    // Set sticky focus via per-call focus param
    await agg.callTool('ch1tty/search', { query: 'list', sessionId: SESSION, focus: 'code' });
    // Second search — focus is now sticky, sessionContext must include activeSessionFocus
    const result = await agg.callTool('ch1tty/search', { query: 'query', sessionId: SESSION });
    const body = parseBody(result);
    assert.ok('sessionContext' in body, 'sessionContext must be present when sessionId is given');
    const sc = body.sessionContext as Record<string, unknown>;
    const actualKeys = Object.keys(sc).sort();
    const expectedKeys = ['activeSessionFocus', 'callCount', 'recentTools'].sort();
    assert.deepEqual(
      actualKeys,
      expectedKeys,
      `keyword-path sessionContext key set with focus must be exactly ${JSON.stringify(expectedKeys)}, got ${JSON.stringify(actualKeys)}`,
    );
    assert.equal(sc.activeSessionFocus, 'code', 'activeSessionFocus must equal the sticky focus name');
  } finally {
    await agg.shutdown();
  }
});

// ── GDX-3: server-summary-path sessionContext key set — no focus ──────────────
//
// The server-summary path is triggered by ch1tty/search with no query, no
// server filter, and no category filter.

test('GDX-3: server-summary-path sessionContext has EXACTLY {callCount, recentTools} when no focus is active', async () => {
  const agg = makeAgg();
  try {
    const SESSION = 'gdx-session-3';
    // Empty args triggers server-summary path
    const result = await agg.callTool('ch1tty/search', { sessionId: SESSION });
    const body = parseBody(result);
    // Server-summary response uses 'servers' not 'tools'
    assert.ok('servers' in body, 'server-summary path must return servers field');
    assert.ok('sessionContext' in body, 'sessionContext must be present when sessionId is given');
    const sc = body.sessionContext as Record<string, unknown>;
    const actualKeys = Object.keys(sc).sort();
    const expectedKeys = ['callCount', 'recentTools'].sort();
    assert.deepEqual(
      actualKeys,
      expectedKeys,
      `server-summary-path sessionContext key set must be exactly ${JSON.stringify(expectedKeys)}, got ${JSON.stringify(actualKeys)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDX-4: server-summary-path sessionContext key set — with sticky focus ─────

test('GDX-4: server-summary-path sessionContext has EXACTLY {activeSessionFocus, callCount, recentTools} when focus is active', async () => {
  const agg = makeAgg();
  try {
    const SESSION = 'gdx-session-4';
    // Set sticky focus via keyword search
    await agg.callTool('ch1tty/search', { query: 'list', sessionId: SESSION, focus: 'code' });
    // Now trigger server-summary path — sticky focus is inherited
    const result = await agg.callTool('ch1tty/search', { sessionId: SESSION });
    const body = parseBody(result);
    assert.ok('servers' in body, 'server-summary path must return servers field');
    assert.ok('sessionContext' in body, 'sessionContext must be present when sessionId is given');
    const sc = body.sessionContext as Record<string, unknown>;
    const actualKeys = Object.keys(sc).sort();
    const expectedKeys = ['activeSessionFocus', 'callCount', 'recentTools'].sort();
    assert.deepEqual(
      actualKeys,
      expectedKeys,
      `server-summary-path sessionContext key set with focus must be exactly ${JSON.stringify(expectedKeys)}, got ${JSON.stringify(actualKeys)}`,
    );
    assert.equal(sc.activeSessionFocus, 'code', 'activeSessionFocus must equal the sticky focus name');
  } finally {
    await agg.shutdown();
  }
});

// ── GDX-5: keyword-path top-level envelope key set when sessionId is active ───
//
// FI-1..3 froze the keyword-path envelope WITHOUT sessionId (no sessionContext
// or sessionId keys). This test freezes the envelope shape WITH sessionId active
// but no extras (no explain, no focus, no partial, no minScore, no suggestions).

test('GDX-5: keyword-path envelope has EXACTLY {latencyMs, matches, sessionContext, sessionId, total, tools} when sessionId is active', async () => {
  const agg = makeAgg();
  try {
    const SESSION = 'gdx-session-5';
    // Use a query that matches at least one tool (no partial fallback), no focus, no explain
    const result = await agg.callTool('ch1tty/search', { query: 'list', sessionId: SESSION });
    const body = parseBody(result);
    // Confirm we are on the keyword path (not server-summary)
    assert.ok('tools' in body, 'keyword path must return tools field');
    const actualKeys = Object.keys(body).sort();
    const expectedKeys = ['latencyMs', 'matches', 'sessionContext', 'sessionId', 'total', 'tools'].sort();
    assert.deepEqual(
      actualKeys,
      expectedKeys,
      `keyword-path envelope with sessionId must be exactly ${JSON.stringify(expectedKeys)}, got ${JSON.stringify(actualKeys)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
