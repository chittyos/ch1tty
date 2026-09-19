/**
 * EL: Drift guard — cast:executed chainContinuation sub-object shape and
 *     cast:plan sessionContext sub-object shape.
 *
 * Two symmetric gaps left by EH and EI:
 *
 * ── cast:executed chainContinuation sub-object ────────────────────────────────
 * EH freezes chainContinuation for cast:plan but not cast:executed. Both paths
 * derive chainContinuation from the same variable (aggregator line 1454) and
 * spread it into the response at lines 1615 (plan) and 1664 (executed). The
 * executed branch is a separate code path; its shape is unfrozen.
 *
 * chainContinuation EXACT: { hint, nextTool, remainingChain }
 *
 * ── cast:plan sessionContext sub-object ───────────────────────────────────────
 * EI freezes sessionContext for cast:executed (planSessionContext → line 1618 via
 * castSessionContext). cast:plan constructs planSessionContext separately at
 * lines 1585–1594 and spreads it at line 1618. EI only tests the executed path
 * (castExecutedWithSession helper); no test covers the plan path.
 *
 * planSessionContext PERMITTED: { activeSessionFocus?, callCount, recentTools }
 * planSessionContext REQUIRED:  { callCount, recentTools }
 *
 * Frozen 2026-09-19.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// ── Frozen field sets ─────────────────────────────────────────────────────────

const CHAIN_CONTINUATION_EXACT: readonly string[] = ['hint', 'nextTool', 'remainingChain'];

const PLAN_SESSION_CONTEXT_PERMITTED: readonly string[] = ['activeSessionFocus', 'callCount', 'recentTools'];
const PLAN_SESSION_CONTEXT_REQUIRED: readonly string[] = ['callCount', 'recentTools'];

// ── Helpers ───────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-el-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

// Catalog with a 2-step neon combo — triggers catalogCombo + chainContinuation
// in cast:executed when called without chain:true.
const EL_CATALOG = {
  code: {
    description: 'Code focus',
    combos: [{
      name: 'neon-setup',
      chain: ['neon/list_projects', 'neon/create_project'],
      accomplishes: 'List existing Neon projects then create a new one',
      verified: true,
    }],
    prompts: [],
  },
};

// Aggregator with catalog + focus:code — resolving 'list neon projects' to
// neon/list_projects as the combo entry-point sets catalogCombo (and thus
// chainContinuation) without triggering the auto-chain path (no chain:true).
function makeCatalogAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [
      {
        name: 'list_projects',
        description: 'list neon projects in the database',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '["proj-1"]' }] },
      },
      {
        name: 'create_project',
        description: 'create a new neon project database instance',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
        response: { content: [{ type: 'text', text: '{"id":"proj-new"}' }] },
      },
    ],
  });
  const configs: ServerConfig[] = [{
    id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite',
    category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true,
  }];
  const path = dlq();
  return new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: EL_CATALOG,
    focus: 'code',
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

// Aggregator without catalog — used for sessionContext tests where we only need
// a live session via prior tool calls.
function makeSessionAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  backend.defineServer('tasks', FIXTURE_SERVERS.tasks);
  const configs: ServerConfig[] = [
    { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true },
    { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
    { id: 'tasks', name: 'Tasks', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://tasks.chitty.cc/mcp', lazy: true },
  ];
  const path = dlq();
  return new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

async function cast(agg: Aggregator, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', args);
  assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

// ── Suite 1: cast:executed chainContinuation sub-object shape ─────────────────

describe('EL — cast:executed chainContinuation sub-object shape', () => {
  test('chainContinuation has no unexpected keys in cast:executed', async () => {
    const agg = makeCatalogAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects' });
      assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
      assert.ok('chainContinuation' in body, 'chainContinuation must be present when a multi-step catalog combo resolves in executed mode');
      const cc = body['chainContinuation'] as Record<string, unknown>;
      assert.ok(cc && typeof cc === 'object' && !Array.isArray(cc), 'chainContinuation must be an object');
      const unexpected = Object.keys(cc).filter((k) => !CHAIN_CONTINUATION_EXACT.includes(k));
      assert.deepEqual(
        unexpected,
        [],
        `Unexpected keys in cast:executed chainContinuation (shape drift): ${unexpected.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('chainContinuation has exactly the frozen field set in cast:executed', async () => {
    const agg = makeCatalogAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects' });
      assert.equal(body['cast'], 'executed');
      const cc = body['chainContinuation'] as Record<string, unknown>;
      if (cc) {
        const actual = Object.keys(cc).sort();
        assert.deepEqual(
          actual,
          CHAIN_CONTINUATION_EXACT,
          `cast:executed chainContinuation fields have drifted.\nActual: ${actual.join(', ')}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('chainContinuation field types are correct in cast:executed', async () => {
    const agg = makeCatalogAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects' });
      assert.equal(body['cast'], 'executed');
      const cc = body['chainContinuation'] as Record<string, unknown>;
      if (cc) {
        assert.ok(typeof cc['nextTool'] === 'string' && (cc['nextTool'] as string).length > 0, 'chainContinuation.nextTool must be a non-empty string');
        assert.ok(Array.isArray(cc['remainingChain']) && (cc['remainingChain'] as unknown[]).length > 0, 'chainContinuation.remainingChain must be a non-empty array');
        for (const step of cc['remainingChain'] as unknown[]) {
          assert.equal(typeof step, 'string', 'each chainContinuation.remainingChain entry must be a string');
        }
        assert.ok(typeof cc['hint'] === 'string' && (cc['hint'] as string).length > 0, 'chainContinuation.hint must be a non-empty string');
      }
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 2: cast:plan sessionContext sub-object shape ────────────────────────

describe('EL — cast:plan sessionContext sub-object shape', () => {
  const SESSION_ID = `el-plan-session-${Date.now()}`;

  test('sessionContext has no unexpected keys in cast:plan', async () => {
    const agg = makeSessionAgg();
    try {
      // Prime the session by executing a tool with the session ID.
      await cast(agg, { intent: 'list database projects', sessionId: SESSION_ID });
      // Now confirm-mode call on the same session should include sessionContext.
      const body = await cast(agg, { intent: 'list neon projects', confirm: true, sessionId: SESSION_ID });
      assert.equal(body['cast'], 'plan', `expected cast:plan, got ${body['cast']}`);
      assert.ok('sessionContext' in body, 'sessionContext must be present in cast:plan when sessionId is active');
      const sc = body['sessionContext'] as Record<string, unknown>;
      assert.ok(sc && typeof sc === 'object' && !Array.isArray(sc), 'sessionContext must be an object');
      const unexpected = Object.keys(sc).filter((k) => !PLAN_SESSION_CONTEXT_PERMITTED.includes(k));
      assert.deepEqual(
        unexpected,
        [],
        `Unexpected keys in cast:plan sessionContext (shape drift): ${unexpected.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('sessionContext has all required keys in cast:plan', async () => {
    const agg = makeSessionAgg();
    try {
      await cast(agg, { intent: 'list database projects', sessionId: SESSION_ID });
      const body = await cast(agg, { intent: 'list neon projects', confirm: true, sessionId: SESSION_ID });
      assert.equal(body['cast'], 'plan');
      const sc = body['sessionContext'] as Record<string, unknown>;
      if (sc) {
        const missing = PLAN_SESSION_CONTEXT_REQUIRED.filter((k) => !(k in sc));
        assert.deepEqual(missing, [], `Missing required keys in cast:plan sessionContext: ${missing.join(', ')}`);
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('sessionContext.recentTools is an array of strings in cast:plan', async () => {
    const agg = makeSessionAgg();
    try {
      await cast(agg, { intent: 'list database projects', sessionId: SESSION_ID });
      const body = await cast(agg, { intent: 'list neon projects', confirm: true, sessionId: SESSION_ID });
      assert.equal(body['cast'], 'plan');
      const sc = body['sessionContext'] as Record<string, unknown>;
      if (sc) {
        assert.ok(Array.isArray(sc['recentTools']), 'sessionContext.recentTools must be an array');
        for (const t of sc['recentTools'] as unknown[]) {
          assert.equal(typeof t, 'string', `each recentTools entry must be a string, got ${typeof t}`);
        }
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('sessionContext.callCount is a non-negative integer in cast:plan', async () => {
    const agg = makeSessionAgg();
    try {
      await cast(agg, { intent: 'list database projects', sessionId: SESSION_ID });
      const body = await cast(agg, { intent: 'list neon projects', confirm: true, sessionId: SESSION_ID });
      assert.equal(body['cast'], 'plan');
      const sc = body['sessionContext'] as Record<string, unknown>;
      if (sc) {
        const cc = sc['callCount'];
        assert.ok(
          typeof cc === 'number' && Number.isInteger(cc) && (cc as number) >= 0,
          `sessionContext.callCount must be a non-negative integer, got ${JSON.stringify(cc)}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('sessionContext.activeSessionFocus is a string when present in cast:plan', async () => {
    const agg = makeSessionAgg();
    try {
      await cast(agg, { intent: 'list database projects', sessionId: SESSION_ID });
      const body = await cast(agg, { intent: 'list neon projects', confirm: true, sessionId: SESSION_ID });
      assert.equal(body['cast'], 'plan');
      const sc = body['sessionContext'] as Record<string, unknown>;
      if (sc && 'activeSessionFocus' in sc) {
        assert.equal(typeof sc['activeSessionFocus'], 'string', 'sessionContext.activeSessionFocus must be a string when present');
      }
    } finally {
      await agg.shutdown();
    }
  });
});
