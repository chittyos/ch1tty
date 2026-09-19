/**
 * EK: Drift guard — cast:resolved catalogCombo sub-object shape,
 *     cast:chain_executed latencyBreakdown no-unexpected-keys, and
 *     cast:executed resolvedFromCatalog sub-object shape.
 *
 * Three gaps not covered by earlier drift guards:
 *
 * ── cast:resolved catalogCombo sub-object ────────────────────────────────────
 * EG includes catalogCombo in RESOLVED_PERMITTED but no test freezes its
 * internal shape. EH freezes resolvedFromCatalog for plan mode — catalogCombo
 * in the resolved path is the same construction but a separate code path.
 *
 * catalogCombo EXACT: { accomplishes, chain, name }
 *
 * ── cast:chain_executed latencyBreakdown no-unexpected-keys ──────────────────
 * EF checks that latencyBreakdown required keys {executionMs, registryMs,
 * scoringMs} are present and are non-negative numbers, but has no
 * no-unexpected-keys guard. EG covers this for cast:executed but not for
 * cast:chain_executed.
 *
 * latencyBreakdown PERMITTED: { brainMs?, executionMs, registryMs, scoringMs }
 *
 * ── cast:executed resolvedFromCatalog sub-object ─────────────────────────────
 * EH freezes resolvedFromCatalog in cast:plan mode. The executed path emits
 * the same sub-object but via a separate branch; no test confirms the shape
 * holds there too.
 *
 * resolvedFromCatalog EXACT: { accomplishes, chain, name }
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

const CATALOG_COMBO_EXACT: readonly string[] = ['accomplishes', 'chain', 'name'];
const LATENCY_BREAKDOWN_PERMITTED: readonly string[] = ['brainMs', 'executionMs', 'registryMs', 'scoringMs'];
const RESOLVED_FROM_CATALOG_EXACT: readonly string[] = ['accomplishes', 'chain', 'name'];

// ── Helpers ───────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-ek-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

// Catalog with a 2-step neon combo for triggering catalogCombo in resolved/executed paths.
const EK_CATALOG = {
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
    suggestionsCatalog: EK_CATALOG,
    focus: 'code',
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

async function cast(agg: Aggregator, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', args);
  assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

// ── Suite 1: cast:resolved catalogCombo sub-object shape ──────────────────────

describe('EK — cast:resolved catalogCombo sub-object shape', () => {
  test('catalogCombo has no unexpected keys in cast:resolved', async () => {
    const agg = makeCatalogAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects', dryRun: true });
      assert.equal(body['cast'], 'resolved', `expected cast:resolved, got ${body['cast']}`);
      assert.ok('catalogCombo' in body, 'catalogCombo must be present when catalog combo resolves in dryRun');
      const cc = body['catalogCombo'] as Record<string, unknown>;
      assert.ok(cc && typeof cc === 'object' && !Array.isArray(cc), 'catalogCombo must be an object');
      const unexpected = Object.keys(cc).filter((k) => !CATALOG_COMBO_EXACT.includes(k));
      assert.deepEqual(
        unexpected,
        [],
        `Unexpected keys in cast:resolved catalogCombo (shape drift): ${unexpected.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('catalogCombo has exactly the frozen field set in cast:resolved', async () => {
    const agg = makeCatalogAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects', dryRun: true });
      assert.equal(body['cast'], 'resolved');
      const cc = body['catalogCombo'] as Record<string, unknown>;
      if (cc) {
        const actual = Object.keys(cc).sort();
        assert.deepEqual(
          actual,
          CATALOG_COMBO_EXACT,
          `catalogCombo fields have drifted.\nActual: ${actual.join(', ')}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('catalogCombo field types are correct in cast:resolved', async () => {
    const agg = makeCatalogAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects', dryRun: true });
      assert.equal(body['cast'], 'resolved');
      const cc = body['catalogCombo'] as Record<string, unknown>;
      if (cc) {
        assert.ok(typeof cc['name'] === 'string' && (cc['name'] as string).length > 0, 'catalogCombo.name must be a non-empty string');
        assert.ok(Array.isArray(cc['chain']) && (cc['chain'] as unknown[]).length > 0, 'catalogCombo.chain must be a non-empty array');
        for (const step of cc['chain'] as unknown[]) {
          assert.equal(typeof step, 'string', 'each catalogCombo.chain entry must be a string');
        }
        assert.ok(typeof cc['accomplishes'] === 'string' && (cc['accomplishes'] as string).length > 0, 'catalogCombo.accomplishes must be a non-empty string');
      }
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 2: cast:chain_executed latencyBreakdown no-unexpected-keys ──────────

describe('EK — cast:chain_executed latencyBreakdown no-unexpected-keys', () => {
  test('latencyBreakdown has no unexpected keys in cast:chain_executed', async () => {
    const agg = makeCatalogAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects', chain: true });
      assert.equal(body['cast'], 'chain_executed', `expected chain_executed, got ${body['cast']}`);
      const lb = body['latencyBreakdown'] as Record<string, unknown>;
      assert.ok(lb && typeof lb === 'object' && !Array.isArray(lb), 'latencyBreakdown must be an object');
      const unexpected = Object.keys(lb).filter((k) => !LATENCY_BREAKDOWN_PERMITTED.includes(k));
      assert.deepEqual(
        unexpected,
        [],
        `Unexpected keys in cast:chain_executed latencyBreakdown (shape drift): ${unexpected.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('latencyBreakdown values are all non-negative numbers in cast:chain_executed', async () => {
    const agg = makeCatalogAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects', chain: true });
      assert.equal(body['cast'], 'chain_executed');
      const lb = body['latencyBreakdown'] as Record<string, unknown>;
      for (const k of Object.keys(lb)) {
        assert.ok(
          typeof lb[k] === 'number' && (lb[k] as number) >= 0,
          `latencyBreakdown.${k} must be a non-negative number, got ${JSON.stringify(lb[k])}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 3: cast:executed resolvedFromCatalog sub-object shape ───────────────

describe('EK — cast:executed resolvedFromCatalog sub-object shape', () => {
  test('resolvedFromCatalog has no unexpected keys in cast:executed', async () => {
    const agg = makeCatalogAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects' });
      assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
      assert.ok('resolvedFromCatalog' in body, 'resolvedFromCatalog must be present when catalog combo resolves in executed mode');
      const rfc = body['resolvedFromCatalog'] as Record<string, unknown>;
      assert.ok(rfc && typeof rfc === 'object' && !Array.isArray(rfc), 'resolvedFromCatalog must be an object');
      const unexpected = Object.keys(rfc).filter((k) => !RESOLVED_FROM_CATALOG_EXACT.includes(k));
      assert.deepEqual(
        unexpected,
        [],
        `Unexpected keys in cast:executed resolvedFromCatalog (shape drift): ${unexpected.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('resolvedFromCatalog has exactly the frozen field set in cast:executed', async () => {
    const agg = makeCatalogAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects' });
      assert.equal(body['cast'], 'executed');
      const rfc = body['resolvedFromCatalog'] as Record<string, unknown>;
      if (rfc) {
        const actual = Object.keys(rfc).sort();
        assert.deepEqual(
          actual,
          RESOLVED_FROM_CATALOG_EXACT,
          `cast:executed resolvedFromCatalog fields have drifted.\nActual: ${actual.join(', ')}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('resolvedFromCatalog field types are correct in cast:executed', async () => {
    const agg = makeCatalogAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects' });
      assert.equal(body['cast'], 'executed');
      const rfc = body['resolvedFromCatalog'] as Record<string, unknown>;
      if (rfc) {
        assert.ok(typeof rfc['name'] === 'string' && (rfc['name'] as string).length > 0, 'resolvedFromCatalog.name must be a non-empty string');
        assert.ok(Array.isArray(rfc['chain']) && (rfc['chain'] as unknown[]).length > 0, 'resolvedFromCatalog.chain must be a non-empty array');
        for (const step of rfc['chain'] as unknown[]) {
          assert.equal(typeof step, 'string', 'each resolvedFromCatalog.chain entry must be a string');
        }
        assert.ok(typeof rfc['accomplishes'] === 'string' && (rfc['accomplishes'] as string).length > 0, 'resolvedFromCatalog.accomplishes must be a non-empty string');
      }
    } finally {
      await agg.shutdown();
    }
  });
});
