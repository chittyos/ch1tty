/**
 * EN: Drift guard — cast:resolved sessionContext sub-object shape and
 *     cast:chain_executed sessionContext sub-object shape.
 *
 * Two remaining sessionContext paths not frozen by EI/EL/EM:
 *
 * ── cast:resolved sessionContext ──────────────────────────────────────────────
 * EI freezes sessionContext for cast:executed.
 * EL freezes sessionContext for cast:plan.
 * EM freezes sessionContext for cast:no_match and cast:discovered.
 *
 * cast:resolved (dryRun path, aggregator lines 1554–1563, 1577) constructs
 * resolvedSessionContext separately — same shape, separate code, unfrozen.
 *
 * ── cast:chain_executed sessionContext ────────────────────────────────────────
 * cast:chain_executed (aggregator lines 1516–1525, 1543) constructs
 * chainSessionContext separately — same shape as all other sessionContext
 * paths, but never tested.
 *
 * Both share the same shape:
 *   PERMITTED: { activeSessionFocus?, callCount, recentTools }
 *   REQUIRED:  { callCount, recentTools }
 *
 * Frozen 2026-09-19.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// ── Frozen field sets ─────────────────────────────────────────────────────────

const SESSION_CONTEXT_PERMITTED: readonly string[] = ['activeSessionFocus', 'callCount', 'recentTools'];
const SESSION_CONTEXT_REQUIRED: readonly string[] = ['callCount', 'recentTools'];

// ── Helpers ───────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-en-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

// Catalog with a 2-step neon combo — required for both cast:resolved (dryRun)
// and cast:chain_executed (chain:true) sessionContext tests.
const EN_CATALOG = {
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
    suggestionsCatalog: EN_CATALOG,
    focus: 'code',
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

async function cast(agg: Aggregator, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', args);
  assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

// Prime the session: make one executed cast call first so the coordinator has
// session state to populate sessionContext on subsequent calls.
async function primeSession(agg: Aggregator, sessionId: string): Promise<void> {
  await cast(agg, { intent: 'list neon projects', sessionId });
}

// ── Suite 1: cast:resolved sessionContext sub-object shape ────────────────────

describe('EN — cast:resolved sessionContext sub-object shape', () => {
  test('sessionContext has no unexpected keys in cast:resolved', async () => {
    const agg = makeCatalogAgg();
    const sessionId = `en-resolved-${Date.now()}`;
    try {
      await primeSession(agg, sessionId);
      const body = await cast(agg, { intent: 'list neon projects', dryRun: true, sessionId });
      assert.equal(body['cast'], 'resolved', `expected cast:resolved, got ${body['cast']}`);
      assert.ok('sessionContext' in body, 'sessionContext must be present after session is primed');
      const sc = body['sessionContext'] as Record<string, unknown>;
      assert.ok(sc && typeof sc === 'object' && !Array.isArray(sc), 'sessionContext must be an object');
      const unexpected = Object.keys(sc).filter((k) => !SESSION_CONTEXT_PERMITTED.includes(k));
      assert.deepEqual(
        unexpected,
        [],
        `Unexpected keys in cast:resolved sessionContext (shape drift): ${unexpected.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('sessionContext has all required keys in cast:resolved', async () => {
    const agg = makeCatalogAgg();
    const sessionId = `en-resolved-req-${Date.now()}`;
    try {
      await primeSession(agg, sessionId);
      const body = await cast(agg, { intent: 'list neon projects', dryRun: true, sessionId });
      assert.equal(body['cast'], 'resolved');
      const sc = body['sessionContext'] as Record<string, unknown>;
      for (const key of SESSION_CONTEXT_REQUIRED) {
        assert.ok(
          key in sc,
          `sessionContext must have required key "${key}" in cast:resolved`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('sessionContext.recentTools is an array of strings in cast:resolved', async () => {
    const agg = makeCatalogAgg();
    const sessionId = `en-resolved-rt-${Date.now()}`;
    try {
      await primeSession(agg, sessionId);
      const body = await cast(agg, { intent: 'list neon projects', dryRun: true, sessionId });
      assert.equal(body['cast'], 'resolved');
      const sc = body['sessionContext'] as Record<string, unknown>;
      assert.ok(Array.isArray(sc['recentTools']), 'sessionContext.recentTools must be an array');
      for (const t of sc['recentTools'] as unknown[]) {
        assert.equal(typeof t, 'string', `each recentTools entry must be a string, got ${typeof t}`);
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('sessionContext.callCount is a non-negative integer in cast:resolved', async () => {
    const agg = makeCatalogAgg();
    const sessionId = `en-resolved-cc-${Date.now()}`;
    try {
      await primeSession(agg, sessionId);
      const body = await cast(agg, { intent: 'list neon projects', dryRun: true, sessionId });
      assert.equal(body['cast'], 'resolved');
      const sc = body['sessionContext'] as Record<string, unknown>;
      const cc = sc['callCount'] as number;
      assert.ok(
        typeof cc === 'number' && Number.isInteger(cc) && cc >= 0,
        `sessionContext.callCount must be a non-negative integer, got ${JSON.stringify(cc)}`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 2: cast:chain_executed sessionContext sub-object shape ───────────────

describe('EN — cast:chain_executed sessionContext sub-object shape', () => {
  test('sessionContext has no unexpected keys in cast:chain_executed', async () => {
    const agg = makeCatalogAgg();
    const sessionId = `en-chain-${Date.now()}`;
    try {
      await primeSession(agg, sessionId);
      const body = await cast(agg, { intent: 'list neon projects', chain: true, sessionId });
      assert.equal(body['cast'], 'chain_executed', `expected chain_executed, got ${body['cast']}`);
      assert.ok('sessionContext' in body, 'sessionContext must be present after session is primed');
      const sc = body['sessionContext'] as Record<string, unknown>;
      assert.ok(sc && typeof sc === 'object' && !Array.isArray(sc), 'sessionContext must be an object');
      const unexpected = Object.keys(sc).filter((k) => !SESSION_CONTEXT_PERMITTED.includes(k));
      assert.deepEqual(
        unexpected,
        [],
        `Unexpected keys in cast:chain_executed sessionContext (shape drift): ${unexpected.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('sessionContext has all required keys in cast:chain_executed', async () => {
    const agg = makeCatalogAgg();
    const sessionId = `en-chain-req-${Date.now()}`;
    try {
      await primeSession(agg, sessionId);
      const body = await cast(agg, { intent: 'list neon projects', chain: true, sessionId });
      assert.equal(body['cast'], 'chain_executed');
      const sc = body['sessionContext'] as Record<string, unknown>;
      for (const key of SESSION_CONTEXT_REQUIRED) {
        assert.ok(
          key in sc,
          `sessionContext must have required key "${key}" in cast:chain_executed`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('sessionContext.recentTools is an array of strings in cast:chain_executed', async () => {
    const agg = makeCatalogAgg();
    const sessionId = `en-chain-rt-${Date.now()}`;
    try {
      await primeSession(agg, sessionId);
      const body = await cast(agg, { intent: 'list neon projects', chain: true, sessionId });
      assert.equal(body['cast'], 'chain_executed');
      const sc = body['sessionContext'] as Record<string, unknown>;
      assert.ok(Array.isArray(sc['recentTools']), 'sessionContext.recentTools must be an array');
      for (const t of sc['recentTools'] as unknown[]) {
        assert.equal(typeof t, 'string', `each recentTools entry must be a string, got ${typeof t}`);
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('sessionContext.callCount is a non-negative integer in cast:chain_executed', async () => {
    const agg = makeCatalogAgg();
    const sessionId = `en-chain-cc-${Date.now()}`;
    try {
      await primeSession(agg, sessionId);
      const body = await cast(agg, { intent: 'list neon projects', chain: true, sessionId });
      assert.equal(body['cast'], 'chain_executed');
      const sc = body['sessionContext'] as Record<string, unknown>;
      const cc = sc['callCount'] as number;
      assert.ok(
        typeof cc === 'number' && Number.isInteger(cc) && cc >= 0,
        `sessionContext.callCount must be a non-negative integer, got ${JSON.stringify(cc)}`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});
