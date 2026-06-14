/**
 * Workstream MM: sessionContext in cast: no_match responses.
 *
 * cast: no_match fires when no tools, prompts, OR resources score above the
 * threshold for the given intent. With this change, when a sessionId is active
 * the response includes sessionContext: { recentTools, callCount,
 * activeSessionFocus? } reflecting pre-execution session state — completing
 * sessionContext coverage for all six cast response shapes.
 *
 * Covered:
 *   1. No sessionId → sessionContext absent in cast: no_match
 *   2. Fresh session, no prior calls → sessionContext present: recentTools: [], callCount: 0
 *   3. confirm:true does not redirect to cast:plan when nothing matches; sessionContext present
 *   4. dryRun:true does not redirect to cast:resolved when nothing matches; sessionContext present
 *   5. Sticky focus set before cast → activeSessionFocus present in sessionContext
 *   6. No sticky focus → activeSessionFocus absent from sessionContext
 *   7. Scope annotation + sessionContext — no_match with scope narrowing carries both fields
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-mm-${label}-${Date.now()}.jsonl`);
}

const FOCUS_PROFILES = {
  profiles: {
    code: { description: 'Code tools', categories: ['code' as const], servers: ['neon'], boost: 0.5 },
  },
};

// A backend with distinctive tool names so the no-match intent ("zzz-xyz-wzzz-nomatch")
// cannot accidentally keyword-match or score above the 0.1 threshold.
const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite', category: 'code',
  endpoint: 'https://neon.test/mcp',
};

const NEON_TOOLS: ToolEntry[] = [
  { name: 'list_projects', description: 'List Neon projects', inputSchema: { type: 'object', properties: {} } },
  { name: 'run_sql', description: 'Run SQL queries on Neon', inputSchema: { type: 'object', properties: {} } },
];

// Nonsensical intent that will never match tool/prompt/resource names or descriptions.
const NO_MATCH_INTENT = 'zzz-xyz-wzzz-nomatch-qqq-vvv';

function makeNeonBackend(): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: NEON_TOOLS.length, toolCacheAge: 0 }),
    listTools: async () => NEON_TOOLS,
    callTool: async (): Promise<ToolCallResult> => ({ content: [{ type: 'text', text: 'neon-output' }] }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

function makeAgg(label: string): Aggregator {
  return new Aggregator([NEON_CFG], {
    focusProfiles: FOCUS_PROFILES,
    backendFactory: () => makeNeonBackend(),
    embedEnabled: false,
    ledgerDlqPath: dlqPath(label),
  });
}

function parseCast(result: ToolCallResult): Record<string, unknown> {
  const first = result.content[0];
  assert.equal(first?.type, 'text');
  return JSON.parse(first.text) as Record<string, unknown>;
}

// ── 1. No sessionId → sessionContext absent ───────────────────────────────────

test('cast: no_match — no sessionId → sessionContext absent', async () => {
  const agg = makeAgg('1-no-session');
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: NO_MATCH_INTENT });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'no_match', `expected no_match, got: ${cast.cast}`);
    assert.equal('sessionContext' in cast, false, 'sessionContext must be absent without sessionId');
  } finally {
    await agg.shutdown();
  }
});

// ── 2. Fresh session → sessionContext present: recentTools: [], callCount: 0 ──

test('cast: no_match — fresh sessionId → sessionContext present with empty state', async () => {
  const agg = makeAgg('2-fresh-session');
  try {
    const SESSION = 'mm-fresh-session';
    const result = await agg.callTool('ch1tty/cast', { intent: NO_MATCH_INTENT, sessionId: SESSION });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'no_match', `expected no_match, got: ${cast.cast}`);
    const sc = cast.sessionContext as { recentTools: string[]; callCount: number } | undefined;
    assert.ok(sc, 'sessionContext should be present when sessionId is active');
    assert.deepEqual(sc.recentTools, [], 'recentTools should be empty for a fresh session');
    assert.equal(sc.callCount, 0, 'callCount should be 0 for a fresh session');
  } finally {
    await agg.shutdown();
  }
});

// ── 3. confirm:true does not redirect to cast:plan when nothing matches ────────
// The no_match gate fires before the confirm check — plan requires a best tool.

test('cast: no_match — confirm:true does not redirect to plan; sessionContext present', async () => {
  const agg = makeAgg('3-confirm');
  try {
    const SESSION = 'mm-confirm-session';
    const result = await agg.callTool('ch1tty/cast', {
      intent: NO_MATCH_INTENT,
      confirm: true,
      sessionId: SESSION,
    });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'no_match', `confirm:true must not redirect to plan when nothing matches (got ${cast.cast})`);
    const sc = cast.sessionContext as { recentTools: string[]; callCount: number } | undefined;
    assert.ok(sc, 'sessionContext should be present even when confirm:true yields no_match');
    assert.deepEqual(sc.recentTools, [], 'recentTools should be empty for a fresh session');
    assert.equal(sc.callCount, 0, 'callCount should be 0 for a fresh session');
  } finally {
    await agg.shutdown();
  }
});

// ── 4. dryRun:true does not redirect to cast:resolved when nothing matches ────
// The no_match gate fires before the dryRun check — resolved requires a best tool.

test('cast: no_match — dryRun:true does not redirect to resolved; sessionContext present', async () => {
  const agg = makeAgg('4-dryrun');
  try {
    const SESSION = 'mm-dryrun-session';
    const result = await agg.callTool('ch1tty/cast', {
      intent: NO_MATCH_INTENT,
      dryRun: true,
      sessionId: SESSION,
    });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'no_match', `dryRun:true must not redirect to resolved when nothing matches (got ${cast.cast})`);
    const sc = cast.sessionContext as { recentTools: string[]; callCount: number } | undefined;
    assert.ok(sc, 'sessionContext should be present even when dryRun:true yields no_match');
    assert.deepEqual(sc.recentTools, [], 'recentTools should be empty for a fresh session');
    assert.equal(sc.callCount, 0, 'callCount should be 0 for a fresh session');
  } finally {
    await agg.shutdown();
  }
});

// ── 5. Sticky focus set → activeSessionFocus present ─────────────────────────

test('cast: no_match — sticky focus set → activeSessionFocus present in sessionContext', async () => {
  const agg = makeAgg('5-focus');
  try {
    const SESSION = 'mm-focus-session';
    // Set sticky focus via search (does not add server affinity)
    await agg.callTool('ch1tty/search', { query: 'sql neon', focus: 'code', sessionId: SESSION });
    const result = await agg.callTool('ch1tty/cast', { intent: NO_MATCH_INTENT, sessionId: SESSION });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'no_match', `expected no_match, got: ${cast.cast}`);
    const sc = cast.sessionContext as { activeSessionFocus?: string } | undefined;
    assert.ok(sc, 'sessionContext should be present');
    assert.equal(sc.activeSessionFocus, 'code', 'activeSessionFocus should be "code" when sticky focus is set');
  } finally {
    await agg.shutdown();
  }
});

// ── 6. No sticky focus → activeSessionFocus absent ───────────────────────────

test('cast: no_match — no focus set → activeSessionFocus absent from sessionContext', async () => {
  const agg = makeAgg('6-no-focus');
  try {
    const SESSION = 'mm-nofocus-session';
    const result = await agg.callTool('ch1tty/cast', { intent: NO_MATCH_INTENT, sessionId: SESSION });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'no_match', `expected no_match, got: ${cast.cast}`);
    const sc = cast.sessionContext as Record<string, unknown> | undefined;
    assert.ok(sc, 'sessionContext should be present');
    assert.equal('activeSessionFocus' in sc, false, 'activeSessionFocus should be absent when no focus set');
  } finally {
    await agg.shutdown();
  }
});

// ── 7. Scope annotation + sessionContext co-exist ─────────────────────────────
// When scope narrows the registry to a server whose tools still don't match the
// intent, no_match includes both the scope annotation and sessionContext.

test('cast: no_match — scope annotation and sessionContext both present', async () => {
  const agg = makeAgg('7-scope');
  try {
    const SESSION = 'mm-scope-session';
    const result = await agg.callTool('ch1tty/cast', {
      intent: NO_MATCH_INTENT,
      scope: { servers: ['neon'] },
      sessionId: SESSION,
    });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'no_match', `expected no_match, got: ${cast.cast}`);
    const sc = cast.sessionContext as { recentTools: string[]; callCount: number } | undefined;
    assert.ok(sc, 'sessionContext should be present alongside scope annotation');
    assert.deepEqual(sc.recentTools, [], 'recentTools should be empty for a fresh session');
    assert.equal(sc.callCount, 0, 'callCount should be 0 for a fresh session');
    const scope = cast.scope as { servers?: string[] } | undefined;
    assert.ok(scope, 'scope annotation should also be present');
    assert.deepEqual(scope.servers, ['neon'], 'scope.servers should be populated');
  } finally {
    await agg.shutdown();
  }
});
