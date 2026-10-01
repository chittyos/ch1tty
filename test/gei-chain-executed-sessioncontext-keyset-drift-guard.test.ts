/**
 * GEI drift guard: freeze cast:chain_executed sessionContext sub-object exact key set.
 *
 * GDX froze sessionContext exact key set for cast:executed and cast:resolved.
 * GDD froze sessionContext exact key set for ch1tty/execute.
 * GBI-3 asserts chain_executed + sessionId adds exactly `sessionContext` at the
 * top level — but does NOT freeze what is INSIDE that sub-object.
 *
 * No test on main freezes the EXACT KEY SET of the sessionContext sub-object
 * for cast:chain_executed. The sub-object is built at a distinct code path
 * (src-stdio/aggregator.ts ~line 1516):
 *
 *   chainSessionContext = {
 *     recentTools: ctxPat.slice(0, 5).map((p) => p.tool),
 *     callCount:   ctxPat.reduce((s, p) => s + p.count, 0),
 *     ...(sfocus ? { activeSessionFocus: sfocus } : {}),
 *   };
 *
 * A regression that renames `recentTools` → `tools`, unconditionally emits
 * `activeSessionFocus` when no sticky focus is set, or adds a new field like
 * `serverAffinity` would pass GBI-3 (top-level key set check only) silently.
 *
 * GEI freezes:
 *
 *   GEI-1  chain_executed + sessionId, no per-call/sticky focus → sessionContext
 *           has EXACTLY {recentTools, callCount} — activeSessionFocus ABSENT.
 *           (GBI-3 only checks the top-level key; it never inspects the sub-object.)
 *
 *   GEI-2  chain_executed + sessionId + per-call focus → sessionContext has
 *           EXACTLY {recentTools, callCount, activeSessionFocus} — 3 keys, no extras.
 *           (A regression adding a 4th key would pass every prior test silently.)
 *
 *   GEI-3  sessionContext.activeSessionFocus value equals the per-call focus name
 *           (value-identity freeze: not just present, but the right string).
 *
 *   GEI-4  sessionContext.recentTools is an Array (not a Set, string, or object).
 *           (Type freeze for the array field; the 2-key guard alone doesn't prevent
 *            a type regression on the value.)
 *
 *   GEI-5  sessionContext.callCount is a finite non-negative integer.
 *           (Value-constraint freeze; a regression emitting NaN or a string
 *            would pass every prior test.)
 *
 * Setup:
 *   - Default process focus 'code' (required for catalogCombo + chain to fire).
 *   - Catalog has a 2-step 'code' combo (list_projects → create_project).
 *   - Both steps succeed (non-text content) so `summary` is absent (clean top level).
 *   - GEI-1: cast called with sessionId, no per-call focus → no setSessionFocus.
 *   - GEI-2/3: cast called with sessionId + focus:'code' → setSessionFocus fires
 *     in resolveActiveFocus; chainSessionContext reads it back via getSessionFocus.
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (sessionContext sub-object,
 *     not explanation fields)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Frozen key sets ────────────────────────────────────────────────────────────

const SESSION_CTX_NO_FOCUS: readonly string[] = ['callCount', 'recentTools'];
const SESSION_CTX_WITH_FOCUS: readonly string[] = ['activeSessionFocus', 'callCount', 'recentTools'];

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CATALOG = {
  code: {
    description: 'Code focus',
    combos: [{
      name: 'neon-setup',
      chain: ['neon/list_projects', 'neon/create_project'],
      accomplishes: 'List then create a Neon project',
      verified: true,
    }],
    prompts: [],
  },
};

const FOCUS_PROFILES = {
  profiles: {
    code: { categories: ['code' as const], servers: ['neon'], boost: 0.5 },
  },
};

const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true,
};

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gei-${Date.now()}-${++_seq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [
      {
        name: 'list_projects',
        description: 'list neon database projects',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'resource', resource: { uri: 'neon://projects', name: 'projects' } }] },
      },
      {
        name: 'create_project',
        description: 'create a neon database project',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
        response: { content: [{ type: 'resource', resource: { uri: 'neon://project/new', name: 'new-project' } }] },
      },
    ],
  });
  const path = dlq();
  return new Aggregator([NEON_CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: CATALOG,
    focusProfiles: FOCUS_PROFILES,
    focus: 'code',
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

const INTENT = 'list neon database projects';

async function castChainWithSession(
  agg: Aggregator,
  sessionId: string,
  perCallFocus?: string,
): Promise<Record<string, unknown>> {
  const args: Record<string, unknown> = { intent: INTENT, chain: true, sessionId };
  if (perCallFocus !== undefined) args.focus = perCallFocus;
  const result = await agg.callTool('ch1tty/cast', args);
  assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body['cast'], 'chain_executed',
    `expected chain_executed, got ${String(body['cast'])}`);
  return body;
}

// ── GEI-1: no sticky focus → sessionContext has EXACTLY {recentTools, callCount} ─

test('GEI-1: chain_executed + sessionId, no per-call focus → sessionContext exact keys {recentTools, callCount}', async () => {
  const agg = makeAgg();
  try {
    // No per-call focus → resolveActiveFocus falls back to process default without
    // calling setSessionFocus → getSessionFocus returns undefined → activeSessionFocus absent.
    const body = await castChainWithSession(agg, 'gei-test-session-1');
    const sc = body['sessionContext'] as Record<string, unknown>;
    assert.ok(sc !== null && typeof sc === 'object' && !Array.isArray(sc),
      `sessionContext must be a non-null plain object, got ${typeof sc}`);
    const actual = Object.keys(sc).sort();
    assert.deepEqual(actual, [...SESSION_CTX_NO_FOCUS],
      `sessionContext key set mismatch (no focus).\n  expected: ${JSON.stringify(SESSION_CTX_NO_FOCUS)}\n  actual:   ${JSON.stringify(actual)}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GEI-2: per-call focus → sessionContext has EXACTLY {recentTools, callCount, activeSessionFocus} ─

test('GEI-2: chain_executed + sessionId + per-call focus → sessionContext exact keys {recentTools, callCount, activeSessionFocus}', async () => {
  const agg = makeAgg();
  try {
    // Per-call focus → resolveActiveFocus calls setSessionFocus(sessionId, 'code') →
    // chainSessionContext reads it back → activeSessionFocus present.
    const body = await castChainWithSession(agg, 'gei-test-session-2', 'code');
    const sc = body['sessionContext'] as Record<string, unknown>;
    assert.ok(sc !== null && typeof sc === 'object' && !Array.isArray(sc),
      `sessionContext must be a non-null plain object, got ${typeof sc}`);
    const actual = Object.keys(sc).sort();
    assert.deepEqual(actual, [...SESSION_CTX_WITH_FOCUS],
      `sessionContext key set mismatch (with focus).\n  expected: ${JSON.stringify(SESSION_CTX_WITH_FOCUS)}\n  actual:   ${JSON.stringify(actual)}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GEI-3: activeSessionFocus value equals the per-call focus name ────────────

test('GEI-3: sessionContext.activeSessionFocus equals the per-call focus name', async () => {
  const agg = makeAgg();
  try {
    const body = await castChainWithSession(agg, 'gei-test-session-3', 'code');
    const sc = body['sessionContext'] as Record<string, unknown>;
    assert.equal(sc['activeSessionFocus'], 'code',
      `sessionContext.activeSessionFocus must equal 'code', got ${JSON.stringify(sc['activeSessionFocus'])}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GEI-4: recentTools is an Array ───────────────────────────────────────────

test('GEI-4: sessionContext.recentTools is an Array (not a Set, string, or object)', async () => {
  const agg = makeAgg();
  try {
    const body = await castChainWithSession(agg, 'gei-test-session-4');
    const sc = body['sessionContext'] as Record<string, unknown>;
    assert.ok(Array.isArray(sc['recentTools']),
      `sessionContext.recentTools must be an Array, got ${typeof sc['recentTools']}`);
    for (const item of sc['recentTools'] as unknown[]) {
      assert.equal(typeof item, 'string',
        `each recentTools item must be a string, got ${typeof item}`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GEI-5: callCount is a finite non-negative integer ────────────────────────

test('GEI-5: sessionContext.callCount is a finite non-negative integer', async () => {
  const agg = makeAgg();
  try {
    const body = await castChainWithSession(agg, 'gei-test-session-5');
    const sc = body['sessionContext'] as Record<string, unknown>;
    const callCount = sc['callCount'];
    assert.equal(typeof callCount, 'number',
      `sessionContext.callCount must be a number, got ${typeof callCount}`);
    assert.ok(Number.isFinite(callCount as number),
      `sessionContext.callCount must be finite, got ${callCount}`);
    assert.ok(Number.isInteger(callCount as number),
      `sessionContext.callCount must be an integer, got ${callCount}`);
    assert.ok((callCount as number) >= 0,
      `sessionContext.callCount must be non-negative, got ${callCount}`);
  } finally {
    await agg.shutdown();
  }
});
