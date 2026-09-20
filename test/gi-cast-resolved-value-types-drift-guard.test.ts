/**
 * GI drift guard: freeze cast `resolved` sub-object KEY SET and VALUE TYPES
 * in both `cast:plan` (confirm:true) and `cast:resolved` (dryRun:true) modes.
 *
 * Existing tests (JJ, ledger-mcp-focus-scenarios, suggestion-ranking) check
 * `resolved.tool` and `resolved.score` in passing, but no test freezes:
 *
 *   cast:plan (confirm:true) resolved object:
 *   — exact key set: {tool, server, category, description, score, inputSchema}
 *   — tool is a namespaced "serverId/toolName" string (exactly one '/')
 *   — server is a plain serverId (no '/'; differs from tool)
 *   — category is one of the valid ServerCategory enum values
 *   — description is a string
 *   — score is a finite non-negative number
 *   — inputSchema is a non-null object (not array, not primitive)
 *
 *   cast:resolved (dryRun:true) resolved object:
 *   — exact key set: {tool, score} only (no server/category/description/inputSchema)
 *   — tool is namespaced (contains exactly one '/')
 *   — score is a finite non-negative number
 *
 * GI closes those gaps:
 *
 *   GI-1  cast:plan resolved exact key set is {category, description,
 *          inputSchema, score, server, tool} (6 keys, sorted)
 *   GI-2  cast:plan resolved.tool contains exactly one '/' (namespaced)
 *   GI-3  cast:plan resolved.server has no '/' (plain serverId; differs from tool)
 *   GI-4  cast:plan resolved.category is one of the valid ServerCategory values
 *   GI-5  cast:plan resolved.description is a string
 *   GI-6  cast:plan resolved.score is a finite non-negative number
 *   GI-7  cast:plan resolved.inputSchema is a non-null, non-array object
 *   GI-8  cast:resolved (dryRun:true) resolved exact key set is {score, tool} (2 keys)
 *   GI-9  cast:resolved resolved.tool contains exactly one '/'
 *   GI-10 cast:resolved resolved.score is a finite non-negative number
 *
 * Frozen 2026-09-20.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only)
 *   - buildCastExplanation metric freeze: not applicable (resolved sub-object, not explanation)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Valid category enum (mirrors VALID_CATEGORIES in src-stdio/focus.ts) ──────

const VALID_CATEGORIES: readonly string[] = [
  'ecosystem', 'code', 'search', 'reasoning', 'desktop', 'documents', 'communication',
];

// ── Frozen key sets ───────────────────────────────────────────────────────────

/** Exact keys present on resolved when cast mode is 'plan' (confirm:true). */
const PLAN_RESOLVED_KEYS = ['category', 'description', 'inputSchema', 'score', 'server', 'tool'];

/** Exact keys present on resolved when cast mode is 'resolved' (dryRun:true). */
const DRYN_RESOLVED_KEYS = ['score', 'tool'];

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_CONFIGS: ServerConfig[] = [
  {
    id: 'neon',
    name: 'Neon DB',
    type: 'remote',
    access: 'readwrite',
    category: 'code',
    endpoint: 'https://neon.tech/mcp',
    lazy: true,
  },
];

let _seq = 0;
function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: join(tmpdir(), `ch1tty-gi-${Date.now()}-${++_seq}.jsonl`),
  });
}

async function castPlan(agg: Aggregator, intent: string): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent, confirm: true });
  assert.equal(result.isError, undefined, `cast:plan must not return isError for intent "${intent}"`);
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body.cast, 'plan', `expected cast:plan, got cast:${body.cast}`);
  return body;
}

async function castResolved(agg: Aggregator, intent: string): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent, dryRun: true });
  assert.equal(result.isError, undefined, `cast:resolved must not return isError for intent "${intent}"`);
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body.cast, 'resolved', `expected cast:resolved, got cast:${body.cast}`);
  return body;
}

// ── GI-1: cast:plan resolved exact key set ─────────────────────────────────────

