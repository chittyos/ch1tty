/**
 * GFP drift guard: freeze cast:executed resolved as a plain string.
 *
 * Background
 * ----------
 * cast:plan and cast:executed differ structurally in the `resolved` field:
 *
 *   cast:plan     → resolved: { tool, server, category, description, score, inputSchema }
 *   cast:executed → resolved: "serverId/toolName"   ← a PLAIN STRING
 *
 * Source: src/core.ts
 *   plan path (confirm=true):
 *     resolved: { tool: best.namespacedName, server: best.serverId, … }
 *   executed path (confirm=false):
 *     resolved: best.namespacedName   ← string, not object
 *
 * Prior GF* tests that touch cast:executed
 * -----------------------------------------
 *   GFA   — intent echo (outer body key)
 *   GFB   — outer content array passthrough (content[0]/content[1] structure)
 *   GFB-b — alternatives score ordinal in executed mode
 *   GFF   — executed alternatives description + winner score ordinal
 *   GFH   — plan winner score (not executed)
 *   GFN   — resolvedBy value type (both plan and executed)
 *
 * None of the above explicitly freeze that executed.resolved is a STRING
 * (not null, not an object, not a number). The plan-vs-executed structural
 * asymmetry is the most likely target for an accidental refactor that
 * "normalises" resolved to always be an object.
 *
 * GFP closes that gap with 5 invariants:
 *
 *   GFP-1  resolved is typeof === 'string' (not an object / null / number)
 *   GFP-2  resolved is non-empty
 *   GFP-3  resolved contains exactly one '/' (namespaced {serverId}/{toolName} format)
 *   GFP-4  resolved is a string while cast:plan resolved is an object
 *          (type-asymmetry cross-mode regression guard)
 *   GFP-5  resolved is stable across two cast:executed calls on the same registry
 *
 * Frozen 2026-10-02.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Fixtures ───────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gfp-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

const SERVER_ID = 'neon';

const TOOL_SQL: Record<string, unknown> = {
  name: 'run_sql',
  description: 'execute a sql query on neon database',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text', text: '{"rows":[]}' }] },
};

const TOOL_SCHEMA: Record<string, unknown> = {
  name: 'describe_table_schema',
  description: 'describe neon database table schema columns',
  inputSchema: { type: 'object', properties: { table: { type: 'string' } } },
  response: { content: [{ type: 'text', text: '{"columns":[]}' }] },
};

const TOOL_CREATE: Record<string, unknown> = {
  name: 'create_postgres_database',
  description: 'create a new neon postgres database instance',
  inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
  response: { content: [{ type: 'text', text: '{"id":"db_1"}' }] },
};

const CFG: ServerConfig = {
  id: SERVER_ID,
  name: 'Neon DB',
  type: 'remote',
  access: 'readwrite',
  category: 'code',
  endpoint: 'https://neon.tech/mcp',
  lazy: true,
};

function makeAgg(suffix: string): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer(SERVER_ID, { tools: [TOOL_SQL, TOOL_SCHEMA, TOOL_CREATE] });
  const path = dlq();
  return new Aggregator([CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

const INTENT = 'run sql query on neon database';

async function castExecutedBody(agg: Aggregator): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT });
  assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
  const item = result.content[0] as { type: string; text: string };
  assert.equal(item.type, 'text', 'content[0].type must be text');
  const body = JSON.parse(item.text) as Record<string, unknown>;
  assert.equal(body['cast'], 'executed', `expected cast:executed, got '${String(body['cast'])}'`);
  return body;
}

async function castPlanBody(agg: Aggregator): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, confirm: true });
  assert.equal(result.isError, undefined, `cast:plan must not error: ${JSON.stringify(result.content)}`);
  const item = result.content[0] as { type: string; text: string };
  const body = JSON.parse(item.text) as Record<string, unknown>;
  assert.equal(body['cast'], 'plan', `expected cast:plan, got '${String(body['cast'])}'`);
  return body;
}

// ── GFP-1: executed.resolved is typeof === 'string' ──────────────────────────

test('GFP-1: cast:executed resolved is typeof string (not an object, null, or number)', async () => {
  const agg = makeAgg('1');
  try {
    const body = await castExecutedBody(agg);
    assert.equal(
      typeof body['resolved'],
      'string',
      `GFP-1: cast:executed resolved must be typeof 'string', got typeof '${typeof body['resolved']}' (value: ${JSON.stringify(body['resolved'])})`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GFP-2: executed.resolved is non-empty ─────────────────────────────────────

test('GFP-2: cast:executed resolved is non-empty', async () => {
  const agg = makeAgg('2');
  try {
    const body = await castExecutedBody(agg);
    const resolved = body['resolved'] as string;
    assert.ok(
      resolved.length > 0,
      'GFP-2: cast:executed resolved must be a non-empty string',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GFP-3: executed.resolved contains exactly one '/' (namespaced format) ────

test('GFP-3: cast:executed resolved contains exactly one "/" (namespaced {serverId}/{toolName} format)', async () => {
  const agg = makeAgg('3');
  try {
    const body = await castExecutedBody(agg);
    const resolved = body['resolved'] as string;
    const slashCount = (resolved.match(/\//g) ?? []).length;
    assert.equal(
      slashCount,
      1,
      `GFP-3: cast:executed resolved must contain exactly one '/' (namespaced serverId/toolName); got ${slashCount} slashes in '${resolved}'`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GFP-4: executed.resolved is string while plan.resolved is an object ───────
//
// Cross-mode type-asymmetry guard: prevents a refactor that "normalises"
// resolved to always be an object from silently passing this test file.

test('GFP-4: cast:executed resolved is a string while cast:plan resolved is an object (type asymmetry invariant)', async () => {
  const agg = makeAgg('4');
  try {
    const executedBody = await castExecutedBody(agg);
    const planBody = await castPlanBody(agg);

    const executedResolved = executedBody['resolved'];
    const planResolved = planBody['resolved'];

    assert.equal(
      typeof executedResolved,
      'string',
      `GFP-4: cast:executed resolved must be typeof 'string', got '${typeof executedResolved}'`,
    );
    assert.equal(
      typeof planResolved,
      'object',
      `GFP-4: cast:plan resolved must be typeof 'object', got '${typeof planResolved}'`,
    );
    assert.ok(
      planResolved !== null && !Array.isArray(planResolved),
      `GFP-4: cast:plan resolved must be a non-null, non-array object`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GFP-5: executed.resolved is stable across repeated calls ─────────────────

test('GFP-5: cast:executed resolved is stable across two calls on the same registry (no drift)', async () => {
  const agg = makeAgg('5');
  try {
    const body1 = await castExecutedBody(agg);
    const body2 = await castExecutedBody(agg);
    assert.equal(
      body1['resolved'],
      body2['resolved'],
      `GFP-5: cast:executed resolved must be stable: first='${String(body1['resolved'])}', second='${String(body2['resolved'])}'`,
    );
  } finally {
    await agg.shutdown();
  }
});
