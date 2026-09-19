/**
 * EM: Drift guard — cast:no_match sessionContext sub-object shape and
 *     cast:discovered sessionContext sub-object shape.
 *
 * Two further gaps symmetric to EI (cast:executed) and EL (cast:plan):
 *
 * ── cast:no_match sessionContext sub-object ───────────────────────────────────
 * EI froze sessionContext for cast:executed and EL for cast:plan. cast:no_match
 * constructs noMatchSessionContext separately (aggregator lines 1355–1363) and
 * spreads it at line 1376. No prior test covers that code path.
 *
 * ── cast:discovered sessionContext sub-object ────────────────────────────────
 * cast:discovered (no tools matched but prompts/resources did) constructs
 * discoveredSessionContext at lines 1417–1425 and spreads it at line 1434.
 * Separate branch from all other sessionContext paths; no prior test covers it.
 *
 * Both paths produce the same shape:
 *   sessionContext PERMITTED: { activeSessionFocus?, callCount, recentTools }
 *   sessionContext REQUIRED:  { callCount, recentTools }
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
  return join(tmpdir(), `ch1tty-em-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

// Aggregator with a prompt-only server — no tools, so any intent that keyword-
// matches the prompt produces cast:discovered; a nonsense intent produces
// cast:no_match even with prompts present.
function makePromptOnlyAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('docs', {
    tools: [],
    prompts: [
      { name: 'database-guide', description: 'documentation guide for database query patterns' },
    ],
  });
  const configs: ServerConfig[] = [{
    id: 'docs', name: 'Docs', type: 'remote', access: 'readwrite',
    category: 'documents', endpoint: 'https://docs.example.com/mcp', lazy: true,
  }];
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

// ── Suite 1: cast:no_match sessionContext sub-object shape ────────────────────

describe('EM — cast:no_match sessionContext sub-object shape', () => {
  const SESSION_ID = `em-nomatch-session-${Date.now()}`;

  test('sessionContext has no unexpected keys in cast:no_match', async () => {
    const agg = makePromptOnlyAgg();
    try {
      // Prime the session — 'database guide query' keyword-matches the prompt → cast:discovered, registers sessionId.
      await cast(agg, { intent: 'database guide query', sessionId: SESSION_ID });
      // Nonsense intent matches neither the prompt nor any tool (no tools exist) → cast:no_match.
      const body = await cast(agg, { intent: 'xyzzy-zzz', sessionId: SESSION_ID });
      assert.equal(body['cast'], 'no_match', `expected cast:no_match, got ${body['cast']}`);
      assert.ok('sessionContext' in body, 'sessionContext must be present in cast:no_match when sessionId is active');
      const sc = body['sessionContext'] as Record<string, unknown>;
      assert.ok(sc && typeof sc === 'object' && !Array.isArray(sc), 'sessionContext must be an object');
      const unexpected = Object.keys(sc).filter((k) => !SESSION_CONTEXT_PERMITTED.includes(k));
      assert.deepEqual(
        unexpected,
        [],
        `Unexpected keys in cast:no_match sessionContext (shape drift): ${unexpected.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('sessionContext has all required keys in cast:no_match', async () => {
    const agg = makePromptOnlyAgg();
    try {
      await cast(agg, { intent: 'database guide query', sessionId: SESSION_ID });
      const body = await cast(agg, { intent: 'xyzzy-zzz', sessionId: SESSION_ID });
      assert.equal(body['cast'], 'no_match');
      const sc = body['sessionContext'] as Record<string, unknown>;
      if (sc) {
        const missing = SESSION_CONTEXT_REQUIRED.filter((k) => !(k in sc));
        assert.deepEqual(missing, [], `Missing required keys in cast:no_match sessionContext: ${missing.join(', ')}`);
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('sessionContext.recentTools is an array of strings in cast:no_match', async () => {
    const agg = makePromptOnlyAgg();
    try {
      await cast(agg, { intent: 'database guide query', sessionId: SESSION_ID });
      const body = await cast(agg, { intent: 'xyzzy-zzz', sessionId: SESSION_ID });
      assert.equal(body['cast'], 'no_match');
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

  test('sessionContext.callCount is a non-negative integer in cast:no_match', async () => {
    const agg = makePromptOnlyAgg();
    try {
      await cast(agg, { intent: 'database guide query', sessionId: SESSION_ID });
      const body = await cast(agg, { intent: 'xyzzy-zzz', sessionId: SESSION_ID });
      assert.equal(body['cast'], 'no_match');
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
});

// ── Suite 2: cast:discovered sessionContext sub-object shape ──────────────────

describe('EM — cast:discovered sessionContext sub-object shape', () => {
  const SESSION_ID = `em-discovered-session-${Date.now()}`;

  test('sessionContext has no unexpected keys in cast:discovered', async () => {
    const agg = makePromptOnlyAgg();
    try {
      // Prime the session. No tools exist so first call will be cast:no_match
      // or cast:discovered depending on intent; either registers the session.
      await cast(agg, { intent: 'database guide query', sessionId: SESSION_ID });
      // Use the same keyword-matching intent to land on cast:discovered.
      const body = await cast(agg, { intent: 'database guide query', sessionId: SESSION_ID });
      assert.equal(body['cast'], 'discovered', `expected cast:discovered, got ${body['cast']}`);
      assert.ok('sessionContext' in body, 'sessionContext must be present in cast:discovered when sessionId is active');
      const sc = body['sessionContext'] as Record<string, unknown>;
      assert.ok(sc && typeof sc === 'object' && !Array.isArray(sc), 'sessionContext must be an object');
      const unexpected = Object.keys(sc).filter((k) => !SESSION_CONTEXT_PERMITTED.includes(k));
      assert.deepEqual(
        unexpected,
        [],
        `Unexpected keys in cast:discovered sessionContext (shape drift): ${unexpected.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('sessionContext has all required keys in cast:discovered', async () => {
    const agg = makePromptOnlyAgg();
    try {
      await cast(agg, { intent: 'database guide query', sessionId: SESSION_ID });
      const body = await cast(agg, { intent: 'database guide query', sessionId: SESSION_ID });
      assert.equal(body['cast'], 'discovered');
      const sc = body['sessionContext'] as Record<string, unknown>;
      if (sc) {
        const missing = SESSION_CONTEXT_REQUIRED.filter((k) => !(k in sc));
        assert.deepEqual(missing, [], `Missing required keys in cast:discovered sessionContext: ${missing.join(', ')}`);
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('sessionContext.recentTools is an array of strings in cast:discovered', async () => {
    const agg = makePromptOnlyAgg();
    try {
      await cast(agg, { intent: 'database guide query', sessionId: SESSION_ID });
      const body = await cast(agg, { intent: 'database guide query', sessionId: SESSION_ID });
      assert.equal(body['cast'], 'discovered');
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

  test('sessionContext.callCount is a non-negative integer in cast:discovered', async () => {
    const agg = makePromptOnlyAgg();
    try {
      await cast(agg, { intent: 'database guide query', sessionId: SESSION_ID });
      const body = await cast(agg, { intent: 'database guide query', sessionId: SESSION_ID });
      assert.equal(body['cast'], 'discovered');
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
});
