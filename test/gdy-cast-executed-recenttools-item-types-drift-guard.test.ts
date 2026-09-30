/**
 * GDY drift guard: freeze the runtime types of recentTools items in
 * ch1tty/cast sessionContext.
 *
 * GDX (gdx-cast-executed-sessioncontext-keyset-drift-guard.test.ts) freezes the
 * exact key set of sessionContext for cast:executed. GDU (gdu-execute-sessionid-
 * recenttools-item-types.test.ts) freezes recentTools item types for execute.
 * No merged test freezes the RUNTIME TYPE of each recentTools item for cast:executed —
 * a change that serialises items as {tool, count} objects instead of plain strings
 * would pass existing tests silently.
 *
 * GDY closes that gap:
 *
 *   GDY-1: cast:executed + sessionId → recentTools is an Array
 *   GDY-2: cast:executed + sessionId (two distinct casts) → every recentTools item is typeof string
 *   GDY-3: cast:executed + sessionId → every recentTools item is non-empty
 *   GDY-4: cast:executed + sessionId (two distinct casts) → every recentTools item contains '/'
 *           (namespaced server/tool format: 'serverId/toolName')
 *   GDY-5: after 3 distinct cast calls resolving to 3 distinct tools → recentTools has no duplicates
 *
 * Frozen 2026-09-29.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only)
 *   - buildCastExplanation metric freeze: not applicable (sessionContext, not explain)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;
function makeDlq(): string {
  return join(tmpdir(), `ch1tty-gdy-${Date.now()}-${++_seq}.jsonl`);
}

const NEON_CFG: ServerConfig = {
  id: 'neon',
  name: 'Neon Database',
  type: 'remote',
  access: 'readwrite',
  category: 'code',
  endpoint: 'https://neon.test/mcp',
};

const NEON_TOOLS: ToolEntry[] = [
  {
    name: 'list_projects',
    description: 'List Neon database projects',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'run_sql',
    description: 'Execute a SQL query on Neon',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  },
  {
    name: 'create_branch',
    description: 'Create a new Neon database branch',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
  },
];

function makeBackend(): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: NEON_TOOLS.length, toolCacheAge: 0 }),
    listTools: async () => NEON_TOOLS,
    callTool: async (): Promise<ToolCallResult> => ({
      content: [{ type: 'text', text: 'tool-output' }],
    }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

function makeAgg(): Aggregator {
  return new Aggregator([NEON_CFG], {
    backendFactory: () => makeBackend(),
    embedEnabled: false,
    ledgerDlqPath: makeDlq(),
  } as Parameters<typeof Aggregator.prototype.callTool>[1]);
}

/** Extract recentTools from a cast response content[0] JSON. */
function getRecentTools(result: ToolCallResult): unknown[] | undefined {
  assert.ok(Array.isArray(result.content) && result.content.length > 0, 'result.content must be non-empty');
  const item = result.content[0] as { type: string; text: string };
  assert.equal(item.type, 'text', 'content[0].type must be text');
  const parsed = JSON.parse(item.text) as Record<string, unknown>;
  if (!parsed.sessionContext || typeof parsed.sessionContext !== 'object') return undefined;
  const sc = parsed.sessionContext as Record<string, unknown>;
  if (!('recentTools' in sc)) return undefined;
  return sc.recentTools as unknown[];
}

// ── GDY-1: recentTools is an Array ────────────────────────────────────────────

test('GDY-1: cast:executed + sessionId → recentTools is an Array', async () => {
  const agg = makeAgg();
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects', sessionId: 'gdy-session-1',
  });
  const cast = JSON.parse((result.content[0] as { type: string; text: string }).text) as Record<string, unknown>;
  assert.equal(cast.cast, 'executed', `expected cast:executed, got ${cast.cast}`);
  const rt = getRecentTools(result);
  assert.ok(rt !== undefined, 'sessionContext.recentTools must be present');
  assert.ok(Array.isArray(rt), `recentTools must be an Array, got ${typeof rt}`);
  await agg.shutdown();
});

// ── GDY-2: every item is typeof 'string' ──────────────────────────────────────

test('GDY-2: cast:executed + sessionId (two distinct casts) → every recentTools item is typeof string', async () => {
  const agg = makeAgg();
  const SESSION = 'gdy-session-2';
  await agg.callTool('ch1tty/cast', { intent: 'list neon projects', sessionId: SESSION });
  const result = await agg.callTool('ch1tty/cast', { intent: 'run sql query', sessionId: SESSION });
  const cast = JSON.parse((result.content[0] as { type: string; text: string }).text) as Record<string, unknown>;
  assert.equal(cast.cast, 'executed', `expected cast:executed, got ${cast.cast}`);
  const rt = getRecentTools(result);
  assert.ok(Array.isArray(rt) && rt.length > 0, 'recentTools must be non-empty after two casts');
  for (const item of rt) {
    assert.equal(
      typeof item,
      'string',
      `recentTools item must be typeof string, got typeof ${typeof item}: ${JSON.stringify(item)}`,
    );
  }
  await agg.shutdown();
});

// ── GDY-3: every item is non-empty ────────────────────────────────────────────

test('GDY-3: cast:executed + sessionId → every recentTools item is non-empty', async () => {
  const agg = makeAgg();
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects', sessionId: 'gdy-session-3',
  });
  const rt = getRecentTools(result);
  assert.ok(Array.isArray(rt) && rt.length > 0, 'recentTools must be non-empty after cast');
  for (const item of rt) {
    assert.ok(
      typeof item === 'string' && item.length > 0,
      `recentTools item must be a non-empty string, got ${JSON.stringify(item)}`,
    );
  }
  await agg.shutdown();
});

// ── GDY-4: every item contains '/' (namespaced server/tool format) ─────────────

test('GDY-4: cast:executed + sessionId (two distinct casts) → every recentTools item contains "/" (namespaced format)', async () => {
  const agg = makeAgg();
  const SESSION = 'gdy-session-4';
  await agg.callTool('ch1tty/cast', { intent: 'list neon projects', sessionId: SESSION });
  const result = await agg.callTool('ch1tty/cast', { intent: 'execute sql', sessionId: SESSION });
  const rt = getRecentTools(result);
  assert.ok(Array.isArray(rt) && rt.length > 0, 'recentTools must be non-empty after two casts');
  for (const item of rt) {
    assert.ok(
      typeof item === 'string' && item.includes('/'),
      `recentTools item must be namespaced (server/tool), got ${JSON.stringify(item)}`,
    );
  }
  await agg.shutdown();
});

// ── GDY-5: 3 distinct cast calls → recentTools has no duplicates ──────────────

test('GDY-5: after 3 distinct cast calls resolving to distinct tools → recentTools has no duplicates', async () => {
  const agg = makeAgg();
  const SESSION = 'gdy-session-5';
  await agg.callTool('ch1tty/cast', { intent: 'list neon projects', sessionId: SESSION });
  await agg.callTool('ch1tty/cast', { intent: 'run sql query on neon', sessionId: SESSION });
  const result = await agg.callTool('ch1tty/cast', { intent: 'create a new database branch', sessionId: SESSION });
  const rt = getRecentTools(result);
  assert.ok(Array.isArray(rt), 'recentTools must be an Array');
  const unique = new Set(rt);
  assert.equal(
    unique.size,
    rt.length,
    `recentTools must have no duplicate entries, got: ${JSON.stringify(rt)}`,
  );
  await agg.shutdown();
});
