/**
 * GEN drift guard: freeze cast:chain_executed `catalog` sub-object VALUE TYPES.
 *
 * EJ (ej-chain-executed-step-catalog-shape.test.ts) froze the catalog sub-object
 * exact KEY SET:
 *   catalog EXACTLY {accomplishes, chain, name}  (3 keys)
 *
 * EJ does NOT assert VALUE TYPES for those fields. The remaining gap:
 *
 *   A regression serialising `catalog.chain` as a JSON string
 *   `"[\"neon/list_projects\",\"neon/create_project\"]"` instead of an actual
 *   Array passes EJ (key `chain` present). Similarly, storing `name` or
 *   `accomplishes` as null, or making `chain` an array of objects rather than
 *   strings, passes EJ silently.
 *
 * Source: src-stdio/aggregator.ts (chain_executed branch) — catalog built
 * directly from the matching catalogCombo:
 *   catalog = { name: combo.name, chain: combo.chain, accomplishes: combo.accomplishes }
 *
 * Expected types:
 *   name        — non-empty string
 *   accomplishes — non-empty string
 *   chain       — Array (of strings)
 *   chain[i]    — string (namespaced "serverId/toolName" containing exactly one '/')
 *
 * GEN freezes:
 *
 *   GEN-1  catalog.name is a non-empty string
 *   GEN-2  catalog.accomplishes is a non-empty string
 *   GEN-3  catalog.chain is an Array
 *   GEN-4  each catalog.chain item is a string with exactly one '/' (namespaced)
 *   GEN-5  catalog.chain is non-empty (at least one step)
 *
 * Fixture: neon combo (list_projects → create_project) — same as EJ/GEH/GEK.
 *
 * Frozen 2026-10-01.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (catalog sub-object
 *     value types, not explanation sub-object)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gen-${Date.now()}-${++_seq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

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

const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true,
};

function makeChainAgg(): Aggregator {
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
  const path = dlq();
  return new Aggregator([NEON_CFG], {
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
  assert.equal(body['cast'], 'chain_executed', `expected chain_executed, got ${String(body['cast'])}`);
  return body;
}

// ── GEN-1: catalog.name is a non-empty string ─────────────────────────────────

test('GEN-1: catalog.name is a non-empty string', async () => {
  const agg = makeChainAgg();
  try {
    const body = await castChainExecuted(agg);
    const catalog = body['catalog'] as Record<string, unknown>;
    assert.ok(catalog !== null && typeof catalog === 'object', 'GEN-1: catalog must be an object');
    assert.strictEqual(
      typeof catalog['name'],
      'string',
      `GEN-1: catalog.name must be a string, got ${typeof catalog['name']}`,
    );
    assert.ok(
      (catalog['name'] as string).length > 0,
      'GEN-1: catalog.name must be non-empty',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEN-2: catalog.accomplishes is a non-empty string ────────────────────────

test('GEN-2: catalog.accomplishes is a non-empty string', async () => {
  const agg = makeChainAgg();
  try {
    const body = await castChainExecuted(agg);
    const catalog = body['catalog'] as Record<string, unknown>;
    assert.ok(catalog !== null && typeof catalog === 'object', 'GEN-2: catalog must be an object');
    assert.strictEqual(
      typeof catalog['accomplishes'],
      'string',
      `GEN-2: catalog.accomplishes must be a string, got ${typeof catalog['accomplishes']}`,
    );
    assert.ok(
      (catalog['accomplishes'] as string).length > 0,
      'GEN-2: catalog.accomplishes must be non-empty',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEN-3: catalog.chain is an Array ─────────────────────────────────────────

test('GEN-3: catalog.chain is an Array (not a stringified JSON or object)', async () => {
  const agg = makeChainAgg();
  try {
    const body = await castChainExecuted(agg);
    const catalog = body['catalog'] as Record<string, unknown>;
    assert.ok(catalog !== null && typeof catalog === 'object', 'GEN-3: catalog must be an object');
    assert.ok(
      Array.isArray(catalog['chain']),
      `GEN-3: catalog.chain must be an Array, got ${typeof catalog['chain']}: ${JSON.stringify(catalog['chain'])}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEN-4: each catalog.chain item is a namespaced string ────────────────────

test('GEN-4: each catalog.chain item is a string with exactly one "/" (namespaced tool name)', async () => {
  const agg = makeChainAgg();
  try {
    const body = await castChainExecuted(agg);
    const catalog = body['catalog'] as Record<string, unknown>;
    const chain = catalog['chain'] as unknown[];
    assert.ok(Array.isArray(chain), 'GEN-4: catalog.chain must be an Array');
    for (const item of chain) {
      assert.strictEqual(
        typeof item,
        'string',
        `GEN-4: each chain item must be a string, got ${typeof item}: ${JSON.stringify(item)}`,
      );
      const slashCount = (item as string).split('/').length - 1;
      assert.strictEqual(
        slashCount,
        1,
        `GEN-4: chain item must contain exactly one '/' (namespaced), got ${JSON.stringify(item)}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GEN-5: catalog.chain is non-empty ────────────────────────────────────────

test('GEN-5: catalog.chain is non-empty (at least one step)', async () => {
  const agg = makeChainAgg();
  try {
    const body = await castChainExecuted(agg);
    const catalog = body['catalog'] as Record<string, unknown>;
    const chain = catalog['chain'] as unknown[];
    assert.ok(Array.isArray(chain), 'GEN-5: catalog.chain must be an Array');
    assert.ok(
      chain.length > 0,
      'GEN-5: catalog.chain must contain at least one step',
    );
  } finally {
    await agg.shutdown();
  }
});
