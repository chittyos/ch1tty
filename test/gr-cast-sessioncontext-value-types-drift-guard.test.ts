/**
 * GR drift guard: freeze cast:executed sessionContext VALUE TYPES.
 *
 * EI froze the sessionContext KEY SET for cast responses:
 *   - required: { callCount, recentTools }
 *   - optional: activeSessionFocus
 *
 * JJ froze sessionContext BEHAVIOR in cast:executed:
 *   - presence/absence under different session conditions
 *   - recentTools.length <= 5 (cap)
 *   - callCount >= 3 after three calls (counter advances)
 *   - activeSessionFocus === 'code' when focus is set (specific value)
 *
 * Neither EI nor JJ freezes the VALUE-TYPE constraints that would catch:
 *   - callCount being Infinity or NaN (JJ checks >= 3, not isFinite)
 *   - callCount being a float like 3.5 (JJ checks >= 3, not isInteger)
 *   - recentTools items being bare tool names without a '/' (JJ checks
 *     length > 0 but not the namespaced format)
 *   - recentTools item parts either side of '/' being non-empty strings
 *     (a "/toolName" or "serverId/" form would pass JJ's length check)
 *   - activeSessionFocus being typeof string (JJ checks equality with 'code',
 *     which implies string, but does not explicitly assert typeof)
 *
 * GR closes those gaps (parallel to GN for the execute path):
 *
 *   GR-1  sessionContext.callCount is Number.isFinite (not Infinity / NaN)
 *          — JJ checks `>= 3`, which both Infinity and NaN fail to satisfy
 *            only after 3 calls; a value between 0 and 2 that is non-finite
 *            would silently pass
 *   GR-2  sessionContext.callCount is Number.isInteger && >= 0
 *          (a float callCount like 1.5 passes JJ's `>= 3` after 3 calls
 *           only because 3*1.5 is not the accumulation pattern; for callCount
 *           derived from ctxPat.reduce, the reduce could emit a float if
 *           pattern.count were ever a float — EI never asserts integer type)
 *   GR-3  sessionContext.recentTools items each contain exactly one '/'
 *          (namespaced "serverId/toolName" format; JJ-2 only checks
 *           recentTools.length > 0 — a bare tool name without '/' passes)
 *   GR-4  Each recentTools item has non-empty parts either side of the '/'
 *          (serverId and toolName are each non-empty strings;
 *           "/toolName" or "serverId/" each contain one '/' but pass GR-3)
 *   GR-5  sessionContext.activeSessionFocus is typeof string and has length > 0
 *          when present (JJ-5 checks equality with 'code' but does not
 *           assert typeof or non-emptiness as generic invariants)
 *
 * Source: handleCast in src-stdio/aggregator.ts — castSessionContext built at
 *   lines ~1636–1645 from coordinator.getToolPatterns + getSessionFocus.
 *   Parallel path for cast:plan: planSessionContext at lines ~1582–1596.
 *
 * Frozen 2026-09-21.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (sessionContext, not explain)
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

/** Returns a unique temp-file path for this test's ledger DLQ. */
function dlq(): string {
  return join(tmpdir(), `ch1tty-gr-${Date.now()}-${++_seq}.jsonl`);
}

const BASE_CONFIGS: ServerConfig[] = [
  { id: 'neon',   name: 'Neon DB', type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',         lazy: true },
  { id: 'stripe', name: 'Stripe',  type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp',         lazy: true },
];

/** Creates a fully isolated Aggregator with two fixture servers. */
function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon',   FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
}

/**
 * Execute a cast with a sessionId and return the parsed sessionContext.
 * Asserts that cast:executed succeeded and that sessionContext is present.
 */
async function castSessionContext(
  agg: Aggregator,
  intent: string,
  sessionId: string,
): Promise<{ recentTools: string[]; callCount: number; activeSessionFocus?: string }> {
  const result = await agg.callTool('ch1tty/cast', { intent, sessionId });
  assert.equal(result.isError, undefined, `cast must not error for intent "${intent}"`);
  const body = JSON.parse((result.content[0] as { type: string; text: string }).text) as Record<string, unknown>;
  assert.equal(body['cast'], 'executed', `expected cast:executed, got cast="${body['cast']}"`);
  const sc = body['sessionContext'] as { recentTools: string[]; callCount: number; activeSessionFocus?: string } | undefined;
  assert.ok(sc !== undefined, 'sessionContext must be present when sessionId is active');
  return sc;
}

// ── GR-1: callCount is Number.isFinite ────────────────────────────────────────

test('GR-1 cast:executed sessionContext.callCount is a finite (non-Infinity non-NaN) number', async () => {
  const agg = makeAgg();
  try {
    const sc = await castSessionContext(agg, 'list neon projects', 'gr1-session');
    assert.ok(
      Number.isFinite(sc.callCount),
      `sessionContext.callCount must be finite, got ${sc.callCount}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GR-2: callCount is a non-negative integer ─────────────────────────────────

test('GR-2 cast:executed sessionContext.callCount is a non-negative integer', async () => {
  const agg = makeAgg();
  try {
    // Make two distinct calls so callCount > 0 and we can check integrality.
    const SESSION = 'gr2-session';
    await agg.callTool('ch1tty/cast', { intent: 'list neon projects', sessionId: SESSION });
    const sc = await castSessionContext(agg, 'run sql neon', SESSION);
    assert.ok(
      Number.isInteger(sc.callCount),
      `sessionContext.callCount must be an integer, got ${sc.callCount}`,
    );
    assert.ok(sc.callCount >= 0, `sessionContext.callCount must be >= 0, got ${sc.callCount}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GR-3: recentTools items each contain exactly one '/' ─────────────────────

test('GR-3 cast:executed sessionContext.recentTools items contain exactly one "/" (namespaced)', async () => {
  const agg = makeAgg();
  try {
    const SESSION = 'gr3-session';
    await agg.callTool('ch1tty/cast', { intent: 'list neon projects', sessionId: SESSION });
    const sc = await castSessionContext(agg, 'run sql neon', SESSION);
    assert.ok(sc.recentTools.length > 0, 'recentTools must be non-empty after two calls');
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

// ── GR-4: recentTools items have non-empty parts either side of '/' ───────────

test('GR-4 cast:executed sessionContext.recentTools items have non-empty serverId and toolName parts', async () => {
  const agg = makeAgg();
  try {
    const SESSION = 'gr4-session';
    await agg.callTool('ch1tty/cast', { intent: 'list neon projects', sessionId: SESSION });
    const sc = await castSessionContext(agg, 'run sql neon', SESSION);
    assert.ok(sc.recentTools.length > 0, 'recentTools must be non-empty after two calls');
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

// ── GR-5: activeSessionFocus when present is typeof string and non-empty ───────

test('GR-5 cast:executed sessionContext.activeSessionFocus when present is a non-empty string', async () => {
  const agg = makeAgg();
  try {
    const SESSION = 'gr5-session';
    // Set sticky focus via search before cast to trigger activeSessionFocus.
    await agg.callTool('ch1tty/search', { query: 'database', focus: 'code', sessionId: SESSION });
    const sc = await castSessionContext(agg, 'list neon projects', SESSION);
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
