/**
 * GFM drift guard: freeze cast:plan resolved.inputSchema invariants.
 *
 * The resolved object on a cast:plan response includes:
 *   { tool, server, category, description, score, inputSchema }
 *
 * Prior GF* tests frozen:
 *   GFH — resolved.score ordinal (4 invariants)
 *   GFI — resolved.description (5 invariants, PR #1697)
 *   GFJ — resolved.server (5 invariants, PR #1698)
 *   GFK — resolved.category (5 invariants, merged)
 *   GFL — resolved.tool (5 invariants, PR #1700)
 *
 * GFM closes the last resolved-object gap: resolved.inputSchema had no
 * frozen invariants beyond key-presence guards in earlier workstreams.
 *
 * Source: src/aggregator.ts line ~960
 *   cast:plan response:
 *     resolved: { ..., inputSchema: best.inputSchema }
 *   inputSchema comes directly from the AggregatedTool registry entry.
 *
 * Fixture: same 3-tool / "list stripe payments" setup as GFK.
 * Winner: list_stripe_payments (highest score for intent "list stripe payments").
 * Fixture inputSchema: { type: 'object', properties: {} }
 *
 * Frozen 2026-10-01.
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
import { FixtureBackend } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gfm-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

function makeAgg(serverId: string, tools: unknown[]): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer(serverId, { tools, prompts: [], resources: [] });
  const path = dlq();
  const config: ServerConfig[] = [
    {
      id: serverId,
      name: serverId,
      type: 'remote',
      access: 'readwrite',
      category: 'ecosystem',
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

async function castPlan(agg: Aggregator): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, confirm: true });
  assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body['cast'], 'plan', `expected cast:plan, got ${String(body['cast'])}`);
  return body;
}

const INTENT = 'list stripe payments';

const TOOL_LIST = {
  name: 'list_stripe_payments',
  description: 'List recent stripe payment intents',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text', text: '{"data":[]}' }] },
};

const TOOL_BALANCE = {
  name: 'get_stripe_balance',
  description: 'Get stripe account balance for billing and payments',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text', text: '{"available":[]}' }] },
};

const TOOL_CREATE = {
  name: 'create_stripe_payment',
  description: 'Create a new stripe payment intent or charge',
  inputSchema: {
    type: 'object',
    properties: { amount: { type: 'number' }, currency: { type: 'string' } },
  },
  response: { content: [{ type: 'text', text: '{"id":"pi_new"}' }] },
};

const MULTI_TOOLS = [TOOL_LIST, TOOL_BALANCE, TOOL_CREATE];

// ── GFM-1: inputSchema is a non-null object ───────────────────────────────────

test('GFM-1: cast:plan resolved.inputSchema is a non-null object (not undefined/string/array)', async () => {
  const agg = makeAgg('gfm-1', MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    const resolved = body['resolved'] as Record<string, unknown>;
    const schema = resolved['inputSchema'];
    assert.equal(typeof schema, 'object', `cast:plan resolved.inputSchema must be an object, got ${typeof schema}`);
    assert.notEqual(schema, null, 'cast:plan resolved.inputSchema must not be null');
    assert.ok(!Array.isArray(schema), 'cast:plan resolved.inputSchema must not be an array');
  } finally { await agg.shutdown(); }
});

// ── GFM-2: inputSchema has a 'type' key ───────────────────────────────────────

test('GFM-2: cast:plan resolved.inputSchema has a "type" key', async () => {
  const agg = makeAgg('gfm-2', MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    const resolved = body['resolved'] as Record<string, unknown>;
    const schema = resolved['inputSchema'] as Record<string, unknown>;
    assert.ok(
      Object.prototype.hasOwnProperty.call(schema, 'type'),
      'cast:plan resolved.inputSchema must have a "type" key',
    );
  } finally { await agg.shutdown(); }
});

// ── GFM-3: inputSchema.type is a non-empty string ────────────────────────────

test('GFM-3: cast:plan resolved.inputSchema.type is a non-empty string', async () => {
  const agg = makeAgg('gfm-3', MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    const resolved = body['resolved'] as Record<string, unknown>;
    const schema = resolved['inputSchema'] as Record<string, unknown>;
    assert.equal(
      typeof schema['type'],
      'string',
      `cast:plan resolved.inputSchema.type must be a string, got ${typeof schema['type']}`,
    );
    assert.ok(
      (schema['type'] as string).length > 0,
      'cast:plan resolved.inputSchema.type must be non-empty',
    );
  } finally { await agg.shutdown(); }
});

// ── GFM-4: fixture inputSchema.type round-trips unchanged ────────────────────

test('GFM-4: cast:plan resolved.inputSchema.type round-trips fixture value "object" unchanged', async () => {
  const agg = makeAgg('gfm-4', MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    const resolved = body['resolved'] as Record<string, unknown>;
    const schema = resolved['inputSchema'] as Record<string, unknown>;
    assert.equal(
      schema['type'],
      'object',
      `cast:plan resolved.inputSchema.type must equal "object" (fixture value), got '${String(schema['type'])}'`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFM-5: inputSchema is stable across repeated cast:plan calls ──────────────

test('GFM-5: cast:plan resolved.inputSchema is stable across repeated calls (no drift)', async () => {
  const agg = makeAgg('gfm-5', MULTI_TOOLS);
  try {
    const body1 = await castPlan(agg);
    const body2 = await castPlan(agg);
    const schema1 = (body1['resolved'] as Record<string, unknown>)['inputSchema'];
    const schema2 = (body2['resolved'] as Record<string, unknown>)['inputSchema'];
    assert.deepEqual(
      schema1,
      schema2,
      `cast:plan resolved.inputSchema must be stable across calls: first=${JSON.stringify(schema1)}, second=${JSON.stringify(schema2)}`,
    );
  } finally { await agg.shutdown(); }
});
