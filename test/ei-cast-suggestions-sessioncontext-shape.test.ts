/**
 * EI: Drift guard — cast suggestions sub-object shape and sessionContext
 *     sub-object shape.
 *
 * Two shape gaps unfrozen by EA–EH:
 *
 * ── suggestions sub-object ───────────────────────────────────────────────────
 * Existing tests (suggestions.test.ts, nnn, cast-no-match.test.ts) check that
 * suggestions.combos and suggestions.prompts are arrays and verify specific
 * values, but none freeze the exact top-level shape or item-level field sets.
 *
 * suggestions top-level EXACT: { combos, prompts }
 * combos item PERMITTED: { accomplishes, chain, name, notes?, verified }
 * combos item REQUIRED:  { accomplishes, chain, name, verified }
 * prompts item EXACT:    { resolves_to, text }
 *
 * ── sessionContext sub-object in cast ────────────────────────────────────────
 * EC (ec-execute-response-shape-drift.test.ts) freezes sessionContext shape
 * for ch1tty/execute. No drift guard does the same for cast responses.
 *
 * sessionContext PERMITTED: { activeSessionFocus?, callCount, recentTools }
 * sessionContext REQUIRED:  { callCount, recentTools }
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

const SUGGESTIONS_TOP_FIELDS: readonly string[] = ['combos', 'prompts'];

const COMBO_ITEM_PERMITTED: readonly string[] = ['accomplishes', 'chain', 'name', 'notes', 'verified'];
const COMBO_ITEM_REQUIRED: readonly string[] = ['accomplishes', 'chain', 'name', 'verified'];

const PROMPT_ITEM_FIELDS: readonly string[] = ['resolves_to', 'text'];

const SESSION_CONTEXT_PERMITTED: readonly string[] = ['activeSessionFocus', 'callCount', 'recentTools'];
const SESSION_CONTEXT_REQUIRED: readonly string[] = ['callCount', 'recentTools'];

// ── Helpers ───────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-ei-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

// Catalog used to trigger suggestions in a chain_executed response.
// Has one combo (with notes absent — tests optional field doesn't appear unexpectedly)
// and one prompt.
const SUGGESTIONS_CATALOG = {
  code: {
    description: 'Code focus',
    combos: [{
      name: 'neon-setup',
      chain: ['neon/list_projects', 'neon/create_project'],
      accomplishes: 'List existing Neon projects then create a new one',
      verified: true,
    }],
    prompts: [
      { text: 'How do I set up a new database?', resolves_to: 'neon/create_project' },
    ],
  },
};

// Aggregator with neon 2-step combo + focus:code for triggering suggestions.
function makeSuggestionsAgg(): Aggregator {
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
    suggestionsCatalog: SUGGESTIONS_CATALOG,
    focus: 'code',
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

// Aggregator with neon+stripe+tasks for triggering sessionContext via sessionId.
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

async function castChainExecuted(agg: Aggregator): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    chain: true,
  });
  assert.equal(result.isError, undefined, `cast must not error, got: ${JSON.stringify(result.content)}`);
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body['cast'], 'chain_executed', `expected chain_executed, got ${body['cast']}`);
  return body;
}

async function castExecutedWithSession(agg: Aggregator, sessionId: string): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list database projects',
    sessionId,
  });
  assert.equal(result.isError, undefined, `cast must not error, got: ${JSON.stringify(result.content)}`);
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body['cast'], 'executed', `expected executed, got ${body['cast']}`);
  assert.ok('sessionContext' in body, 'sessionContext must be present when sessionId is active');
  return body;
}

// ── Suite 1: suggestions sub-object top-level shape ───────────────────────────

describe('EI — cast suggestions sub-object top-level shape', () => {
  test('suggestions has exactly {combos, prompts} fields', async () => {
    const agg = makeSuggestionsAgg();
    try {
      const body = await castChainExecuted(agg);
      assert.ok('suggestions' in body, 'suggestions must be present in chain_executed with catalog');
      const suggestions = body['suggestions'] as Record<string, unknown>;
      assert.ok(suggestions && typeof suggestions === 'object' && !Array.isArray(suggestions), 'suggestions must be an object');
      const actual = Object.keys(suggestions).sort();
      assert.deepEqual(
        actual,
        SUGGESTIONS_TOP_FIELDS,
        `suggestions top-level fields have drifted. Actual: ${actual.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('suggestions.combos is an array', async () => {
    const agg = makeSuggestionsAgg();
    try {
      const body = await castChainExecuted(agg);
      const suggestions = body['suggestions'] as Record<string, unknown>;
      assert.ok(Array.isArray(suggestions['combos']), 'suggestions.combos must be an array');
    } finally {
      await agg.shutdown();
    }
  });

  test('suggestions.prompts is an array', async () => {
    const agg = makeSuggestionsAgg();
    try {
      const body = await castChainExecuted(agg);
      const suggestions = body['suggestions'] as Record<string, unknown>;
      assert.ok(Array.isArray(suggestions['prompts']), 'suggestions.prompts must be an array');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 2: suggestions combo item shape ─────────────────────────────────────

describe('EI — cast suggestions combo item shape', () => {
  test('combo items have no unexpected keys', async () => {
    const agg = makeSuggestionsAgg();
    try {
      const body = await castChainExecuted(agg);
      const suggestions = body['suggestions'] as Record<string, unknown>;
      const combos = suggestions['combos'] as unknown[];
      if (combos.length > 0) {
        for (const combo of combos) {
          assert.ok(typeof combo === 'object' && combo !== null && !Array.isArray(combo), 'each combo must be an object');
          const c = combo as Record<string, unknown>;
          const unexpected = Object.keys(c).filter((k) => !COMBO_ITEM_PERMITTED.includes(k));
          assert.deepEqual(
            unexpected,
            [],
            `Unexpected keys in suggestions combo item (shape drift): ${unexpected.join(', ')}`,
          );
        }
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('combo items have all required keys', async () => {
    const agg = makeSuggestionsAgg();
    try {
      const body = await castChainExecuted(agg);
      const suggestions = body['suggestions'] as Record<string, unknown>;
      const combos = suggestions['combos'] as unknown[];
      if (combos.length > 0) {
        for (const combo of combos) {
          const c = combo as Record<string, unknown>;
          const missing = COMBO_ITEM_REQUIRED.filter((k) => !(k in c));
          assert.deepEqual(missing, [], `Missing required keys in suggestions combo item: ${missing.join(', ')}`);
        }
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('combo item field types are correct', async () => {
    const agg = makeSuggestionsAgg();
    try {
      const body = await castChainExecuted(agg);
      const suggestions = body['suggestions'] as Record<string, unknown>;
      const combos = suggestions['combos'] as unknown[];
      if (combos.length > 0) {
        const c = combos[0] as Record<string, unknown>;
        assert.equal(typeof c['name'], 'string', 'combo.name must be a string');
        assert.ok(Array.isArray(c['chain']), 'combo.chain must be an array');
        assert.equal(typeof c['accomplishes'], 'string', 'combo.accomplishes must be a string');
        assert.equal(typeof c['verified'], 'boolean', 'combo.verified must be a boolean');
        if ('notes' in c) {
          assert.equal(typeof c['notes'], 'string', 'combo.notes must be a string when present');
        }
      }
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 3: suggestions prompt item shape ────────────────────────────────────

describe('EI — cast suggestions prompt item shape', () => {
  test('prompt items have exactly {resolves_to, text} fields', async () => {
    const agg = makeSuggestionsAgg();
    try {
      const body = await castChainExecuted(agg);
      const suggestions = body['suggestions'] as Record<string, unknown>;
      const prompts = suggestions['prompts'] as unknown[];
      if (prompts.length > 0) {
        for (const prompt of prompts) {
          assert.ok(typeof prompt === 'object' && prompt !== null && !Array.isArray(prompt), 'each prompt must be an object');
          const p = prompt as Record<string, unknown>;
          const actual = Object.keys(p).sort();
          const unexpected = actual.filter((k) => !PROMPT_ITEM_FIELDS.includes(k));
          assert.deepEqual(
            unexpected,
            [],
            `Unexpected keys in suggestions prompt item (shape drift): ${unexpected.join(', ')}`,
          );
          const missing = PROMPT_ITEM_FIELDS.filter((k) => !(k in p));
          assert.deepEqual(missing, [], `Missing required keys in suggestions prompt item: ${missing.join(', ')}`);
        }
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('prompt item field types are correct', async () => {
    const agg = makeSuggestionsAgg();
    try {
      const body = await castChainExecuted(agg);
      const suggestions = body['suggestions'] as Record<string, unknown>;
      const prompts = suggestions['prompts'] as unknown[];
      if (prompts.length > 0) {
        const p = prompts[0] as Record<string, unknown>;
        assert.equal(typeof p['text'], 'string', 'prompt.text must be a string');
        assert.equal(typeof p['resolves_to'], 'string', 'prompt.resolves_to must be a string');
      }
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 4: sessionContext sub-object shape in cast ──────────────────────────

describe('EI — cast sessionContext sub-object shape', () => {
  test('sessionContext has no unexpected keys in cast:executed', async () => {
    const agg = makeSessionAgg();
    try {
      const body = await castExecutedWithSession(agg, 'ei-session-drift-01');
      const sc = body['sessionContext'] as Record<string, unknown>;
      const unexpected = Object.keys(sc).filter((k) => !SESSION_CONTEXT_PERMITTED.includes(k));
      assert.deepEqual(
        unexpected,
        [],
        `Unexpected keys in cast:executed sessionContext (shape drift): ${unexpected.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('sessionContext has all required keys in cast:executed', async () => {
    const agg = makeSessionAgg();
    try {
      const body = await castExecutedWithSession(agg, 'ei-session-drift-02');
      const sc = body['sessionContext'] as Record<string, unknown>;
      const missing = SESSION_CONTEXT_REQUIRED.filter((k) => !(k in sc));
      assert.deepEqual(missing, [], `Missing required keys in cast sessionContext: ${missing.join(', ')}`);
    } finally {
      await agg.shutdown();
    }
  });

  test('sessionContext.recentTools is an array of strings', async () => {
    const agg = makeSessionAgg();
    try {
      const body = await castExecutedWithSession(agg, 'ei-session-drift-03');
      const sc = body['sessionContext'] as Record<string, unknown>;
      assert.ok(Array.isArray(sc['recentTools']), 'sessionContext.recentTools must be an array');
      for (const tool of sc['recentTools'] as unknown[]) {
        assert.equal(typeof tool, 'string', 'each recentTools entry must be a string');
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('sessionContext.callCount is a non-negative integer', async () => {
    const agg = makeSessionAgg();
    try {
      const body = await castExecutedWithSession(agg, 'ei-session-drift-04');
      const sc = body['sessionContext'] as Record<string, unknown>;
      assert.ok(
        typeof sc['callCount'] === 'number' &&
          Number.isInteger(sc['callCount']) &&
          (sc['callCount'] as number) >= 0,
        `sessionContext.callCount must be a non-negative integer, got ${JSON.stringify(sc['callCount'])}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('sessionContext.activeSessionFocus is a string when present', async () => {
    const agg = makeSessionAgg();
    try {
      const body = await castExecutedWithSession(agg, 'ei-session-drift-05');
      const sc = body['sessionContext'] as Record<string, unknown>;
      if ('activeSessionFocus' in sc) {
        assert.equal(typeof sc['activeSessionFocus'], 'string', 'sessionContext.activeSessionFocus must be a string when present');
      }
    } finally {
      await agg.shutdown();
    }
  });
});
