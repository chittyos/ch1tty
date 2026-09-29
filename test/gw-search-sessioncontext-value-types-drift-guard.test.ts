/**
 * GW drift guard: freeze ch1tty/search sessionContext VALUE TYPES.
 *
 * FF (search-session-context.test.ts) froze sessionContext BEHAVIOR in search:
 *   - presence/absence under different session conditions
 *   - recentTools.length capped at 5
 *   - callCount advances after tool calls
 *   - activeSessionFocus present/absent based on sticky focus state
 *
 * GP froze search top-level value types but does NOT cover sessionContext fields.
 *
 * Neither FF nor GP freezes the VALUE-TYPE constraints that would catch:
 *   - callCount being Infinity or NaN (FF checks > 0, not isFinite)
 *   - callCount being a float like 1.5 (FF checks integer count only indirectly)
 *   - recentTools items being bare tool names without '/' (FF checks inclusion)
 *   - parts either side of '/' being non-empty (""/toolName or serverId/"" form)
 *   - activeSessionFocus being typeof string (FF checks specific value equality)
 *
 * GW closes those gaps (parallel to GR for cast:executed, GS for cast:plan,
 * GN for execute):
 *
 *   GW-1  sessionContext.callCount is Number.isFinite (not Infinity / NaN)
 *          — FF checks > 0 after one call; a non-finite value between 0 and 1
 *            (NaN) would not reach that threshold and could silently pass
 *   GW-2  sessionContext.callCount is Number.isInteger && >= 0
 *          (a float callCount like 1.5 could arise if coordinator count were
 *           ever a float; FF's > 0 check only verifies advance, not integrality)
 *   GW-3  sessionContext.recentTools items each contain exactly one '/'
 *          (namespaced "serverId/toolName" format; FF checks inclusion of a full
 *           namespaced name in one test, but does not assert the format invariant
 *           for every item on every search call)
 *   GW-4  Each recentTools item has non-empty parts either side of the '/'
 *          (serverId and toolName are each non-empty strings;
 *           "/toolName" or "serverId/" each contain one '/' but pass GW-3)
 *   GW-5  sessionContext.activeSessionFocus is typeof string and has length > 0
 *          when present (FF checks equality with a specific focus name, which
 *           implies string but does not assert typeof or non-emptiness generically)
 *
 * Source: handleSearch in src-stdio/aggregator.ts lines ~658–664 + ~866:
 *   const patterns = this.coordinator.getToolPatterns(effectiveSessionId, 1000);
 *   const recentTools = patterns.slice(0, 5).map((p) => p.tool);
 *   const callCount = patterns.reduce((sum, p) => sum + p.count, 0);
 *   const activeSessionFocus = this.coordinator.getSessionFocus(effectiveSessionId);
 *   sessionContext = { recentTools, callCount, ...(activeSessionFocus ? { activeSessionFocus } : {}) };
 *   ...{ ...(sessionContext ? { sessionContext } : {}) }
 *
 * Frozen 2026-09-27.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (search sessionContext, not cast explain)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gw-${Date.now()}-${++_seq}.jsonl`);
}

const BASE_CONFIGS: ServerConfig[] = [
  { id: 'neon',   name: 'Neon DB', type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',  lazy: true },
  { id: 'stripe', name: 'Stripe',  type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
];

const FOCUS_PROFILES = {
  profiles: {
    code: {
      description: 'Software development tools',
      categories: ['code' as const],
      servers: ['neon'],
      boost: 0.5,
    },
  },
};

function makeAgg(opts: { focusProfiles?: typeof FOCUS_PROFILES } = {}): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon',   FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    ...(opts.focusProfiles ? { focusProfiles: opts.focusProfiles } : {}),
  });
}

/**
 * Execute a tool via ch1tty/execute to seed the session's toolPatterns, then
 * call ch1tty/search to get sessionContext reflecting those patterns.
 *
 * recentTools in search sessionContext comes from coordinator.getToolPatterns,
 * which is populated only by actual tool executions (onToolCall), not by search
 * calls. Search calls populate sessionContext.callCount=0 and recentTools=[]
 * until at least one execute/cast call has run for the session.
 */
async function searchSessionContextAfterExecute(
  agg: Aggregator,
  sessionId: string,
): Promise<{ recentTools: string[]; callCount: number; activeSessionFocus?: string }> {
  // Seed coordinator toolPatterns via execute
  await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', args: {}, sessionId });
  // Read sessionContext via search
  const result = await agg.callTool('ch1tty/search', { query: 'database', sessionId });
  assert.equal(result.isError, undefined, 'search must not error');
  const body = JSON.parse((result.content[0] as { type: string; text: string }).text) as Record<string, unknown>;
  const sc = body['sessionContext'] as { recentTools: string[]; callCount: number; activeSessionFocus?: string } | undefined;
  assert.ok(sc !== undefined, 'sessionContext must be present when sessionId is active');
  return sc;
}

