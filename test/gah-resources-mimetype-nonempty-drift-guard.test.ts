/**
 * GAH drift guard: freeze resources item mimeType as a non-empty string when present.
 *
 * EO (cast:plan) and EP (cast:executed/discovered) each check:
 *   assert.equal(typeof r['mimeType'], 'string', ...)
 * Neither asserts `.length > 0` — an empty-string mimeType ("") would pass both.
 * This is the same gap GAC closed for description (typeof check but not non-empty).
 *
 * mimeType in the aggregator (src-stdio/aggregator.ts ~line 1874):
 *   mimeType: r.mimeType
 * The value passes through unchanged from the fixture; no transform is applied.
 * If the fixture has no mimeType field, the key should be absent from output.
 *
 * Invariants frozen by GAH:
 *   1. When mimeType is present in the fixture, it appears as a non-empty string in output.
 *   2. The mimeType value is the exact string from the fixture (pass-through preserved).
 *   3. A resource without mimeType in the fixture does NOT expose a mimeType key in output.
 *   4. cast:plan (confirm:true) resources mimeType is non-empty when present.
 *   5. cast:discovered resources mimeType is non-empty when present.
 *
 * Tests:
 *
 *   GAH-1  cast:executed: resource mimeType, when present, is a non-empty string.
 *
 *   GAH-2  cast:executed: mimeType exact value is preserved from the fixture
 *           (i.e., pass-through is lossless — "application/json" stays "application/json").
 *
 *   GAH-3  cast:executed: a resource whose fixture has no mimeType field does NOT
 *           expose a mimeType key (undefined or missing) in the output item.
 *
 *   GAH-4  cast:plan (confirm:true): resources mimeType is non-empty when present.
 *
 *   GAH-5  cast:discovered: resources mimeType is non-empty when present.
 *
 * Fixtures use intent "list neon database projects" (4 terms: list, neon, database, projects).
 * The resource with mimeType has description containing all 4 terms to ensure score > 0.1.
 *
 * Source: src-stdio/aggregator.ts
 *   mimeType pass-through: line ~1874
 *   resources scoring:     lines ~1328–1337
 *   cast:executed:         line  ~1666
 *   cast:discovered:       line  ~1439
 *   cast:plan:             line  ~1617
 *
 * Frozen 2026-09-21.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (resources item values, not explain)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gah-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

function makeAgg(serverId: string, tools: unknown[], resources: unknown[]): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer(serverId, { tools, prompts: [], resources });
  const path = dlq();
  const config: ServerConfig[] = [
    { id: serverId, name: serverId, type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://unused.example.com/mcp', lazy: true },
  ];
  return new Aggregator(config, {
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

// Intent: "list neon database projects" → terms ['list','neon','database','projects'] (4 terms)
const INTENT = 'list neon database projects';

// ── GAH-1: cast:executed — mimeType non-empty when present ───────────────────

test('GAH-1: cast:executed resources mimeType is a non-empty string when present', async () => {
  const agg = makeAgg('gah-exec', [
    {
      name: 'list_neon_db_projects',
      description: 'List neon database projects',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: '["p1"]' }] },
    },
  ], [
    {
      uri: 'neon://projects/list',
      name: 'Neon DB Projects',
      description: 'List neon database projects overview',
      mimeType: 'application/json',
    },
  ]);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const resources = body['resources'] as unknown[];
    assert.ok(Array.isArray(resources) && resources.length > 0, 'resources must be non-empty array');
    const item = resources[0] as Record<string, unknown>;
    assert.ok('mimeType' in item, 'mimeType key must be present when fixture has it');
    const mt = item['mimeType'];
    assert.equal(typeof mt, 'string', `mimeType must be a string, got ${typeof mt}`);
    assert.ok((mt as string).length > 0, `mimeType must be non-empty, got "${mt}"`);
  } finally {
    await agg.shutdown();
  }
});

// ── GAH-2: cast:executed — mimeType exact value preserved ────────────────────

test('GAH-2: cast:executed resources mimeType exact value is preserved from fixture', async () => {
  const agg = makeAgg('gah-exact', [
    {
      name: 'list_neon_db_projects',
      description: 'List neon database projects',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: '["p1"]' }] },
    },
  ], [
    {
      uri: 'neon://projects/list',
      name: 'Neon DB Projects',
      description: 'List neon database projects overview',
      mimeType: 'application/json',
    },
  ]);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const resources = body['resources'] as unknown[];
    assert.ok(Array.isArray(resources) && resources.length > 0, 'resources must be non-empty array');
    const item = resources[0] as Record<string, unknown>;
    assert.equal(item['mimeType'], 'application/json',
      `mimeType must be exactly 'application/json', got "${item['mimeType']}"`);
  } finally {
    await agg.shutdown();
  }
});

// ── GAH-3: cast:executed — absent mimeType not exposed ───────────────────────

test('GAH-3: cast:executed resource without fixture mimeType does not expose mimeType key', async () => {
  const agg = makeAgg('gah-absent', [
    {
      name: 'list_neon_db_projects',
      description: 'List neon database projects',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: '["p1"]' }] },
    },
  ], [
    {
      uri: 'neon://projects/list',
      name: 'Neon DB Projects',
      description: 'List neon database projects overview',
      // no mimeType field
    },
  ]);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const resources = body['resources'] as unknown[];
    assert.ok(Array.isArray(resources) && resources.length > 0, 'resources must be non-empty array');
    const item = resources[0] as Record<string, unknown>;
    assert.ok(!('mimeType' in item), 'mimeType key must be absent when fixture has none');
  } finally {
    await agg.shutdown();
  }
});

// ── GAH-4: cast:plan — mimeType non-empty when present ───────────────────────

test('GAH-4: cast:plan resources mimeType is a non-empty string when present', async () => {
  const agg = makeAgg('gah-plan', [
    {
      name: 'list_neon_db_projects',
      description: 'List neon database projects',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: '["p1"]' }] },
    },
  ], [
    {
      uri: 'neon://projects/list',
      name: 'Neon DB Projects',
      description: 'List neon database projects overview',
      mimeType: 'application/json',
    },
  ]);
  try {
    const body = await cast(agg, { intent: INTENT, confirm: true });
    assert.equal(body['cast'], 'plan', `expected cast:plan, got ${body['cast']}`);
    const resources = body['resources'] as unknown[];
    assert.ok(Array.isArray(resources) && resources.length > 0, 'plan resources must be non-empty array');
    const item = resources[0] as Record<string, unknown>;
    assert.ok('mimeType' in item, 'mimeType key must be present when fixture has it');
    const mt = item['mimeType'];
    assert.equal(typeof mt, 'string', `plan resources mimeType must be a string, got ${typeof mt}`);
    assert.ok((mt as string).length > 0, `plan resources mimeType must be non-empty, got "${mt}"`);
  } finally {
    await agg.shutdown();
  }
});

// ── GAH-5: cast:discovered — mimeType non-empty when present ─────────────────

test('GAH-5: cast:discovered resources mimeType is a non-empty string when present', async () => {
  // Tool has no keyword overlap → best === undefined → cast:discovered
  const agg = makeAgg('gah-disc', [
    {
      name: 'write_file_path',
      description: 'Write content to a local path',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      response: { content: [{ type: 'text', text: '{"ok":true}' }] },
    },
  ], [
    {
      uri: 'neon://projects/list',
      name: 'Neon DB Projects',
      description: 'List neon database projects overview',
      mimeType: 'application/json',
    },
  ]);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'discovered', `expected cast:discovered, got ${body['cast']}`);
    const resources = body['resources'] as unknown[];
    assert.ok(Array.isArray(resources) && resources.length > 0, 'discovered resources must be non-empty array');
    const item = resources[0] as Record<string, unknown>;
    assert.ok('mimeType' in item, 'mimeType key must be present when fixture has it');
    const mt = item['mimeType'];
    assert.equal(typeof mt, 'string', `discovered resources mimeType must be a string, got ${typeof mt}`);
    assert.ok((mt as string).length > 0, `discovered resources mimeType must be non-empty, got "${mt}"`);
  } finally {
    await agg.shutdown();
  }
});
