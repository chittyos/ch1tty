/**
 * GED drift guard: freeze `scope` sub-object exact key set in cast responses.
 *
 * EQ (eq-cast-scope-sub-object-shape.test.ts) checks that the `scope` sub-object
 * has NO UNEXPECTED keys (a permissive/superset check). EQ never asserts that
 * EXACTLY the right keys — and nothing else — are present in each combination.
 * A regression that drops `servers` from the scope annotation (leaving an empty
 * object `{}`) or adds a phantom `serverIds` alias alongside `servers` would pass
 * EQ silently while changing the public contract.
 *
 * The scope annotation is built at aggregator.ts lines 1349–1351:
 *   const scopeAnnotation = (scopeServers || scopeCategories)
 *     ? { ...(scopeServers    ? { servers:    scopeServers    } : {}),
 *         ...(scopeCategories ? { categories: scopeCategories } : {}) }
 *     : null;
 *
 * The three possible combinations when scope is active:
 *   servers only     → EXACTLY {servers}      (1 key)
 *   categories only  → EXACTLY {categories}   (1 key)
 *   both             → EXACTLY {servers, categories}  (2 keys)
 *
 * GED freezes the exact key set for each combination across cast response modes
 * (cast:no_match, cast:resolved dryRun, cast:plan):
 *
 *   GED-1  scope(servers only) → EXACTLY {servers}     — no phantom keys, no missing key
 *   GED-2  scope(categories only) → EXACTLY {categories}
 *   GED-3  scope(servers + categories) → EXACTLY {servers, categories}
 *   GED-4  scope.servers is an Array of strings (value-type freeze)
 *   GED-5  scope.categories is an Array of strings (value-type freeze)
 *
 * Tests use cast:no_match (servers/categories that don't match any tool) to keep
 * setup trivial — the scope annotation is the same across all cast modes.
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (scope sub-object, not explanation)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;
function makeDlq(): string {
  return join(tmpdir(), `ch1tty-ged-${Date.now()}-${++_seq}.jsonl`);
}

const NEON_CFG: ServerConfig = {
  id: 'neon',
  name: 'Neon Database',
  type: 'remote',
  access: 'readwrite',
  category: 'code',
  endpoint: 'https://neon.test/mcp',
};

const NEON_TOOLS: ToolEntry[] = [
  {
    name: 'list_projects',
    description: 'List Neon projects',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'run_sql',
    description: 'Run SQL query on Neon',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  },
];

function makeBackend(): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: NEON_TOOLS.length, toolCacheAge: 0 }),
    listTools: async () => NEON_TOOLS,
    callTool: async (): Promise<ToolCallResult> => ({
      content: [{ type: 'text', text: 'tool-output' }],
    }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

function makeAgg(): Aggregator {
  return new Aggregator([NEON_CFG], {
    backendFactory: () => makeBackend(),
    embedEnabled: false,
    ledgerDlqPath: makeDlq(),
  } as Parameters<typeof Aggregator.prototype.callTool>[1]);
}

function parseCast(result: ToolCallResult): Record<string, unknown> {
  assert.ok(Array.isArray(result.content) && result.content.length > 0, 'result.content must be non-empty');
  const item = result.content[0] as { type: string; text: string };
  assert.equal(item.type, 'text', 'content[0].type must be text');
  return JSON.parse(item.text) as Record<string, unknown>;
}

function assertExactScopeKeys(
  scope: unknown,
  expected: string[],
  label: string,
): void {
  assert.ok(scope !== null && typeof scope === 'object' && !Array.isArray(scope), `${label}: scope must be a non-null, non-array object`);
  const actual = Object.keys(scope as Record<string, unknown>).sort();
  assert.deepEqual(actual, expected.slice().sort(), `${label}: scope sub-object must have EXACTLY ${JSON.stringify(expected.sort())}; got ${JSON.stringify(actual)}`);
}

// ── GED-1: scope(servers only) → EXACTLY {servers} ───────────────────────────

test('GED-1: scope sub-object with only servers has EXACTLY {servers} (no phantom keys)', async () => {
  const agg = makeAgg();
  // Use a non-existent server id to force cast:no_match — simplest path to check scope annotation.
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'ged-no-match-intent-servers-only-xyz',
    scope: { servers: ['nonexistent-server-ged1'] },
  });
  const body = parseCast(result);
  const scope = body['scope'];
  assertExactScopeKeys(scope, ['servers'], 'GED-1 scope(servers only)');
  await agg.shutdown();
});

// ── GED-2: scope(categories only) → EXACTLY {categories} ─────────────────────

test('GED-2: scope sub-object with only categories has EXACTLY {categories} (no phantom keys)', async () => {
  const agg = makeAgg();
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'ged-no-match-intent-categories-only-xyz',
    scope: { categories: ['nonexistent-category-ged2'] },
  });
  const body = parseCast(result);
  const scope = body['scope'];
  assertExactScopeKeys(scope, ['categories'], 'GED-2 scope(categories only)');
  await agg.shutdown();
});

// ── GED-3: scope(servers + categories) → EXACTLY {servers, categories} ───────

test('GED-3: scope sub-object with both servers and categories has EXACTLY {servers, categories}', async () => {
  const agg = makeAgg();
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'ged-no-match-intent-both-xyz',
    scope: { servers: ['nonexistent-server-ged3'], categories: ['nonexistent-category-ged3'] },
  });
  const body = parseCast(result);
  const scope = body['scope'];
  assertExactScopeKeys(scope, ['servers', 'categories'], 'GED-3 scope(both)');
  await agg.shutdown();
});

// ── GED-4: scope.servers is an Array of strings ───────────────────────────────

test('GED-4: scope.servers is an Array and each element is a string', async () => {
  const agg = makeAgg();
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'ged-no-match-intent-servers-type-xyz',
    scope: { servers: ['nonexistent-server-ged4a', 'nonexistent-server-ged4b'] },
  });
  const body = parseCast(result);
  const scope = body['scope'] as Record<string, unknown>;
  assert.ok(Array.isArray(scope['servers']), 'scope.servers must be an Array');
  const servers = scope['servers'] as unknown[];
  assert.ok(servers.length > 0, 'scope.servers must be non-empty (passed 2 server ids)');
  for (const s of servers) {
    assert.equal(typeof s, 'string', `scope.servers element must be a string; got ${typeof s}`);
  }
  await agg.shutdown();
});

// ── GED-5: scope.categories is an Array of strings ───────────────────────────

test('GED-5: scope.categories is an Array and each element is a string', async () => {
  const agg = makeAgg();
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'ged-no-match-intent-categories-type-xyz',
    scope: { categories: ['nonexistent-cat-ged5a', 'nonexistent-cat-ged5b'] },
  });
  const body = parseCast(result);
  const scope = body['scope'] as Record<string, unknown>;
  assert.ok(Array.isArray(scope['categories']), 'scope.categories must be an Array');
  const cats = scope['categories'] as unknown[];
  assert.ok(cats.length > 0, 'scope.categories must be non-empty (passed 2 categories)');
  for (const c of cats) {
    assert.equal(typeof c, 'string', `scope.categories element must be a string; got ${typeof c}`);
  }
  await agg.shutdown();
});