/**
 * Issue a search with a sessionId and return the parsed sessionContext.
 * For tests that only need callCount/activeSessionFocus (not recentTools),
 * no execute seeding is required.
 */
async function searchSessionContext(
  agg: Aggregator,
  sessionId: string,
  query: string,
): Promise<{ recentTools: string[]; callCount: number; activeSessionFocus?: string }> {
  const result = await agg.callTool('ch1tty/search', { query, sessionId });
  assert.equal(result.isError, undefined, 'search must not error');
  const body = JSON.parse((result.content[0] as { type: string; text: string }).text) as Record<string, unknown>;
  const sc = body['sessionContext'] as { recentTools: string[]; callCount: number; activeSessionFocus?: string } | undefined;
  assert.ok(sc !== undefined, 'sessionContext must be present when sessionId is active');
  return sc;
}

// ── GW-1: callCount is Number.isFinite ────────────────────────────────────────

test('GW-1 search sessionContext.callCount is a finite (non-Infinity non-NaN) number', async () => {
  const agg = makeAgg();
  try {
    // callCount reflects coordinator toolPatterns; seed with execute first to
    // get a non-zero value, which makes the finite/integer check non-trivial.
    const sc = await searchSessionContextAfterExecute(agg, 'gw1-session');
    assert.ok(
      Number.isFinite(sc.callCount),
      `sessionContext.callCount must be finite, got ${sc.callCount}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GW-2: callCount is a non-negative integer ─────────────────────────────────

test('GW-2 search sessionContext.callCount is a non-negative integer', async () => {
  const agg = makeAgg();
  try {
    const SESSION = 'gw2-session';
    // Execute twice so callCount > 0 and integrality is checked on a non-zero value.
    await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', args: {}, sessionId: SESSION });
    const sc = await searchSessionContextAfterExecute(agg, SESSION);
    assert.ok(
      Number.isInteger(sc.callCount),
      `sessionContext.callCount must be an integer, got ${sc.callCount}`,
    );
    assert.ok(sc.callCount >= 0, `sessionContext.callCount must be >= 0, got ${sc.callCount}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GW-3: recentTools items each contain exactly one '/' ─────────────────────

test('GW-3 search sessionContext.recentTools items contain exactly one "/" (namespaced)', async () => {
  const agg = makeAgg();
  try {
    const sc = await searchSessionContextAfterExecute(agg, 'gw3-session');
    assert.ok(sc.recentTools.length > 0, 'recentTools must be non-empty after an execute call');
    for (const tool of sc.recentTools) {
      const slashCount = (tool.match(/\//g) ?? []).length;
      assert.equal(
        slashCount,
        1,
        `recentTools item must contain exactly one '/' (namespaced serverId/toolName), got "${tool}"`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GW-4: recentTools items have non-empty parts either side of '/' ───────────

test('GW-4 search sessionContext.recentTools items have non-empty serverId and toolName parts', async () => {
  const agg = makeAgg();
  try {
    const sc = await searchSessionContextAfterExecute(agg, 'gw4-session');
    assert.ok(sc.recentTools.length > 0, 'recentTools must be non-empty after an execute call');
    for (const tool of sc.recentTools) {
      const idx = tool.indexOf('/');
      const serverId = tool.slice(0, idx);
      const toolName = tool.slice(idx + 1);
      assert.ok(
        serverId.length > 0,
        `recentTools item serverId (before '/') must be non-empty, got "${tool}"`,
      );
      assert.ok(
        toolName.length > 0,
        `recentTools item toolName (after '/') must be non-empty, got "${tool}"`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GW-5: activeSessionFocus when present is typeof string and non-empty ───────

test('GW-5 search sessionContext.activeSessionFocus when present is a non-empty string', async () => {
  const agg = makeAgg({ focusProfiles: FOCUS_PROFILES });
  try {
    const SESSION = 'gw5-session';
    // Set sticky focus via a search call with focus:'code'
    await agg.callTool('ch1tty/search', { query: 'database', focus: 'code', sessionId: SESSION });
    const result = await agg.callTool('ch1tty/search', { query: 'database', sessionId: SESSION });
    assert.equal(result.isError, undefined, 'search must not error');
    const body = JSON.parse((result.content[0] as { type: string; text: string }).text) as Record<string, unknown>;
    const sc = body['sessionContext'] as { recentTools: string[]; callCount: number; activeSessionFocus?: string } | undefined;
    assert.ok(sc !== undefined, 'sessionContext must be present when sessionId is active');
    assert.ok('activeSessionFocus' in sc, 'activeSessionFocus must be present after setting sticky focus');
    assert.equal(
      typeof sc.activeSessionFocus,
      'string',
      `activeSessionFocus must be typeof string, got ${typeof sc.activeSessionFocus}`,
    );
    assert.ok(
      (sc.activeSessionFocus as string).length > 0,
      `activeSessionFocus must be a non-empty string, got "${sc.activeSessionFocus}"`,
    );
  } finally {
    await agg.shutdown();
  }
});
