/**
 * GAG drift guard: freeze resources item score range, finitude, and sort order.
 *
 * EO (cast:plan) and EP (cast:executed/discovered) each check:
 *   typeof r['score'] === 'number' && r['score'] >= 0
 * Neither freezes finitude (NaN/Infinity allowed), upper bound (> 1.0 allowed),
 * nor descending sort order across multiple resources items.
 *
 * Score formula (src-stdio/aggregator.ts ~line 1328):
 *   haystack = `${r.uri} ${r.name} ${r.description || ''}`.toLowerCase()
 *   score = Math.round((matchCount / terms.length) * 100) / 100
 *   where matchCount ≤ terms.length → score ∈ [0, 1.0]
 *   filter: score > 0.1 (items at or below threshold excluded)
 *   sort: descending by score
 *
 * Invariants frozen by GAG:
 *   1. Every resources item score is finite (no NaN, no ±Infinity).
 *   2. Every resources item score ≤ 1.0 (matchCount / terms.length ≤ 1).
 *   3. Multiple resources items are returned in non-increasing score order.
 *   4. No resources item with score ≤ 0.1 appears in output (filter threshold).
 *   5. Same invariants hold on cast:discovered and cast:plan paths.
 *
 * Tests:
 *
 *   GAG-1  cast:executed: scores are finite and ≤ 1.0 for all resources items.
 *
 *   GAG-2  cast:executed: two resources at different scores are returned in
 *           non-increasing score order (descending sort preserved).
 *
 *   GAG-3  cast:executed: a resource with zero keyword overlap (score = 0) is
 *           absent from related.resources (filter threshold enforced).
 *
 *   GAG-4  cast:discovered: scores are finite, ≤ 1.0, and in non-increasing order.
 *
 *   GAG-5  cast:plan (confirm:true): scores are finite, ≤ 1.0, and in
 *           non-increasing order.
 *
 * Fixtures:
 *
 *   GAG-1/2/3 use a 'gag-exec' server:
 *     - tool 'list_neon_db_projects': description 'List neon database projects'
 *       → all 4 intent terms → cast:executed
 *     - resource 'gag-high': uri 'neon://projects/list', name 'Neon DB Projects',
 *       description 'List neon database projects overview'
 *       → haystack contains list, neon, database, projects = 4/4 = 1.0
 *     - resource 'gag-mid': uri 'neon://status', name 'Neon Status',
 *       description 'Database query statistics'
 *       → haystack contains neon, database = 2/4 = 0.5
 *     - resource 'gag-zero': uri 'fs://config', name 'File Configuration',
 *       description 'Serialize formatted output bytes'
 *       → no overlap = 0/4 = 0.0 → filtered out
 *
 *   GAG-4 uses a 'gag-disc' server (cast:discovered):
 *     - tool 'write_file_path': description 'Write content to a local path'
 *       → 0 overlap with intent → best === undefined → cast:discovered
 *     - resource 'gag-disc-high': uri 'neon://projects/list',
 *       description 'List neon database projects template' → 4/4 = 1.0
 *     - resource 'gag-disc-mid': uri 'neon://overview',
 *       description 'Browse neon database records' → neon, database = 2/4 = 0.5
 *
 *   GAG-5 uses a 'gag-plan' server (cast:plan via confirm:true):
 *     - tool 'query_neon_db_projects': description 'Query neon database projects'
 *       → 4/4 → cast:plan (confirm:true)
 *     - resource 'gag-plan-high': uri 'neon://projects/list',
 *       description 'List neon database projects guide' → 4/4 = 1.0
 *     - resource 'gag-plan-mid': uri 'neon://status',
 *       description 'Count neon database totals' → neon, database = 2/4 = 0.5
 *
 * Source: src-stdio/aggregator.ts
 *   resources scoring: lines ~1328–1337
 *   related.resources: lines ~1406–1414
 *   cast:plan path:    line  ~1617
 *   cast:executed:     line  ~1666
 *   cast:discovered:   line  ~1439
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
  return join(tmpdir(), `ch1tty-gag-${Date.now()}-${++dlqSeq}.jsonl`);
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

// ── GAG-1: cast:executed — finitude + upper bound ─────────────────────────────

test('GAG-1: cast:executed resources scores are finite and ≤ 1.0', async () => {
  const agg = makeAgg('gag-exec', [
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
    },
    {
      uri: 'neon://status',
      name: 'Neon Status',
      description: 'Database query statistics',
    },
  ]);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const resources = body['resources'] as unknown[];
    assert.ok(Array.isArray(resources) && resources.length > 0, 'resources must be a non-empty array');
    for (const item of resources) {
      const r = item as Record<string, unknown>;
      const score = r['score'] as number;
      assert.ok(Number.isFinite(score), `resources item score must be finite, got ${score}`);
      assert.ok(score <= 1.0, `resources item score must be ≤ 1.0, got ${score}`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GAG-2: cast:executed — descending sort order ──────────────────────────────

test('GAG-2: cast:executed resources items are in non-increasing score order', async () => {
  const agg = makeAgg('gag-order', [
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
    },
    {
      uri: 'neon://status',
      name: 'Neon Status',
      description: 'Database query statistics',
    },
  ]);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const resources = body['resources'] as unknown[];
    assert.ok(Array.isArray(resources) && resources.length >= 2,
      `need ≥ 2 resources to test ordering, got ${resources.length}`);
    for (let i = 1; i < resources.length; i++) {
      const prev = (resources[i - 1] as Record<string, unknown>)['score'] as number;
      const curr = (resources[i] as Record<string, unknown>)['score'] as number;
      assert.ok(
        prev >= curr,
        `resources must be in non-increasing score order: index ${i - 1} score ${prev} < index ${i} score ${curr}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GAG-3: cast:executed — filter threshold (score > 0.1) ────────────────────

test('GAG-3: cast:executed resources items all have score > 0.1 (filter preserved)', async () => {
  const agg = makeAgg('gag-filter', [
    {
      name: 'list_neon_db_projects',
      description: 'List neon database projects',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: '["p1"]' }] },
    },
  ], [
    // score 1.0 — should appear (all 4 terms in haystack)
    {
      uri: 'neon://projects/list',
      name: 'Neon DB Projects',
      description: 'List neon database projects overview',
    },
    // score 0.0 — should be filtered out (no term overlap)
    {
      uri: 'fs://config',
      name: 'File Configuration',
      description: 'Serialize formatted output bytes',
    },
  ]);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const resources = body['resources'] as unknown[];
    assert.ok(Array.isArray(resources) && resources.length > 0, 'resources must be a non-empty array');
    for (const item of resources) {
      const r = item as Record<string, unknown>;
      const score = r['score'] as number;
      assert.ok(score > 0.1,
        `resources item score must be > 0.1 (filter threshold), got ${score} for uri "${r['uri']}"`);
    }
    const uris = resources.map((r) => (r as Record<string, unknown>)['uri']);
    assert.ok(!uris.includes('fs://config'), 'zero-score resource must be filtered out');
  } finally {
    await agg.shutdown();
  }
});

// ── GAG-4: cast:discovered — finitude, upper bound, ordering ──────────────────

test('GAG-4: cast:discovered resources scores are finite, ≤ 1.0, and non-increasing', async () => {
  // Tool has no keyword overlap → best === undefined → cast:discovered
  const agg = makeAgg('gag-disc', [
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
      const score = r['score'] as number;
      assert.ok(Number.isFinite(score), `discovered resources score must be finite, got ${score}`);
      assert.ok(score <= 1.0, `discovered resources score must be ≤ 1.0, got ${score}`);
      assert.ok(score > 0.1, `discovered resources score must be > 0.1, got ${score}`);
    }
    for (let i = 1; i < resources.length; i++) {
      const prev = (resources[i - 1] as Record<string, unknown>)['score'] as number;
      const curr = (resources[i] as Record<string, unknown>)['score'] as number;
      assert.ok(prev >= curr,
        `discovered resources must be non-increasing: index ${i - 1} score ${prev} < index ${i} score ${curr}`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GAG-5: cast:plan — finitude, upper bound, ordering ────────────────────────

test('GAG-5: cast:plan resources scores are finite, ≤ 1.0, and non-increasing', async () => {
  const agg = makeAgg('gag-plan', [
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
      const score = r['score'] as number;
      assert.ok(Number.isFinite(score), `plan resources score must be finite, got ${score}`);
      assert.ok(score <= 1.0, `plan resources score must be ≤ 1.0, got ${score}`);
      assert.ok(score > 0.1, `plan resources score must be > 0.1, got ${score}`);
    }
    for (let i = 1; i < resources.length; i++) {
      const prev = (resources[i - 1] as Record<string, unknown>)['score'] as number;
      const curr = (resources[i] as Record<string, unknown>)['score'] as number;
      assert.ok(prev >= curr,
        `plan resources must be non-increasing: index ${i - 1} score ${prev} < index ${i} score ${curr}`);
    }
  } finally {
    await agg.shutdown();
  }
});
