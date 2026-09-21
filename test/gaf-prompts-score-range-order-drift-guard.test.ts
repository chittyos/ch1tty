/**
 * GAF drift guard: freeze prompts item score range, finitude, and sort order.
 *
 * EO (cast:plan) and EP (cast:executed/discovered) each check:
 *   typeof p['score'] === 'number' && p['score'] >= 0
 * Neither freezes finitude (NaN/Infinity allowed), upper bound (> 1.0 allowed),
 * nor descending sort order across multiple prompts items.
 *
 * Score formula (src-stdio/aggregator.ts ~line 1320):
 *   score = Math.round((matchCount / terms.length) * 100) / 100
 *   where matchCount ≤ terms.length → score ∈ [0, 1.0]
 *   filter: score > 0.1 (items at or below threshold excluded)
 *   sort: descending by score
 *
 * Invariants frozen by GAF:
 *   1. Every prompts item score is finite (no NaN, no ±Infinity).
 *   2. Every prompts item score ≤ 1.0 (matchCount / terms.length ≤ 1).
 *   3. Multiple prompts items are returned in non-increasing score order.
 *   4. No prompts item with score ≤ 0.1 appears in output (filter threshold).
 *   5. Same invariants hold on cast:discovered path.
 *
 * Tests:
 *
 *   GAF-1  cast:executed: scores are finite and ≤ 1.0 for all prompts items.
 *
 *   GAF-2  cast:executed: two prompts at different scores are returned in
 *           non-increasing score order (descending sort preserved).
 *
 *   GAF-3  cast:executed: a prompt with zero keyword overlap (score = 0) is
 *           absent from related.prompts (filter threshold enforced).
 *
 *   GAF-4  cast:discovered: scores are finite, ≤ 1.0, and in non-increasing order.
 *
 *   GAF-5  cast:plan (confirm:true): scores are finite, ≤ 1.0, and in
 *           non-increasing order.
 *
 * Fixtures:
 *
 *   GAF-1/2/3 use a 'gaf-exec' server:
 *     - tool 'list_neon_db_projects': description 'List neon database projects'
 *       → all 4 intent terms → cast:executed
 *     - prompt 'gaf-high': description 'List neon database projects overview'
 *       → 4/4 = 1.0
 *     - prompt 'gaf-mid': description 'Count neon database total entries'
 *       → 'neon', 'database' = 2/4 = 0.5
 *     - prompt 'gaf-zero': description 'Serialize formatted output bytes'
 *       → 0/4 = 0.0 → filtered out
 *
 *   GAF-4 uses a 'gaf-disc' server (cast:discovered):
 *     - tool 'write_file_path': description 'Write content to a local path'
 *       → 0 overlap with 'list neon database projects' → best === undefined
 *     - prompt 'gaf-disc-high': description 'List neon database projects template'
 *       → 4/4 = 1.0
 *     - prompt 'gaf-disc-mid': description 'Browse neon database records'
 *       → 'neon', 'database' = 2/4 = 0.5
 *
 *   GAF-5 uses a 'gaf-plan' server (cast:plan via confirm:true):
 *     - tool 'query_neon_db_projects': description 'Query neon database projects'
 *       → 4/4 → cast:plan (confirm:true)
 *     - prompt 'gaf-plan-high': description 'List neon database projects guide'
 *       → 4/4 = 1.0
 *     - prompt 'gaf-plan-mid': description 'Count neon database totals'
 *       → 'neon', 'database' = 2/4 = 0.5
 *
 * Source: src-stdio/aggregator.ts
 *   prompts scoring:  lines ~1315–1325
 *   related.prompts:  lines ~1398–1405
 *   cast:plan path:   line  ~1617
 *   cast:executed:    line  ~1666
 *   cast:discovered:  line  ~1439
 *
 * Frozen 2026-09-21.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (prompts item values, not explain)
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
  return join(tmpdir(), `ch1tty-gaf-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

function makeAgg(serverId: string, tools: unknown[], prompts: unknown[]): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer(serverId, { tools, prompts, resources: [] });
  const configs: ServerConfig[] = [{
    id: serverId, name: `GAF ${serverId} Service`, type: 'remote',
    access: 'readwrite', category: 'code',
    endpoint: `https://${serverId}.example.com/mcp`, lazy: true,
  }];
  const path = dlq();
  return new Aggregator(configs, {
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

// Intent: "list neon database projects" → terms ["list","neon","database","projects"] (4 terms)
const INTENT = 'list neon database projects';

// ── GAF-1: cast:executed — finitude + upper bound ─────────────────────────────

test('GAF-1: cast:executed prompts scores are finite and ≤ 1.0', async () => {
  const agg = makeAgg('gaf-exec', [
    {
      name: 'list_neon_db_projects',
      description: 'List neon database projects',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: '["p1"]' }] },
    },
  ], [
    {
      name: 'gaf-high',
      description: 'List neon database projects overview',
      arguments: [],
    },
    {
      name: 'gaf-mid',
      description: 'Count neon database total entries',
      arguments: [],
    },
  ]);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const prompts = body['prompts'] as unknown[];
    assert.ok(Array.isArray(prompts) && prompts.length > 0, 'prompts must be a non-empty array');
    for (const item of prompts) {
      const p = item as Record<string, unknown>;
      const score = p['score'] as number;
      assert.ok(Number.isFinite(score), `prompts item score must be finite, got ${score}`);
      assert.ok(score <= 1.0, `prompts item score must be ≤ 1.0, got ${score}`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GAF-2: cast:executed — descending sort order ──────────────────────────────

test('GAF-2: cast:executed prompts items are in non-increasing score order', async () => {
  const agg = makeAgg('gaf-order', [
    {
      name: 'list_neon_db_projects',
      description: 'List neon database projects',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: '["p1"]' }] },
    },
  ], [
    {
      name: 'gaf-high',
      description: 'List neon database projects overview',
      arguments: [],
    },
    {
      name: 'gaf-mid',
      description: 'Count neon database total entries',
      arguments: [],
    },
  ]);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const prompts = body['prompts'] as unknown[];
    assert.ok(Array.isArray(prompts) && prompts.length >= 2,
      `need ≥ 2 prompts to test ordering, got ${prompts.length}`);
    for (let i = 1; i < prompts.length; i++) {
      const prev = (prompts[i - 1] as Record<string, unknown>)['score'] as number;
      const curr = (prompts[i] as Record<string, unknown>)['score'] as number;
      assert.ok(
        prev >= curr,
        `prompts must be in non-increasing score order: index ${i - 1} score ${prev} < index ${i} score ${curr}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GAF-3: cast:executed — filter threshold (score > 0.1) ────────────────────

test('GAF-3: cast:executed prompts items all have score > 0.1 (filter preserved)', async () => {
  const agg = makeAgg('gaf-filter', [
    {
      name: 'list_neon_db_projects',
      description: 'List neon database projects',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: '["p1"]' }] },
    },
  ], [
    // score 1.0 — should appear
    { name: 'gaf-pass', description: 'List neon database projects overview', arguments: [] },
    // score 0 — should be filtered out (no term overlap)
    { name: 'gaf-zero', description: 'Serialize formatted output bytes', arguments: [] },
  ]);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const prompts = body['prompts'] as unknown[];
    assert.ok(Array.isArray(prompts) && prompts.length > 0, 'prompts must be a non-empty array');
    for (const item of prompts) {
      const p = item as Record<string, unknown>;
      const score = p['score'] as number;
      assert.ok(score > 0.1, `prompts item score must be > 0.1 (filter threshold), got ${score} for "${p['name']}"`);
    }
    const names = prompts.map((p) => (p as Record<string, unknown>)['name']);
    assert.ok(!names.includes('gaf-zero'), 'zero-score prompt must be filtered out');
  } finally {
    await agg.shutdown();
  }
});

// ── GAF-4: cast:discovered — finitude, upper bound, ordering ─────────────────

test('GAF-4: cast:discovered prompts scores are finite, ≤ 1.0, and non-increasing', async () => {
  // Tool has no keyword overlap → best === undefined → cast:discovered
  const agg = makeAgg('gaf-disc', [
    {
      name: 'write_file_path',
      description: 'Write content to a local path',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      response: { content: [{ type: 'text', text: '{"ok":true}' }] },
    },
  ], [
    { name: 'gaf-disc-high', description: 'List neon database projects template', arguments: [] },
    { name: 'gaf-disc-mid', description: 'Browse neon database records', arguments: [] },
  ]);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'discovered', `expected cast:discovered, got ${body['cast']}`);
    const prompts = body['prompts'] as unknown[];
    assert.ok(Array.isArray(prompts) && prompts.length > 0, 'prompts must be a non-empty array');
    for (const item of prompts) {
      const p = item as Record<string, unknown>;
      const score = p['score'] as number;
      assert.ok(Number.isFinite(score), `discovered prompts score must be finite, got ${score}`);
      assert.ok(score <= 1.0, `discovered prompts score must be ≤ 1.0, got ${score}`);
      assert.ok(score > 0.1, `discovered prompts score must be > 0.1, got ${score}`);
    }
    for (let i = 1; i < prompts.length; i++) {
      const prev = (prompts[i - 1] as Record<string, unknown>)['score'] as number;
      const curr = (prompts[i] as Record<string, unknown>)['score'] as number;
      assert.ok(prev >= curr, `discovered prompts must be non-increasing: index ${i - 1} score ${prev} < index ${i} score ${curr}`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GAF-5: cast:plan — finitude, upper bound, ordering ───────────────────────

test('GAF-5: cast:plan prompts scores are finite, ≤ 1.0, and non-increasing', async () => {
  const agg = makeAgg('gaf-plan', [
    {
      name: 'query_neon_db_projects',
      description: 'Query neon database projects',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: '["p1"]' }] },
    },
  ], [
    { name: 'gaf-plan-high', description: 'List neon database projects guide', arguments: [] },
    { name: 'gaf-plan-mid', description: 'Count neon database totals', arguments: [] },
  ]);
  try {
    const body = await cast(agg, { intent: INTENT, confirm: true });
    assert.equal(body['cast'], 'plan', `expected cast:plan, got ${body['cast']}`);
    const prompts = body['prompts'] as unknown[];
    assert.ok(Array.isArray(prompts) && prompts.length > 0, 'plan prompts must be a non-empty array');
    for (const item of prompts) {
      const p = item as Record<string, unknown>;
      const score = p['score'] as number;
      assert.ok(Number.isFinite(score), `plan prompts score must be finite, got ${score}`);
      assert.ok(score <= 1.0, `plan prompts score must be ≤ 1.0, got ${score}`);
      assert.ok(score > 0.1, `plan prompts score must be > 0.1, got ${score}`);
    }
    for (let i = 1; i < prompts.length; i++) {
      const prev = (prompts[i - 1] as Record<string, unknown>)['score'] as number;
      const curr = (prompts[i] as Record<string, unknown>)['score'] as number;
      assert.ok(prev >= curr, `plan prompts must be non-increasing: index ${i - 1} score ${prev} < index ${i} score ${curr}`);
    }
  } finally {
    await agg.shutdown();
  }
});