test('GI-1: cast:plan resolved sub-object has exactly {category, description, inputSchema, score, server, tool}', async () => {
  const agg = makeAgg();
  try {
    const body = await castPlan(agg, 'list database projects');
    const resolved = body.resolved as Record<string, unknown>;
    assert.ok(resolved !== null && typeof resolved === 'object' && !Array.isArray(resolved),
      'resolved must be a plain object');
    const actual = Object.keys(resolved).sort();
    assert.deepEqual(
      actual,
      PLAN_RESOLVED_KEYS,
      `cast:plan resolved key set must be exactly ${JSON.stringify(PLAN_RESOLVED_KEYS)}, got ${JSON.stringify(actual)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GI-2: cast:plan resolved.tool is namespaced ────────────────────────────────

test('GI-2: cast:plan resolved.tool contains exactly one slash (namespaced "serverId/toolName")', async () => {
  const agg = makeAgg();
  try {
    const body = await castPlan(agg, 'run sql query');
    const resolved = body.resolved as Record<string, unknown>;
    const tool = resolved['tool'];
    assert.equal(typeof tool, 'string', `resolved.tool must be a string, got ${typeof tool}`);
    assert.ok((tool as string).length > 0, 'resolved.tool must be non-empty');
    const slashCount = ((tool as string).match(/\//g) ?? []).length;
    assert.equal(slashCount, 1,
      `resolved.tool must contain exactly one slash, got "${tool}" with ${slashCount} slashes`);
  } finally {
    await agg.shutdown();
  }
});

// ── GI-3: cast:plan resolved.server is a plain serverId ───────────────────────

test('GI-3: cast:plan resolved.server has no slash (plain serverId) and differs from resolved.tool', async () => {
  const agg = makeAgg();
  try {
    const body = await castPlan(agg, 'list database projects');
    const resolved = body.resolved as Record<string, unknown>;
    const server = resolved['server'];
    const tool = resolved['tool'];
    assert.equal(typeof server, 'string', `resolved.server must be a string, got ${typeof server}`);
    assert.ok((server as string).length > 0, 'resolved.server must be non-empty');
    assert.ok(!(server as string).includes('/'),
      `resolved.server must not contain '/' (got "${server}") — it is a plain serverId`);
    assert.notEqual(server, tool,
      `resolved.server must differ from resolved.tool (server="${server}", tool="${tool}")`);
  } finally {
    await agg.shutdown();
  }
});

// ── GI-4: cast:plan resolved.category is a valid ServerCategory ────────────────

test('GI-4: cast:plan resolved.category is one of the valid ServerCategory enum values', async () => {
  const agg = makeAgg();
  try {
    const body = await castPlan(agg, 'list database projects');
    const resolved = body.resolved as Record<string, unknown>;
    const category = resolved['category'];
    assert.equal(typeof category, 'string',
      `resolved.category must be a string, got ${typeof category}`);
    assert.ok(VALID_CATEGORIES.includes(category as string),
      `resolved.category must be a valid ServerCategory, got "${category}". Valid: ${VALID_CATEGORIES.join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GI-5: cast:plan resolved.description is a string ──────────────────────────

test('GI-5: cast:plan resolved.description is a string (can be empty)', async () => {
  const agg = makeAgg();
  try {
    const body = await castPlan(agg, 'describe a table schema');
    const resolved = body.resolved as Record<string, unknown>;
    assert.equal(typeof resolved['description'], 'string',
      `resolved.description must be a string, got ${typeof resolved['description']}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GI-6: cast:plan resolved.score is a finite non-negative number ─────────────

test('GI-6: cast:plan resolved.score is a finite non-negative number', async () => {
  const agg = makeAgg();
  try {
    const body = await castPlan(agg, 'run sql query on database');
    const resolved = body.resolved as Record<string, unknown>;
    const score = resolved['score'];
    assert.equal(typeof score, 'number',
      `resolved.score must be a number, got ${typeof score}`);
    assert.ok(Number.isFinite(score as number),
      `resolved.score must be finite, got ${score}`);
    assert.ok((score as number) >= 0,
      `resolved.score must be >= 0, got ${score}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GI-7: cast:plan resolved.inputSchema is a non-null, non-array object ───────

test('GI-7: cast:plan resolved.inputSchema is a non-null, non-array object', async () => {
  const agg = makeAgg();
  try {
    const body = await castPlan(agg, 'list database projects');
    const resolved = body.resolved as Record<string, unknown>;
    const inputSchema = resolved['inputSchema'];
    assert.equal(typeof inputSchema, 'object',
      `resolved.inputSchema must be an object, got ${typeof inputSchema}`);
    assert.notEqual(inputSchema, null,
      'resolved.inputSchema must not be null');
    assert.ok(!Array.isArray(inputSchema),
      'resolved.inputSchema must not be an array');
  } finally {
    await agg.shutdown();
  }
});

// ── GI-8: cast:resolved (dryRun) resolved exact key set is {score, tool} ───────

test('GI-8: cast:resolved (dryRun:true) resolved sub-object has exactly {score, tool} — no server/category/description/inputSchema', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg, 'list database projects');
    const resolved = body.resolved as Record<string, unknown>;
    assert.ok(resolved !== null && typeof resolved === 'object' && !Array.isArray(resolved),
      'resolved must be a plain object');
    const actual = Object.keys(resolved).sort();
    assert.deepEqual(
      actual,
      DRYN_RESOLVED_KEYS,
      `cast:resolved resolved key set must be exactly ${JSON.stringify(DRYN_RESOLVED_KEYS)}, got ${JSON.stringify(actual)}. ` +
      `cast:resolved must NOT include server/category/description/inputSchema — those are plan-only fields`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GI-9: cast:resolved resolved.tool is namespaced ───────────────────────────

test('GI-9: cast:resolved (dryRun:true) resolved.tool contains exactly one slash (namespaced)', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg, 'run sql query');
    const resolved = body.resolved as Record<string, unknown>;
    const tool = resolved['tool'];
    assert.equal(typeof tool, 'string',
      `resolved.tool must be a string, got ${typeof tool}`);
    assert.ok((tool as string).length > 0, 'resolved.tool must be non-empty');
    const slashCount = ((tool as string).match(/\//g) ?? []).length;
    assert.equal(slashCount, 1,
      `resolved.tool must contain exactly one slash, got "${tool}" with ${slashCount} slashes`);
  } finally {
    await agg.shutdown();
  }
});

// ── GI-10: cast:resolved resolved.score is a finite non-negative number ─────────

test('GI-10: cast:resolved (dryRun:true) resolved.score is a finite non-negative number', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg, 'list database projects');
    const resolved = body.resolved as Record<string, unknown>;
    const score = resolved['score'];
    assert.equal(typeof score, 'number',
      `resolved.score must be a number, got ${typeof score}`);
    assert.ok(Number.isFinite(score as number),
      `resolved.score must be finite, got ${score}`);
    assert.ok((score as number) >= 0,
      `resolved.score must be >= 0, got ${score}`);
  } finally {
    await agg.shutdown();
  }
});
