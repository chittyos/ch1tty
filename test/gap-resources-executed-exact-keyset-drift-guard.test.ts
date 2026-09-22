/**
 * GAP drift guard: freeze resources item exact key set in cast:executed responses.
 *
 * EP (cast:executed/discovered) checks:
 *   Resources item PERMITTED: { description, mimeType, name, score, uri }
 *   Resources item REQUIRED:  { name, score, uri }
 * EP does NOT assert an exact key set — a regression injecting an extra key
 * (e.g. 'serverId', 'namespace', or 'type') would pass EP silently.
 *
 * GAB froze the resources item exact key set for cast:plan and cast:discovered
 * but did NOT cover cast:executed. GAP closes the cast:executed gap.
 *
 * Aggregator resources map (src-stdio/aggregator.ts ~lines 1407–1413):
 *   related.resources = scoredResources.map((r) => ({
 *     uri: r.uri,
 *     name: r.name,
 *     description: r.description,   // absent when undefined (JSON serialization)
 *     mimeType: r.mimeType,          // absent when undefined (JSON serialization)
 *     score: r.score,
 *   }));
 * Optional fields (description, mimeType) are present in output ONLY when the
 * fixture carries them; undefined values are dropped by JSON.stringify.
 *
 * Invariants frozen by GAP:
 *   1. cast:executed resources item WITHOUT description/mimeType has exactly
 *      {name, score, uri} — no extra keys.
 *   2. cast:executed resources item WITH description (no mimeType) has exactly
 *      {description, name, score, uri} — no extra keys.
 *   3. cast:executed resources item WITH mimeType (no description) has exactly
 *      {mimeType, name, score, uri} — no extra keys.
 *   4. cast:executed resources item WITH description AND mimeType has exactly
 *      {description, mimeType, name, score, uri} — no extra keys.
 *   5. cast:plan (confirm:true) resources item WITH description AND mimeType has
 *      exactly {description, mimeType, name, score, uri} — no extra keys.
 *
 * All tests use intent "list neon database projects" (4 terms: list, neon,
 * database, projects). TOOL_EXEC scores 1.0 on the intent → cast:executed;
 * confirm:true → cast:plan. Each resource fixture's haystack covers all 4 terms
 * (score 1.0 → passes filter > 0.1 → appears in related.resources).
 *
 * Resource URI namespacing by the aggregator (line ~1872):
 *   `${config.id}://${r.uri}` — tests find items via String(uri).endsWith(fixture.uri).
 *
 * Source refs:
 *   resources map:  src-stdio/aggregator.ts lines ~1407–1413
 *   cast:executed:  src-stdio/aggregator.ts line  ~1666
 *   cast:plan:      src-stdio/aggregator.ts line  ~1617
 *
 * Frozen 2026-09-21.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (resources item key set, not explain)
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
  return join(tmpdir(), `ch1tty-gap-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

function makeAgg(serverId: string, tools: unknown[], resources: unknown[]): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer(serverId, { tools, prompts: [], resources });
  const path = dlq();
  const config: ServerConfig[] = [
    {
      id: serverId,
      name: serverId,
      type: 'remote',
      access: 'readwrite',
      category: 'code',
      endpoint: 'https://unused.example.com/mcp',
      lazy: true,
    },
  ];
  return new Aggregator(config, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

async function cast(
  agg: Aggregator,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', args);
  assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

function sortedKeys(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).sort();
}

// Intent: "list neon database projects" → terms: list, neon, database, projects
const INTENT = 'list neon database projects';

// Tool that matches intent (all 4 terms in name+description) → cast:executed / cast:plan
const TOOL_EXEC = {
  name: 'list_neon_database_projects',
  description: 'List neon database projects',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text', text: '{"projects":[]}' }] },
};

// Bare resource: no description, no mimeType.
// Namespaced haystack covers all 4 terms via uri+name:
//   "{id}://neon://projects/database/list [{id}] list neon database projects"
const RESOURCE_BARE = {
  uri: 'neon://projects/database/list',
  name: 'List Neon Database Projects',
};

// Resource with description, no mimeType.
// Namespaced haystack: "{id}://neon://overview [{id}] neon overview list neon database projects catalog"
const RESOURCE_DESC = {
  uri: 'neon://overview',
  name: 'Neon Overview',
  description: 'List neon database projects catalog',
};

// Resource with mimeType, no description.
// Namespaced haystack: "{id}://neon://list/database/projects [{id}] list database projects"
// → neon from uri, list+database+projects from uri and name
const RESOURCE_MIME = {
  uri: 'neon://list/database/projects',
  name: 'List Database Projects',
  mimeType: 'application/json',
};

// Resource with both description and mimeType.
// Namespaced haystack: "{id}://neon://full [{id}] neon db list neon database projects"
const RESOURCE_FULL = {
  uri: 'neon://full',
  name: 'Neon DB',
  description: 'List neon database projects',
  mimeType: 'text/plain',
};

// ── GAP-1: cast:executed — bare resource has exactly {name, score, uri} ──────

test('GAP-1: cast:executed bare resource item has exactly keys {name, score, uri}', async () => {
  const agg = makeAgg('gap-exec-1', [TOOL_EXEC], [RESOURCE_BARE]);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const resources = body['resources'] as unknown[];
    assert.ok(Array.isArray(resources) && resources.length > 0, 'resources must be a non-empty array');
    const target = (resources as Record<string, unknown>[]).find(
      (r) => String(r['uri']).endsWith(RESOURCE_BARE.uri),
    );
    assert.ok(target !== undefined, `resource with uri ending in "${RESOURCE_BARE.uri}" not found`);
    assert.deepEqual(
      sortedKeys(target),
      ['name', 'score', 'uri'],
      `bare resource must have exactly {name, score, uri}, got ${JSON.stringify(sortedKeys(target))}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GAP-2: cast:executed — resource with description has exactly {description, name, score, uri}

test('GAP-2: cast:executed resource with description has exactly keys {description, name, score, uri}', async () => {
  const agg = makeAgg('gap-exec-2', [TOOL_EXEC], [RESOURCE_DESC]);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const resources = body['resources'] as unknown[];
    assert.ok(Array.isArray(resources) && resources.length > 0, 'resources must be a non-empty array');
    const target = (resources as Record<string, unknown>[]).find(
      (r) => String(r['uri']).endsWith(RESOURCE_DESC.uri),
    );
    assert.ok(target !== undefined, `resource with uri ending in "${RESOURCE_DESC.uri}" not found`);
    assert.deepEqual(
      sortedKeys(target),
      ['description', 'name', 'score', 'uri'],
      `resource with description must have exactly {description, name, score, uri}, got ${JSON.stringify(sortedKeys(target))}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GAP-3: cast:executed — resource with mimeType has exactly {mimeType, name, score, uri}

test('GAP-3: cast:executed resource with mimeType has exactly keys {mimeType, name, score, uri}', async () => {
  const agg = makeAgg('gap-exec-3', [TOOL_EXEC], [RESOURCE_MIME]);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const resources = body['resources'] as unknown[];
    assert.ok(Array.isArray(resources) && resources.length > 0, 'resources must be a non-empty array');
    const target = (resources as Record<string, unknown>[]).find(
      (r) => String(r['uri']).endsWith(RESOURCE_MIME.uri),
    );
    assert.ok(target !== undefined, `resource with uri ending in "${RESOURCE_MIME.uri}" not found`);
    assert.deepEqual(
      sortedKeys(target),
      ['mimeType', 'name', 'score', 'uri'],
      `resource with mimeType must have exactly {mimeType, name, score, uri}, got ${JSON.stringify(sortedKeys(target))}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GAP-4: cast:executed — full resource has exactly {description, mimeType, name, score, uri}

test('GAP-4: cast:executed resource with description and mimeType has exactly keys {description, mimeType, name, score, uri}', async () => {
  const agg = makeAgg('gap-exec-4', [TOOL_EXEC], [RESOURCE_FULL]);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const resources = body['resources'] as unknown[];
    assert.ok(Array.isArray(resources) && resources.length > 0, 'resources must be a non-empty array');
    const target = (resources as Record<string, unknown>[]).find(
      (r) => String(r['uri']).endsWith(RESOURCE_FULL.uri),
    );
    assert.ok(target !== undefined, `resource with uri ending in "${RESOURCE_FULL.uri}" not found`);
    assert.deepEqual(
      sortedKeys(target),
      ['description', 'mimeType', 'name', 'score', 'uri'],
      `full resource must have exactly {description, mimeType, name, score, uri}, got ${JSON.stringify(sortedKeys(target))}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GAP-5: cast:plan — full resource has exactly {description, mimeType, name, score, uri}

test('GAP-5: cast:plan resource with description and mimeType has exactly keys {description, mimeType, name, score, uri}', async () => {
  const agg = makeAgg('gap-plan-5', [TOOL_EXEC], [RESOURCE_FULL]);
  try {
    const body = await cast(agg, { intent: INTENT, confirm: true });
    assert.equal(body['cast'], 'plan', `expected cast:plan, got ${body['cast']}`);
    const resources = body['resources'] as unknown[];
    assert.ok(Array.isArray(resources) && resources.length > 0, 'resources must be a non-empty array');
    const target = (resources as Record<string, unknown>[]).find(
      (r) => String(r['uri']).endsWith(RESOURCE_FULL.uri),
    );
    assert.ok(target !== undefined, `resource with uri ending in "${RESOURCE_FULL.uri}" not found`);
    assert.deepEqual(
      sortedKeys(target),
      ['description', 'mimeType', 'name', 'score', 'uri'],
      `plan resource must have exactly {description, mimeType, name, score, uri}, got ${JSON.stringify(sortedKeys(target))}`,
    );
  } finally {
    await agg.shutdown();
  }
});
