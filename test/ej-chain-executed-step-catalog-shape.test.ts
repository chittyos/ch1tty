/**
 * EJ: Drift guard — cast:chain_executed step item shape + catalog sub-object
 *     no-unexpected-keys.
 *
 * Three gaps left unfrozen by EF (ef-cast-discovered-chain-shape-drift.test.ts):
 *
 * ── step item shape ───────────────────────────────────────────────────────────
 * EF freezes field TYPES (step=number, tool=string, ok=boolean) but has no
 * no-unexpected-keys guard. If a new field is added to step items the client
 * would silently see it. Additionally, the content/error conditional shapes
 * are not frozen:
 *   - ok:true  → content must be an array (MCP content blocks from the step)
 *   - ok:false → error must be a string; content absent
 *
 * step item PERMITTED: { content?, error?, ok, step, tool }
 * step item REQUIRED:  { ok, step, tool }
 *
 * ── catalog sub-object no-unexpected-keys ─────────────────────────────────────
 * EF checks that required keys {accomplishes, chain, name} are present but does
 * NOT guard against unexpected keys. The complement is missing.
 *
 * catalog EXACT: { accomplishes, chain, name }
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

const STEP_ITEM_PERMITTED: readonly string[] = ['content', 'error', 'ok', 'step', 'tool'];
const STEP_ITEM_REQUIRED: readonly string[] = ['ok', 'step', 'tool'];
const CATALOG_EXACT: readonly string[] = ['accomplishes', 'chain', 'name'];

// ── Helpers ───────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-ej-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

// Catalog with 2-step neon combo (both steps succeed).
const CHAIN_CATALOG = {
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

// Aggregator where both chain steps succeed.
function makeSuccessChainAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [
      {
        name: 'list_projects',
        description: 'list neon projects',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '["proj-1","proj-2"]' }] },
      },
      {
        name: 'create_project',
        description: 'create a neon project',
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
    suggestionsCatalog: CHAIN_CATALOG,
    focus: 'code',
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

// Aggregator where the second chain step fails (response: 'error').
function makePartialFailChainAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [
      {
        name: 'list_projects',
        description: 'list neon projects',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '["proj-1"]' }] },
      },
      {
        name: 'create_project',
        description: 'create a neon project',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
        response: 'error',
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
    suggestionsCatalog: CHAIN_CATALOG,
    focus: 'code',
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

async function castChainExecuted(agg: Aggregator): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', chain: true });
  assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body['cast'], 'chain_executed', `expected chain_executed, got ${body['cast']}`);
  return body;
}

// ── Suite 1: step item PERMITTED keys ─────────────────────────────────────────

describe('EJ — cast:chain_executed step item no-unexpected-keys', () => {
  test('step items have no unexpected keys (ok:true)', async () => {
    const agg = makeSuccessChainAgg();
    try {
      const body = await castChainExecuted(agg);
      const steps = body['steps'] as Array<Record<string, unknown>>;
      assert.ok(Array.isArray(steps) && steps.length > 0, 'steps must be a non-empty array');
      for (const s of steps) {
        const unexpected = Object.keys(s).filter((k) => !STEP_ITEM_PERMITTED.includes(k));
        assert.deepEqual(
          unexpected,
          [],
          `Unexpected keys in chain_executed step item (shape drift): ${unexpected.join(', ')}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('step items have all required keys', async () => {
    const agg = makeSuccessChainAgg();
    try {
      const body = await castChainExecuted(agg);
      const steps = body['steps'] as Array<Record<string, unknown>>;
      assert.ok(Array.isArray(steps) && steps.length > 0);
      for (const s of steps) {
        const missing = STEP_ITEM_REQUIRED.filter((k) => !(k in s));
        assert.deepEqual(missing, [], `Missing required keys in step item: ${missing.join(', ')}`);
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('ok:true step has content as an array', async () => {
    const agg = makeSuccessChainAgg();
    try {
      const body = await castChainExecuted(agg);
      const steps = body['steps'] as Array<Record<string, unknown>>;
      const okSteps = steps.filter((s) => s['ok'] === true);
      assert.ok(okSteps.length > 0, 'expected at least one ok:true step');
      for (const s of okSteps) {
        assert.ok('content' in s, 'ok:true step must have content field');
        assert.ok(Array.isArray(s['content']), `ok:true step content must be an array, got ${typeof s['content']}`);
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('ok:true step has no error field', async () => {
    const agg = makeSuccessChainAgg();
    try {
      const body = await castChainExecuted(agg);
      const steps = body['steps'] as Array<Record<string, unknown>>;
      const okSteps = steps.filter((s) => s['ok'] === true);
      assert.ok(okSteps.length > 0, 'expected at least one ok:true step');
      for (const s of okSteps) {
        assert.ok(!('error' in s), 'ok:true step must not have error field');
      }
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 2: step item ok:false conditional shape ─────────────────────────────

describe('EJ — cast:chain_executed step item ok:false shape', () => {
  test('ok:false step has error as a string', async () => {
    const agg = makePartialFailChainAgg();
    try {
      const body = await castChainExecuted(agg);
      const steps = body['steps'] as Array<Record<string, unknown>>;
      const failSteps = steps.filter((s) => s['ok'] === false);
      assert.ok(failSteps.length > 0, 'expected at least one ok:false step from partial-fail fixture');
      for (const s of failSteps) {
        assert.ok('error' in s, 'ok:false step must have error field');
        assert.equal(typeof s['error'], 'string', `ok:false step error must be a string, got ${typeof s['error']}`);
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('ok:false step has no content field', async () => {
    const agg = makePartialFailChainAgg();
    try {
      const body = await castChainExecuted(agg);
      const steps = body['steps'] as Array<Record<string, unknown>>;
      const failSteps = steps.filter((s) => s['ok'] === false);
      assert.ok(failSteps.length > 0, 'expected at least one ok:false step');
      for (const s of failSteps) {
        assert.ok(!('content' in s), 'ok:false step must not have content field');
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('ok:false step has no unexpected keys', async () => {
    const agg = makePartialFailChainAgg();
    try {
      const body = await castChainExecuted(agg);
      const steps = body['steps'] as Array<Record<string, unknown>>;
      const failSteps = steps.filter((s) => s['ok'] === false);
      assert.ok(failSteps.length > 0, 'expected at least one ok:false step');
      for (const s of failSteps) {
        const unexpected = Object.keys(s).filter((k) => !STEP_ITEM_PERMITTED.includes(k));
        assert.deepEqual(
          unexpected,
          [],
          `Unexpected keys in ok:false step item (shape drift): ${unexpected.join(', ')}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 3: catalog sub-object no-unexpected-keys ────────────────────────────

describe('EJ — cast:chain_executed catalog sub-object no-unexpected-keys', () => {
  test('catalog has no unexpected keys', async () => {
    const agg = makeSuccessChainAgg();
    try {
      const body = await castChainExecuted(agg);
      const catalog = body['catalog'] as Record<string, unknown>;
      assert.ok(catalog && typeof catalog === 'object' && !Array.isArray(catalog), 'catalog must be an object');
      const unexpected = Object.keys(catalog).filter((k) => !CATALOG_EXACT.includes(k));
      assert.deepEqual(
        unexpected,
        [],
        `Unexpected keys in cast:chain_executed catalog sub-object (shape drift): ${unexpected.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('catalog has exactly the frozen field set', async () => {
    const agg = makeSuccessChainAgg();
    try {
      const body = await castChainExecuted(agg);
      const catalog = body['catalog'] as Record<string, unknown>;
      const actual = Object.keys(catalog).sort();
      assert.deepEqual(
        actual,
        CATALOG_EXACT,
        `catalog fields have drifted.\nActual: ${actual.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});
