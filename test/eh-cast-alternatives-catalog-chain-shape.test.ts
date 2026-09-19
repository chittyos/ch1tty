/**
 * EH: Drift guard — cast:executed alternatives item shape, and cast:plan
 *     resolvedFromCatalog + chainContinuation sub-object shapes.
 *
 * Three gaps left unfrozen by EA, EF, and EG:
 *
 * ── cast:executed alternatives item shape ────────────────────────────────────
 * EA freezes alternatives item shape for cast:plan but not cast:executed.
 * The alternatives array in cast:executed uses the same runner-up slice;
 * each item must always carry exactly: tool (namespaced string), score (number),
 * description (string).
 *
 * ── cast:plan resolvedFromCatalog sub-object ─────────────────────────────────
 * Present when the resolved tool is the entry-point of a curated catalog combo
 * (focusName + suggestionsCatalog). Always-present fields: name, chain,
 * accomplishes. EG's PLAN_PERMITTED already includes resolvedFromCatalog;
 * this test freezes its exact internal shape.
 *
 * ── cast:plan chainContinuation sub-object ───────────────────────────────────
 * Present when catalogCombo.chain.length > 1 (multi-step workflow, non-chain mode).
 * Always-present fields: nextTool, remainingChain, hint. EG's PLAN_PERMITTED
 * already includes chainContinuation; this test freezes its exact internal shape.
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

const ALTERNATIVES_ITEM_FIELDS: readonly string[] = ['description', 'score', 'tool'];

const RESOLVED_FROM_CATALOG_FIELDS: readonly string[] = ['accomplishes', 'chain', 'name'];

const CHAIN_CONTINUATION_FIELDS: readonly string[] = ['hint', 'nextTool', 'remainingChain'];

// ── Helpers ───────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-eh-${Date.now()}-${++dlqSeq}.jsonl`);
}

// Coordinator that never routes via brain — keeps scoring deterministic.
class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

// Aggregator with neon+stripe+tasks (same as EA/EG) for cast:executed alternatives.
function makeMultiAgg(): Aggregator {
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

// Catalog with a 2-step neon combo for triggering resolvedFromCatalog and chainContinuation.
const PLAN_CATALOG = {
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

// Aggregator that resolves to the neon-setup combo in cast:plan mode (confirm:true).
function makePlanCatalogAgg(): Aggregator {
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
    suggestionsCatalog: PLAN_CATALOG,
    focus: 'code',
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

async function cast(agg: Aggregator, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', args);
  assert.equal(result.isError, undefined, `cast must not error, got: ${JSON.stringify(result.content)}`);
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

// ── Suite 1: cast:executed alternatives item shape ─────────────────────────────

describe('EH — cast:executed alternatives item shape', () => {
  test('cast:executed alternatives items have exactly tool, score, description fields', async () => {
    const agg = makeMultiAgg();
    try {
      const body = await cast(agg, { intent: 'list database projects' });
      assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
      const alternatives = body['alternatives'];
      if (Array.isArray(alternatives) && alternatives.length > 0) {
        for (const alt of alternatives as unknown[]) {
          assert.ok(typeof alt === 'object' && alt !== null && !Array.isArray(alt), 'each alternative must be an object');
          const a = alt as Record<string, unknown>;
          const unexpected = Object.keys(a).filter((k) => !ALTERNATIVES_ITEM_FIELDS.includes(k));
          assert.deepEqual(
            unexpected,
            [],
            `Unexpected keys in cast:executed alternatives item (shape drift): ${unexpected.join(', ')}`,
          );
          const missing = ALTERNATIVES_ITEM_FIELDS.filter((k) => !(k in a));
          assert.deepEqual(
            missing,
            [],
            `Missing keys in cast:executed alternatives item: ${missing.join(', ')}`,
          );
        }
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('cast:executed alternatives items have correct field types', async () => {
    const agg = makeMultiAgg();
    try {
      const body = await cast(agg, { intent: 'list database projects' });
      assert.equal(body['cast'], 'executed');
      const alternatives = body['alternatives'];
      if (Array.isArray(alternatives) && alternatives.length > 0) {
        for (const alt of alternatives as unknown[]) {
          const a = alt as Record<string, unknown>;
          assert.equal(typeof a['tool'], 'string', 'alternatives item.tool must be a string');
          assert.ok((a['tool'] as string).includes('/'), 'alternatives item.tool must be a namespaced name (serverId/toolName)');
          assert.equal(typeof a['score'], 'number', 'alternatives item.score must be a number');
          assert.equal(typeof a['description'], 'string', 'alternatives item.description must be a string');
        }
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('cast:executed alternatives when present is a non-empty array of objects', async () => {
    const agg = makeMultiAgg();
    try {
      const body = await cast(agg, { intent: 'list database projects' });
      assert.equal(body['cast'], 'executed');
      if ('alternatives' in body) {
        const alternatives = body['alternatives'];
        assert.ok(Array.isArray(alternatives), 'cast:executed alternatives must be an array when present');
        assert.ok((alternatives as unknown[]).length > 0, 'cast:executed alternatives must be non-empty when present (empty arrays are omitted)');
      }
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 2: cast:plan resolvedFromCatalog sub-object shape ───────────────────

describe('EH — cast:plan resolvedFromCatalog sub-object shape', () => {
  test('cast:plan resolvedFromCatalog has exactly name, chain, accomplishes fields', async () => {
    const agg = makePlanCatalogAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects', confirm: true });
      assert.equal(body['cast'], 'plan', `expected cast:plan, got ${body['cast']}`);
      assert.ok('resolvedFromCatalog' in body, 'resolvedFromCatalog must be present when catalog combo resolves');
      const rfc = body['resolvedFromCatalog'] as Record<string, unknown>;
      assert.ok(rfc && typeof rfc === 'object' && !Array.isArray(rfc), 'resolvedFromCatalog must be an object');
      const actual = Object.keys(rfc).sort();
      assert.deepEqual(
        actual,
        RESOLVED_FROM_CATALOG_FIELDS,
        `resolvedFromCatalog fields have drifted.\nActual: ${actual.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('cast:plan resolvedFromCatalog.name is a non-empty string', async () => {
    const agg = makePlanCatalogAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects', confirm: true });
      assert.equal(body['cast'], 'plan');
      const rfc = body['resolvedFromCatalog'] as Record<string, unknown>;
      if (rfc) {
        assert.ok(typeof rfc['name'] === 'string' && (rfc['name'] as string).length > 0, 'resolvedFromCatalog.name must be a non-empty string');
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('cast:plan resolvedFromCatalog.chain is a non-empty array of strings', async () => {
    const agg = makePlanCatalogAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects', confirm: true });
      assert.equal(body['cast'], 'plan');
      const rfc = body['resolvedFromCatalog'] as Record<string, unknown>;
      if (rfc) {
        assert.ok(Array.isArray(rfc['chain']), 'resolvedFromCatalog.chain must be an array');
        assert.ok((rfc['chain'] as unknown[]).length > 0, 'resolvedFromCatalog.chain must be non-empty');
        for (const step of rfc['chain'] as unknown[]) {
          assert.equal(typeof step, 'string', 'each resolvedFromCatalog.chain entry must be a string');
        }
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('cast:plan resolvedFromCatalog.accomplishes is a non-empty string', async () => {
    const agg = makePlanCatalogAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects', confirm: true });
      assert.equal(body['cast'], 'plan');
      const rfc = body['resolvedFromCatalog'] as Record<string, unknown>;
      if (rfc) {
        assert.ok(typeof rfc['accomplishes'] === 'string' && (rfc['accomplishes'] as string).length > 0, 'resolvedFromCatalog.accomplishes must be a non-empty string');
      }
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 3: cast:plan chainContinuation sub-object shape ─────────────────────

describe('EH — cast:plan chainContinuation sub-object shape', () => {
  test('cast:plan chainContinuation has exactly nextTool, remainingChain, hint fields', async () => {
    const agg = makePlanCatalogAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects', confirm: true });
      assert.equal(body['cast'], 'plan', `expected cast:plan, got ${body['cast']}`);
      assert.ok('chainContinuation' in body, 'chainContinuation must be present for a multi-step catalog combo in plan mode');
      const cc = body['chainContinuation'] as Record<string, unknown>;
      assert.ok(cc && typeof cc === 'object' && !Array.isArray(cc), 'chainContinuation must be an object');
      const actual = Object.keys(cc).sort();
      assert.deepEqual(
        actual,
        CHAIN_CONTINUATION_FIELDS,
        `chainContinuation fields have drifted.\nActual: ${actual.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('cast:plan chainContinuation.nextTool is a namespaced string', async () => {
    const agg = makePlanCatalogAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects', confirm: true });
      assert.equal(body['cast'], 'plan');
      const cc = body['chainContinuation'] as Record<string, unknown>;
      if (cc) {
        assert.equal(typeof cc['nextTool'], 'string', 'chainContinuation.nextTool must be a string');
        assert.ok((cc['nextTool'] as string).includes('/'), 'chainContinuation.nextTool must be a namespaced tool name (serverId/toolName)');
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('cast:plan chainContinuation.remainingChain is a non-empty array of strings', async () => {
    const agg = makePlanCatalogAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects', confirm: true });
      assert.equal(body['cast'], 'plan');
      const cc = body['chainContinuation'] as Record<string, unknown>;
      if (cc) {
        assert.ok(Array.isArray(cc['remainingChain']), 'chainContinuation.remainingChain must be an array');
        assert.ok((cc['remainingChain'] as unknown[]).length > 0, 'chainContinuation.remainingChain must be non-empty');
        for (const step of cc['remainingChain'] as unknown[]) {
          assert.equal(typeof step, 'string', 'each chainContinuation.remainingChain entry must be a string');
        }
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('cast:plan chainContinuation.hint is a non-empty string', async () => {
    const agg = makePlanCatalogAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects', confirm: true });
      assert.equal(body['cast'], 'plan');
      const cc = body['chainContinuation'] as Record<string, unknown>;
      if (cc) {
        assert.ok(typeof cc['hint'] === 'string' && (cc['hint'] as string).length > 0, 'chainContinuation.hint must be a non-empty string');
      }
    } finally {
      await agg.shutdown();
    }
  });
});
