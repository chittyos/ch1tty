/**
 * GDX drift guard: freeze cast:executed sessionContext sub-object exact key set.
 *
 * JJ (jj-cast-session-context.test.ts) verifies sessionContext PRESENCE and VALUE
 * semantics for cast:executed (recentTools content, callCount, activeSessionFocus).
 * EG (eg-cast-no-unexpected-keys.test.ts) verifies sessionContext appears as a
 * permitted top-level key.
 * But no merged test freezes the EXACT key set of the sessionContext sub-object
 * itself: that it has EXACTLY {recentTools, callCount} (no focus) or EXACTLY
 * {recentTools, callCount, activeSessionFocus} (focus active) — and nothing else.
 *
 * GDX closes that gap:
 *
 *   GDX-1: cast:executed + sessionId (no focus) → sessionContext has EXACTLY
 *           {recentTools, callCount}
 *   GDX-2: cast:executed + sessionId + sticky focus → sessionContext has EXACTLY
 *           {recentTools, callCount, activeSessionFocus}
 *   GDX-3: cast:executed + sticky focus → activeSessionFocus value equals the
 *           set focus string (no coercion, no extra wrapping)
 *   GDX-4: cast:executed + sessionId after multiple calls → sessionContext key set
 *           unchanged after call-count growth (no drift from accumulated state)
 *   GDX-5: cast:resolved (dryRun) + sessionId (no focus) → sessionContext has
 *           EXACTLY {recentTools, callCount}
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
  return join(tmpdir(), `ch1tty-gdx-${Date.now()}-${++_seq}.jsonl`);
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
    description: 'List Neon projects',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'run_sql',
    description: 'Run SQL query on Neon',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
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

/** Parse cast body JSON from content[0]. */
function parseCast(result: ToolCallResult): Record<string, unknown> {
  assert.ok(Array.isArray(result.content) && result.content.length > 0, 'result.content must be non-empty');
  const item = result.content[0] as { type: string; text: string };
  assert.equal(item.type, 'text', 'content[0].type must be text');
  return JSON.parse(item.text) as Record<string, unknown>;
}

const SESSION = 'gdx-session-1';
const FOCUS_NAME = 'code';

// ── GDX-1: no focus → sessionContext has EXACTLY {recentTools, callCount} ────

test('GDX-1: cast:executed + sessionId (no focus) → sessionContext has EXACTLY {recentTools, callCount}', async () => {
  const agg = makeAgg();
  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', sessionId: SESSION });
  const cast = parseCast(result);
  assert.equal(cast.cast, 'executed', `expected cast:executed, got ${cast.cast}`);
  const sc = cast.sessionContext as Record<string, unknown> | undefined;
  assert.ok(sc !== undefined && sc !== null, 'sessionContext should be present when sessionId is active');
  const keys = Object.keys(sc).sort();
  assert.deepEqual(keys, ['callCount', 'recentTools'], `sessionContext must have EXACTLY {recentTools, callCount}, got keys: ${JSON.stringify(keys)}`);
});

// ── GDX-2: sticky focus → sessionContext has EXACTLY {recentTools, callCount, activeSessionFocus} ──

test('GDX-2: cast:executed + sessionId + sticky focus → sessionContext has EXACTLY {recentTools, callCount, activeSessionFocus}', async () => {
  const agg = makeAgg();
  const SESSION2 = 'gdx-session-2';
  // Set sticky focus via search with focus + sessionId
  await agg.callTool('ch1tty/search', { query: 'neon', focus: FOCUS_NAME, sessionId: SESSION2 });
  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', sessionId: SESSION2 });
  const cast = parseCast(result);
  assert.equal(cast.cast, 'executed', `expected cast:executed, got ${cast.cast}`);
  const sc = cast.sessionContext as Record<string, unknown> | undefined;
  assert.ok(sc !== undefined && sc !== null, 'sessionContext should be present when sessionId is active');
  const keys = Object.keys(sc).sort();
  assert.deepEqual(keys, ['activeSessionFocus', 'callCount', 'recentTools'], `sessionContext with focus must have EXACTLY {recentTools, callCount, activeSessionFocus}, got keys: ${JSON.stringify(keys)}`);
});

// ── GDX-3: activeSessionFocus value equals the set focus string ───────────────

test('GDX-3: cast:executed + sticky focus → activeSessionFocus value equals the set focus string', async () => {
  const agg = makeAgg();
  const SESSION3 = 'gdx-session-3';
  await agg.callTool('ch1tty/search', { query: 'neon', focus: FOCUS_NAME, sessionId: SESSION3 });
  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', sessionId: SESSION3 });
  const cast = parseCast(result);
  const sc = cast.sessionContext as Record<string, unknown> | undefined;
  assert.ok(sc, 'sessionContext must be present');
  assert.equal(sc.activeSessionFocus, FOCUS_NAME, `activeSessionFocus must equal '${FOCUS_NAME}', got ${JSON.stringify(sc.activeSessionFocus)}`);
});

// ── GDX-4: sessionContext key set unchanged after multiple calls (no drift) ───

test('GDX-4: cast:executed + sessionId after multiple calls → sessionContext key set unchanged from call-count growth', async () => {
  const agg = makeAgg();
  const SESSION4 = 'gdx-session-4';
  // Make several cast calls to accumulate state
  for (let i = 0; i < 3; i++) {
    await agg.callTool('ch1tty/cast', { intent: 'list neon projects', sessionId: SESSION4 });
  }
  const result = await agg.callTool('ch1tty/cast', { intent: 'run sql query', sessionId: SESSION4 });
  const cast = parseCast(result);
  assert.equal(cast.cast, 'executed', `expected cast:executed, got ${cast.cast}`);
  const sc = cast.sessionContext as Record<string, unknown> | undefined;
  assert.ok(sc, 'sessionContext must be present after multiple calls');
  const keys = Object.keys(sc).sort();
  assert.deepEqual(keys, ['callCount', 'recentTools'], `sessionContext key set must remain EXACTLY {recentTools, callCount} even after multiple calls; got: ${JSON.stringify(keys)}`);
});

// ── GDX-5: cast:resolved (dryRun) + sessionId → sessionContext EXACTLY {recentTools, callCount} ──

test('GDX-5: cast:resolved (dryRun) + sessionId (no focus) → sessionContext has EXACTLY {recentTools, callCount}', async () => {
  const agg = makeAgg();
  const SESSION5 = 'gdx-session-5';
  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', sessionId: SESSION5, dryRun: true });
  const cast = parseCast(result);
  assert.equal(cast.cast, 'resolved', `expected cast:resolved (dryRun), got ${cast.cast}`);
  const sc = cast.sessionContext as Record<string, unknown> | undefined;
  assert.ok(sc !== undefined && sc !== null, 'sessionContext should be present in cast:resolved when sessionId is active');
  const keys = Object.keys(sc).sort();
  assert.deepEqual(keys, ['callCount', 'recentTools'], `cast:resolved sessionContext must have EXACTLY {recentTools, callCount}, got keys: ${JSON.stringify(keys)}`);
});
