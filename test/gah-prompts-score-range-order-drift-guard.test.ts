/**
 * GAH drift guard: freeze prompts item score range, finitude, and sort order.
 *
 * EO (cast:plan) and EP (cast:executed/discovered) each check:
 *   typeof p['score'] === 'number' && p['score'] >= 0
 * Neither freezes finitude (NaN/Infinity pass typeof; Infinity >= 0 is true),
 * upper bound (> 1.0 allowed), nor descending sort order across multiple items.
 *
 * Score formula (src-stdio/aggregator.ts ~lines 1317–1325):
 *   haystack = `${p.name} ${p.description || ''}`.toLowerCase()
 *   score = Math.round((matchCount / terms.length) * 100) / 100
 *   where matchCount ≤ terms.length → score ∈ [0, 1.0]
 *   filter: score > 0.1 (items at or below threshold excluded)
 *   sort: descending by score
 *
 * Invariants frozen by GAH:
 *   1. Every prompts item score is finite (no NaN, no ±Infinity).
 *   2. Every prompts item score ≤ 1.0 (matchCount / terms.length ≤ 1).
 *   3. Multiple prompts items are returned in non-increasing score order.
 *   4. No prompts item with score ≤ 0.1 appears in output (filter threshold).
 *   5. Same invariants hold on cast:discovered and cast:plan paths.
 *
 * Tests:
 *   GAH-1  cast:executed: scores are finite and ≤ 1.0 for all prompts items.
 *   GAH-2  cast:executed: two prompts at different scores are in non-increasing order.
 *   GAH-3  cast:executed: a prompt with zero keyword overlap is absent (filter preserved).
 *   GAH-4  cast:discovered: scores are finite, ≤ 1.0, and non-increasing.
 *   GAH-5  cast:plan (confirm:true): scores are finite, ≤ 1.0, and non-increasing.
 *
 * Fixtures:
 *   GAH-1/2/3 use 'gah-exec'/'gah-order'/'gah-filter' servers:
 *     - tool 'list_cosmos_blockchain_validators': 'List cosmos blockchain validators'
 *       → all 4 intent terms → cast:executed
 *     - prompt 'cosmos_validator_docs': 'Browse cosmos blockchain validators list'
 *       → name+desc haystack: list ✓, cosmos ✓, blockchain ✓, validators ✓ → 4/4 = 1.0
 *     - prompt 'cosmos_status': 'Blockchain connection statistics'
 *       → 'cosmos' in name, 'blockchain' in desc → 2/4 = 0.5
 *     - prompt 'file_writer' (GAH-3 only): 'Save output to disk'
 *       → no overlap → 0/4 = 0.0 → filtered out
 *
 *   GAH-4 uses 'gah-disc' server (cast:discovered):
 *     - tool 'write_file_path': 'Write content to a local path' → 0 overlap → cast:discovered
 *     - prompt 'cosmos_validator_browser': 'List cosmos blockchain validators catalog'
 *       → 4/4 = 1.0
 *     - prompt 'cosmos_overview': 'Cosmos blockchain summary' → cosmos+blockchain = 2/4 = 0.5
 *
 *   GAH-5 uses 'gah-plan' server (cast:plan via confirm:true):
 *     - tool 'list_cosmos_blockchain_validators': 'List cosmos blockchain validators' → 4/4
 *     - prompt 'cosmos_validator_guide': 'Guide to cosmos blockchain validators listing'
 *       → 4/4 = 1.0
 *     - prompt 'cosmos_count': 'Count cosmos blockchain totals' → cosmos+blockchain = 2/4 = 0.5
 *
 * Source: src-stdio/aggregator.ts
 *   prompts scoring: lines ~1317–1325
 *   related.prompts: lines ~1399–1407
 *   cast:plan path:   line  ~1617
 *   cast:executed:    line  ~1662
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
  return join(tmpdir(), `ch1tty-gah-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

function makeAgg(serverId: string, tools: unknown[], prompts: unknown[]): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer(serverId, { tools, prompts, resources: [] });
  const path = dlq();
  const config: ServerConfig[] = [
    { id: serverId, name: serverId, type: 'remote', access: 'readwrite', category: 'code',
      endpoint: 'https://unused.example.com/mcp', lazy: true },
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

// Intent: "list cosmos blockchain validators" → terms ['list','cosmos','blockchain','validators']
const INTENT = 'list cosmos blockchain validators';

// ── GAH-1: cast:executed — finitude + upper bound ─────────────────────────────

test('GAH-1: cast:executed prompts scores are finite and ≤ 1.0', async () => {
  const agg = makeAgg('gah-exec', [
    {
      name: 'list_cosmos_blockchain_validators',
      description: 'List cosmos blockchain validators',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: '["v1"]' }] },
    },
  ], [
    {
      name: 'cosmos_validator_docs',
      description: 'Browse cosmos blockchain validators list',
    },
    {
      name: 'cosmos_status',
      description: 'Blockchain connection statistics',
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

// ── GAH-2: cast:executed — descending sort order ──────────────────────────────

test('GAH-2: cast:executed prompts items are in non-increasing score order', async () => {
  const agg = makeAgg('gah-order', [
    {
      name: 'list_cosmos_blockchain_validators',
      description: 'List cosmos blockchain validators',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: '["v1"]' }] },
    },
  ], [
    {
      name: 'cosmos_validator_docs',
      description: 'Browse cosmos blockchain validators list',
    },
    {
      name: 'cosmos_status',
      description: 'Blockchain connection statistics',
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

// ── GAH-3: cast:executed — filter threshold (score > 0.1) ────────────────────

test('GAH-3: cast:executed prompts items all have score > 0.1 (filter preserved)', async () => {
  const agg = makeAgg('gah-filter', [
    {
      name: 'list_cosmos_blockchain_validators',
      description: 'List cosmos blockchain validators',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: '["v1"]' }] },
    },
  ], [
    // score 1.0 — should appear (all 4 terms in haystack)
    {
      name: 'cosmos_validator_docs',
      description: 'Browse cosmos blockchain validators list',
    },
    // score 0.0 — should be filtered out (no term overlap)
    {
      name: 'file_writer',
      description: 'Save output to disk',
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
      assert.ok(score > 0.1,
        `prompts item score must be > 0.1 (filter threshold), got ${score} for name "${p['name']}"`);
    }
    const names = prompts.map((p) => (p as Record<string, unknown>)['name']);
    assert.ok(!names.includes('file_writer'), 'zero-score prompt must be filtered out');
  } finally {
    await agg.shutdown();
  }
});

// ── GAH-4: cast:discovered — finitude, upper bound, ordering ──────────────────

test('GAH-4: cast:discovered prompts scores are finite, ≤ 1.0, and non-increasing', async () => {
  // Tool has no keyword overlap → best === undefined → cast:discovered (prompts score > 0.1)
  const agg = makeAgg('gah-disc', [
    {
      name: 'write_file_path',
      description: 'Write content to a local path',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      response: { content: [{ type: 'text', text: '{"ok":true}' }] },
    },
  ], [
    {
      name: 'cosmos_validator_browser',
      description: 'List cosmos blockchain validators catalog',
    },
    {
      name: 'cosmos_overview',
      description: 'Cosmos blockchain summary',
    },
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
      assert.ok(prev >= curr,
        `discovered prompts must be non-increasing: index ${i - 1} score ${prev} < index ${i} score ${curr}`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GAH-5: cast:plan — finitude, upper bound, ordering ────────────────────────

test('GAH-5: cast:plan prompts scores are finite, ≤ 1.0, and non-increasing', async () => {
  const agg = makeAgg('gah-plan', [
    {
      name: 'list_cosmos_blockchain_validators',
      description: 'List cosmos blockchain validators',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: '["v1"]' }] },
    },
  ], [
    {
      name: 'cosmos_validator_guide',
      description: 'Guide to cosmos blockchain validators listing',
    },
    {
      name: 'cosmos_count',
      description: 'Count cosmos blockchain totals',
    },
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
      assert.ok(prev >= curr,
        `plan prompts must be non-increasing: index ${i - 1} score ${prev} < index ${i} score ${curr}`);
    }
  } finally {
    await agg.shutdown();
  }
});
