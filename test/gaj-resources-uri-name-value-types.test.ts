/**
 * GAJ drift guard: freeze resources item `uri` and `name` as non-empty strings.
 *
 * GAG froze score range, finitude, and sort order; GAH froze mimeType non-empty
 * when present. Neither froze the two primary identity fields — `uri` and `name`
 * — that every resources item must carry.
 *
 * Source (src-stdio/aggregator.ts, related.resources construction ~line 1407):
 *   related.resources = scoredResources.map((r) => ({
 *     uri:         r.uri,
 *     name:        r.name,
 *     description: r.description,
 *     mimeType:    r.mimeType,
 *     score:       r.score,
 *   }));
 *
 * Invariants frozen by GAJ:
 *   1. Every resources item `uri` is a non-empty string.
 *   2. Every resources item `name` is a non-empty string.
 *   3. `uri` is namespaced as `{serverId}://{backendUri}` (src line ~1872);
 *      `name` is namespaced as `[{serverName}] {backendName}` (src line ~1873).
 *      Since makeAgg sets config.id === config.name === serverId, both prefixes
 *      use the same string value.
 *   4-5. Same invariants hold on cast:discovered and cast:plan paths.
 *
 * Tests:
 *
 *   GAJ-1  cast:executed: every resources item `uri` is typeof 'string' and
 *           has length > 0.
 *
 *   GAJ-2  cast:executed: every resources item `name` is typeof 'string' and
 *           has length > 0.
 *
 *   GAJ-3  cast:executed: `uri` is namespaced as `{serverId}://{backendUri}`;
 *           `name` is namespaced as `[{serverName}] {backendName}`.
 *
 *   GAJ-4  cast:discovered: `uri` and `name` are non-empty strings on the
 *           discovered path (no tool match, resources surface).
 *
 *   GAJ-5  cast:plan (confirm:true): `uri` and `name` are non-empty strings.
 *
 * Fixtures:
 *
 *   GAJ-1/2/3 use a 'gaj-exec' server:
 *     - tool: 'list_neon_db_projects', description 'List neon database projects'
 *       → 4 intent terms → cast:executed
 *     - resource: backendUri 'neon://projects/list', outputUri 'gaj-exec://neon://projects/list',
 *       name 'Neon DB Projects', description 'List neon database projects overview'
 *     - resource: backendUri 'neon://status', outputUri 'gaj-exec://neon://status',
 *       name 'Neon Status', description 'Database query statistics'
 *     (server ID 'gaj-exec' used so URIs don't embed 'passthrough' confusion)
 *
 *   GAJ-4 uses a 'gaj-disc' server (cast:discovered):
 *     - tool with zero intent overlap → best === undefined
 *     - resource: uri 'neon://projects/list', name 'Neon DB Projects',
 *       description 'List neon database projects template'
 *     - resource: uri 'neon://overview', name 'Neon Overview',
 *       description 'Browse neon database records'
 *
 *   GAJ-5 uses a 'gaj-plan' server (cast:plan via confirm:true):
 *     - tool: 'query_neon_db_projects', description 'Query neon database projects'
 *       → 4/4 → cast:plan
 *     - resource: uri 'neon://projects/list', name 'Neon DB Projects',
 *       description 'List neon database projects guide'
 *     - resource: uri 'neon://status', name 'Neon Status',
 *       description 'Count neon database totals'
 *
 * Source refs: src-stdio/aggregator.ts
 *   related.resources construction: lines ~1407–1414
 *   score filter + sort: lines ~1328–1337
 *
 * Frozen 2026-09-21.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (resources item fields)
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
  return join(tmpdir(), `ch1tty-gaj-${Date.now()}-${++dlqSeq}.jsonl`);
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

// Shared resource fixtures for exec/plan paths
const EXEC_RESOURCES = [
  {
    uri: 'neon://projects/list',
    name: 'Neon DB Projects',
    description: 'List neon database projects overview',
  },
  {
    uri: 'neon://status',
    name: 'Neon Status',
    description: 'Database query statistics',
  },
];

const EXEC_TOOL = {
  name: 'list_neon_db_projects',
  description: 'List neon database projects',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text', text: '["p1"]' }] },
};

// ── GAJ-1: cast:executed — uri is a non-empty string ─────────────────────────

test('GAJ-1: cast:executed resources items have uri as a non-empty string', async () => {
  const agg = makeAgg('gaj-exec-uri', [EXEC_TOOL], EXEC_RESOURCES);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const resources = body['resources'] as unknown[];
    assert.ok(Array.isArray(resources) && resources.length > 0, 'resources must be a non-empty array');
    for (const item of resources) {
      const r = item as Record<string, unknown>;
      assert.equal(typeof r['uri'], 'string',
        `resources item uri must be typeof 'string', got ${typeof r['uri']}`);
      assert.ok((r['uri'] as string).length > 0,
        `resources item uri must be non-empty, got empty string`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GAJ-2: cast:executed — name is a non-empty string ────────────────────────

test('GAJ-2: cast:executed resources items have name as a non-empty string', async () => {
  const agg = makeAgg('gaj-exec-name', [EXEC_TOOL], EXEC_RESOURCES);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const resources = body['resources'] as unknown[];
    assert.ok(Array.isArray(resources) && resources.length > 0, 'resources must be a non-empty array');
    for (const item of resources) {
      const r = item as Record<string, unknown>;
      assert.equal(typeof r['name'], 'string',
        `resources item name must be typeof 'string', got ${typeof r['name']}`);
      assert.ok((r['name'] as string).length > 0,
        `resources item name must be non-empty, got empty string`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GAJ-3: cast:executed — uri and name namespacing transforms ────────────────

test('GAJ-3: cast:executed resources uri is {serverId}://{backendUri} and name is [{serverName}] {backendName}', async () => {
  const SERVER_ID = 'gaj-exec';
  const agg = makeAgg(SERVER_ID, [EXEC_TOOL], EXEC_RESOURCES);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const resources = body['resources'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(resources) && resources.length > 0, 'resources must be a non-empty array');
    const registeredUris = new Set(EXEC_RESOURCES.map((r) => r.uri));
    const registeredNames = new Set(EXEC_RESOURCES.map((r) => r.name));
    // Filter to only the resources from our fixture backend (the aggregator may
    // inject built-in ch1tty:// suggestion resources alongside backend resources).
    const fixtureResources = resources.filter((item) =>
      ((item as Record<string, unknown>)['uri'] as string).startsWith(`${SERVER_ID}://`),
    );
    assert.ok(fixtureResources.length > 0,
      `expected at least one resource from '${SERVER_ID}' server, got none (all: ${JSON.stringify(resources.map((r) => (r as Record<string, unknown>)['uri']))})`);
    for (const item of fixtureResources) {
      const uri = item['uri'] as string;
      const name = item['name'] as string;
      // URI: aggregator prefixes with `{serverId}://`
      assert.ok(uri.startsWith(`${SERVER_ID}://`),
        `uri '${uri}' must start with '${SERVER_ID}://' (URI namespacing invariant)`);
      const backendUri = uri.slice(`${SERVER_ID}://`.length);
      assert.ok(registeredUris.has(backendUri),
        `backend URI portion '${backendUri}' was not in the registered resource URIs`);
      // Name: aggregator prefixes with `[{serverName}] ` (config.name === SERVER_ID in makeAgg)
      assert.ok(name.startsWith(`[${SERVER_ID}] `),
        `name '${name}' must start with '[${SERVER_ID}] ' (name namespacing invariant)`);
      const backendName = name.slice(`[${SERVER_ID}] `.length);
      assert.ok(registeredNames.has(backendName),
        `backend name portion '${backendName}' was not in the registered resource names`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GAJ-4: cast:discovered — uri and name are non-empty strings ───────────────

test('GAJ-4: cast:discovered resources items have non-empty uri and name strings', async () => {
  // Tool with zero keyword overlap → best === undefined → cast:discovered
  const agg = makeAgg('gaj-disc', [
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
      description: 'List neon database projects template',
    },
    {
      uri: 'neon://overview',
      name: 'Neon Overview',
      description: 'Browse neon database records',
    },
  ]);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'discovered', `expected cast:discovered, got ${body['cast']}`);
    const resources = body['resources'] as unknown[];
    assert.ok(Array.isArray(resources) && resources.length > 0, 'resources must be a non-empty array');
    for (const item of resources) {
      const r = item as Record<string, unknown>;
      assert.equal(typeof r['uri'], 'string',
        `discovered resources uri must be typeof 'string', got ${typeof r['uri']}`);
      assert.ok((r['uri'] as string).length > 0, 'discovered resources uri must be non-empty');
      assert.equal(typeof r['name'], 'string',
        `discovered resources name must be typeof 'string', got ${typeof r['name']}`);
      assert.ok((r['name'] as string).length > 0, 'discovered resources name must be non-empty');
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GAJ-5: cast:plan — uri and name are non-empty strings ─────────────────────

test('GAJ-5: cast:plan resources items have non-empty uri and name strings', async () => {
  const agg = makeAgg('gaj-plan', [
    {
      name: 'query_neon_db_projects',
      description: 'Query neon database projects',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: '["p1"]' }] },
    },
  ], [
    {
      uri: 'neon://projects/list',
      name: 'Neon DB Projects',
      description: 'List neon database projects guide',
    },
    {
      uri: 'neon://status',
      name: 'Neon Status',
      description: 'Count neon database totals',
    },
  ]);
  try {
    const body = await cast(agg, { intent: INTENT, confirm: true });
    assert.equal(body['cast'], 'plan', `expected cast:plan, got ${body['cast']}`);
    const resources = body['resources'] as unknown[];
    assert.ok(Array.isArray(resources) && resources.length > 0, 'plan resources must be a non-empty array');
    for (const item of resources) {
      const r = item as Record<string, unknown>;
      assert.equal(typeof r['uri'], 'string',
        `plan resources uri must be typeof 'string', got ${typeof r['uri']}`);
      assert.ok((r['uri'] as string).length > 0, 'plan resources uri must be non-empty');
      assert.equal(typeof r['name'], 'string',
        `plan resources name must be typeof 'string', got ${typeof r['name']}`);
      assert.ok((r['name'] as string).length > 0, 'plan resources name must be non-empty');
    }
  } finally {
    await agg.shutdown();
  }
});
