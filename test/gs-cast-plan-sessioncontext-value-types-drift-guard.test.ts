/**
 * GS drift guard: freeze cast:plan sessionContext VALUE TYPES.
 *
 * KK froze cast:plan sessionContext BEHAVIOR (Workstream KK):
 *   - presence/absence under session vs. no-session
 *   - recentTools.length <= 5 (cap)
 *   - callCount advances after each call
 *   - activeSessionFocus present when sticky focus is set
 *   - activeSessionFocus absent when no focus set
 *   - dryRun:true path also carries sessionContext
 *
 * GK froze cast:plan top-level PRIMITIVE VALUE TYPES (resolvedBy, latencyMs, intent).
 *
 * Neither KK nor GK freezes the VALUE-TYPE constraints for sessionContext fields
 * that would catch:
 *   - callCount being Infinity or NaN (KK checks advancement, not isFinite)
 *   - callCount being a float (KK checks count > 0, not isInteger)
 *   - recentTools items being bare tool names without a '/' (KK checks
 *     recentTools.length but not the namespaced format)
 *   - recentTools item parts either side of '/' being non-empty strings
 *     ("/toolName" or "serverId/" each have exactly one '/' but are malformed)
 *   - activeSessionFocus being a non-string or empty string (KK checks a
 *     specific equality, not generic typeof + non-empty)
 *
 * GS closes those gaps for the cast:plan path (parallel to GR for cast:executed):
 *
 *   GS-1  planSessionContext.callCount is Number.isFinite (not Infinity / NaN)
 *   GS-2  planSessionContext.callCount is Number.isInteger && >= 0
 *   GS-3  planSessionContext.recentTools items each contain exactly one '/'
 *          (namespaced serverId/toolName format)
 *   GS-4  planSessionContext.recentTools items have non-empty parts either
 *          side of '/' (non-empty serverId and toolName)
 *   GS-5  planSessionContext.activeSessionFocus when present is typeof string
 *          and has length > 0
 *
 * Source: planSessionContext built in src-stdio/aggregator.ts at lines ~1585–1618.
 * Parallel: GR (cast:executed path), GN (execute session-metadata path).
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

function dlq(): string {
  return join(tmpdir(), `ch1tty-gs-${Date.now()}-${++_seq}.jsonl`);
}

const BASE_CONFIGS: ServerConfig[] = [
  { id: 'neon',   name: 'Neon DB', type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',  lazy: true },
  { id: 'stripe', name: 'Stripe',  type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
];

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
 * Run cast with confirm:true and a sessionId, return the parsed sessionContext.
 * Asserts cast:plan occurred and sessionContext is present.
 */
async function planSessionContext(
  agg: Aggregator,
  intent: string,
  sessionId: string,
): Promise<{ recentTools: string[]; callCount: number; activeSessionFocus?: string }> {
  const result = await agg.callTool('ch1tty/cast', { intent, confirm: true, sessionId });
  assert.equal(result.isError, undefined, `cast must not error for intent "${intent}"`);
  const body = JSON.parse((result.content[0] as { type: string; text: string }).text) as Record<string, unknown>;
  assert.equal(body['cast'], 'plan', `expected cast:plan, got cast="${body['cast']}"`);
  const sc = body['sessionContext'] as { recentTools: string[]; callCount: number; activeSessionFocus?: string } | undefined;
  assert.ok(sc !== undefined, 'sessionContext must be present in cast:plan when sessionId is active');
  return sc;
}

// ── GS-1: callCount is Number.isFinite ────────────────────────────────────────

test('GS-1 cast:plan sessionContext.callCount is a finite (non-Infinity non-NaN) number', async () => {
  const agg = makeAgg();
  try {
    const sc = await planSessionContext(agg, 'list neon projects', 'gs1-session');
    assert.ok(
      Number.isFinite(sc.callCount),
      `sessionContext.callCount must be finite, got ${sc.callCount}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GS-2: callCount is a non-negative integer ─────────────────────────────────

test('GS-2 cast:plan sessionContext.callCount is a non-negative integer', async () => {
  const agg = makeAgg();
  try {
    const SESSION = 'gs2-session';
    // Make a prior cast:executed call so callCount > 0 in the plan call.
    await agg.callTool('ch1tty/cast', { intent: 'list neon projects', sessionId: SESSION });
    const sc = await planSessionContext(agg, 'run sql neon', SESSION);
    assert.ok(
      Number.isInteger(sc.callCount),
      `sessionContext.callCount must be an integer, got ${sc.callCount}`,
    );
    assert.ok(sc.callCount >= 0, `sessionContext.callCount must be >= 0, got ${sc.callCount}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GS-3: recentTools items each contain exactly one '/' ─────────────────────

test('GS-3 cast:plan sessionContext.recentTools items contain exactly one "/" (namespaced)', async () => {
  const agg = makeAgg();
  try {
    const SESSION = 'gs3-session';
    // Execute first so recentTools is non-empty when plan is called.
    await agg.callTool('ch1tty/cast', { intent: 'list neon projects', sessionId: SESSION });
    const sc = await planSessionContext(agg, 'run sql neon', SESSION);
    assert.ok(sc.recentTools.length > 0, 'recentTools must be non-empty after a prior call');
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

// ── GS-4: recentTools items have non-empty parts either side of '/' ───────────

test('GS-4 cast:plan sessionContext.recentTools items have non-empty serverId and toolName parts', async () => {
  const agg = makeAgg();
  try {
    const SESSION = 'gs4-session';
    await agg.callTool('ch1tty/cast', { intent: 'list neon projects', sessionId: SESSION });
    const sc = await planSessionContext(agg, 'run sql neon', SESSION);
    assert.ok(sc.recentTools.length > 0, 'recentTools must be non-empty after a prior call');
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

// ── GS-5: activeSessionFocus when present is typeof string and non-empty ───────

test('GS-5 cast:plan sessionContext.activeSessionFocus when present is a non-empty string', async () => {
  const agg = makeAgg();
  try {
    const SESSION = 'gs5-session';
    // Set sticky focus via search before plan call to trigger activeSessionFocus.
    await agg.callTool('ch1tty/search', { query: 'database', focus: 'code', sessionId: SESSION });
    const sc = await planSessionContext(agg, 'list neon projects', SESSION);
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
