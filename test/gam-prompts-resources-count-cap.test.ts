/**
 * GAM drift guard: freeze the count cap on resources and prompts items.
 *
 * The aggregator caps scored results at 5 via `.slice(0, 5)` for both arrays
 * (src-stdio/aggregator.ts lines ~1325, ~1337):
 *
 *   const scoredPrompts = allPrompts
 *     .map(...)  .filter(...)  .sort(...)
 *     .slice(0, 5);                          // ← GAM freezes this cap
 *
 *   const scoredResources = allResources
 *     .map(...)  .filter(...)  .sort(...)
 *     .slice(0, 5);                          // ← GAM freezes this cap
 *
 * These caps protect clients from being flooded when many backends register
 * large resource/prompt catalogs. No prior G-series test exercises > 5 matching
 * items on either surface.
 *
 * Invariants frozen by GAM:
 *   1. cast:executed  — at most 5 resources items returned when 8 match.
 *   2. cast:executed  — at most 5 prompts items returned when 8 match.
 *   3. cast:discovered — at most 5 resources items returned when 8 match.
 *   4. cast:discovered — at most 5 prompts items returned when 8 match.
 *   5. cast:plan (confirm:true) — at most 5 resources AND at most 5 prompts
 *      when 8 of each match.
 *
 * Fixtures:
 *
 *   Each test provides 8 resources (or prompts) whose descriptions contain all
 *   4 intent terms ("list neon database projects") → each scores 1.0, all pass
 *   the filter threshold > 0.1, all survive the sort. The count cap is the only
 *   thing limiting the output to ≤ 5.
 *
 *   GAM-1 / GAM-3 / GAM-5 resources: server 'gam-rN', 8 resources per server.
 *   GAM-2 / GAM-4 / GAM-5 prompts:   server 'gam-pN', 8 prompts per server.
 *
 * Source refs:
 *   scoredPrompts slice:   src-stdio/aggregator.ts ~line 1325
 *   scoredResources slice: src-stdio/aggregator.ts ~line 1337
 *   related.resources:     src-stdio/aggregator.ts ~lines 1406–1414
 *   related.prompts:       src-stdio/aggregator.ts ~lines 1398–1404
 *
 * Frozen 2026-09-21.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (resources/prompts counts)
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
  return join(tmpdir(), `ch1tty-gam-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

function makeAgg(
  serverId: string,
  tools: unknown[],
  resources: unknown[],
  prompts: unknown[],
): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer(serverId, { tools, prompts, resources });
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

async function cast(agg: Aggregator, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', args);
  assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

// Intent: "list neon database projects" → terms ['list','neon','database','projects'] (4)
const INTENT = 'list neon database projects';

// 8 resources that all score 1.0: each description contains all 4 intent terms.
function makeResources(count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    uri: `neon://projects/${i + 1}`,
    name: `Neon DB Projects ${String.fromCharCode(65 + i)}`,
    description: `List neon database projects item ${i + 1}`,
  }));
}

// 8 prompts that all score 1.0: each description contains all 4 intent terms.
function makePrompts(count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `list_neon_db_projects_${i + 1}`,
    description: `List neon database projects variant ${i + 1}`,
  }));
}

// An executable tool for cast:executed / cast:plan paths.
const EXEC_TOOL = {
  name: 'list_neon_db_projects',
  description: 'List neon database projects',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text', text: '["p1"]' }] },
};

// A non-matching tool for cast:discovered paths.
const DISC_TOOL = {
  name: 'write_local_file',
  description: 'Write content to a local filesystem path',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
  response: { content: [{ type: 'text', text: '{"ok":true}' }] },
};

// ── GAM-1: cast:executed — resources count cap ────────────────────────────────

test('GAM-1: cast:executed resources items are capped at 5 even when 8 match', async () => {
  const agg = makeAgg('gam-r1', [EXEC_TOOL], makeResources(8), []);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const resources = body['resources'] as unknown[];
    assert.ok(Array.isArray(resources), 'resources must be an array');
    assert.ok(resources.length > 0, 'resources must be non-empty (8 items match)');
    assert.ok(
      resources.length <= 5,
      `resources count must be ≤ 5 (slice cap), got ${resources.length}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GAM-2: cast:executed — prompts count cap ──────────────────────────────────

test('GAM-2: cast:executed prompts items are capped at 5 even when 8 match', async () => {
  const agg = makeAgg('gam-p2', [EXEC_TOOL], [], makePrompts(8));
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const prompts = body['prompts'] as unknown[];
    assert.ok(Array.isArray(prompts), 'prompts must be an array');
    assert.ok(prompts.length > 0, 'prompts must be non-empty (8 items match)');
    assert.ok(
      prompts.length <= 5,
      `prompts count must be ≤ 5 (slice cap), got ${prompts.length}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GAM-3: cast:discovered — resources count cap ──────────────────────────────

test('GAM-3: cast:discovered resources items are capped at 5 even when 8 match', async () => {
  // DISC_TOOL has no overlap with INTENT → best === undefined → cast:discovered
  const agg = makeAgg('gam-r3', [DISC_TOOL], makeResources(8), []);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'discovered', `expected cast:discovered, got ${body['cast']}`);
    const resources = body['resources'] as unknown[];
    assert.ok(Array.isArray(resources), 'resources must be an array');
    assert.ok(resources.length > 0, 'resources must be non-empty (8 items match)');
    assert.ok(
      resources.length <= 5,
      `discovered resources count must be ≤ 5 (slice cap), got ${resources.length}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GAM-4: cast:discovered — prompts count cap ────────────────────────────────

test('GAM-4: cast:discovered prompts items are capped at 5 even when 8 match', async () => {
  // DISC_TOOL has no overlap with INTENT → best === undefined → cast:discovered
  const agg = makeAgg('gam-p4', [DISC_TOOL], [], makePrompts(8));
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'discovered', `expected cast:discovered, got ${body['cast']}`);
    const prompts = body['prompts'] as unknown[];
    assert.ok(Array.isArray(prompts), 'prompts must be an array');
    assert.ok(prompts.length > 0, 'prompts must be non-empty (8 items match)');
    assert.ok(
      prompts.length <= 5,
      `discovered prompts count must be ≤ 5 (slice cap), got ${prompts.length}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GAM-5: cast:plan — resources and prompts count caps ───────────────────────

test('GAM-5: cast:plan resources and prompts items are each capped at 5 when 8 match', async () => {
  const agg = makeAgg('gam-p5', [EXEC_TOOL], makeResources(8), makePrompts(8));
  try {
    const body = await cast(agg, { intent: INTENT, confirm: true });
    assert.equal(body['cast'], 'plan', `expected cast:plan, got ${body['cast']}`);

    const resources = body['resources'] as unknown[];
    assert.ok(Array.isArray(resources), 'plan resources must be an array');
    assert.ok(resources.length > 0, 'plan resources must be non-empty');
    assert.ok(
      resources.length <= 5,
      `plan resources count must be ≤ 5 (slice cap), got ${resources.length}`,
    );

    const prompts = body['prompts'] as unknown[];
    assert.ok(Array.isArray(prompts), 'plan prompts must be an array');
    assert.ok(prompts.length > 0, 'plan prompts must be non-empty');
    assert.ok(
      prompts.length <= 5,
      `plan prompts count must be ≤ 5 (slice cap), got ${prompts.length}`,
    );
  } finally {
    await agg.shutdown();
  }
});
