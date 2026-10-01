/**
 * GFK drift guard: freeze cast:plan resolved.category invariants.
 *
 * The resolved object on a cast:plan response includes:
 *   { tool, server, category, description, score, inputSchema }
 *
 * Prior GF* tests frozen:
 *   GFH — resolved.score (4 invariants)
 *   GFI — resolved.description (5 invariants, PR #1697)
 *   GFJ — resolved.server (5 invariants, PR #1698)
 *
 * GFK closes the remaining string-field gap: resolved.category had no
 * frozen invariants beyond key-presence guards in earlier workstreams.
 *
 * Source: src/core.ts
 *   cast:plan response:
 *     resolved: { ..., category: best.category, ... }
 *   category comes from the ServerConfig supplied at Aggregator construction.
 *
 * Fixture: same 3-tool / "list stripe payments" setup as GFH.
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
  return join(tmpdir(), `ch1tty-gfk-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

const FIXTURE_CATEGORY = 'ecosystem';

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
      category: FIXTURE_CATEGORY,
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

// ── GFK-1: category is a string ───────────────────────────────────────────────

test('GFK-1: cast:plan resolved.category is a string (not undefined/null/number)', async () => {
  const agg = makeAgg('gfk-1', MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    const resolved = body['resolved'] as Record<string, unknown>;
    assert.equal(
      typeof resolved['category'],
      'string',
      `cast:plan resolved.category must be a string, got ${typeof resolved['category']}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFK-2: category is non-empty ──────────────────────────────────────────────

test('GFK-2: cast:plan resolved.category is non-empty', async () => {
  const agg = makeAgg('gfk-2', MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    const resolved = body['resolved'] as Record<string, unknown>;
    const category = resolved['category'] as string;
    assert.ok(
      category.length > 0,
      `cast:plan resolved.category must be non-empty`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFK-3: category round-trips the fixture value exactly ─────────────────────

test('GFK-3: cast:plan resolved.category round-trips fixture value exactly (no mutation)', async () => {
  const agg = makeAgg('gfk-3', MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    const resolved = body['resolved'] as Record<string, unknown>;
    assert.equal(
      resolved['category'],
      FIXTURE_CATEGORY,
      `cast:plan resolved.category must equal the configured server category '${FIXTURE_CATEGORY}', got '${String(resolved['category'])}'`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFK-4: category differs from tool (field-swap regression guard) ───────────

test('GFK-4: cast:plan resolved.category !== resolved.tool (field-swap regression guard)', async () => {
  const agg = makeAgg('gfk-4', MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    const resolved = body['resolved'] as Record<string, unknown>;
    assert.notEqual(
      resolved['category'],
      resolved['tool'],
      `cast:plan resolved.category must not equal resolved.tool — field-swap regression`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFK-5: category is stable across two cast:plan calls on the same registry ──

test('GFK-5: cast:plan resolved.category is stable across repeated calls (no drift)', async () => {
  const agg = makeAgg('gfk-5', MULTI_TOOLS);
  try {
    const body1 = await castPlan(agg);
    const body2 = await castPlan(agg);
    const cat1 = (body1['resolved'] as Record<string, unknown>)['category'];
    const cat2 = (body2['resolved'] as Record<string, unknown>)['category'];
    assert.equal(
      cat1,
      cat2,
      `cast:plan resolved.category must be stable: first call '${String(cat1)}', second call '${String(cat2)}'`,
    );
  } finally { await agg.shutdown(); }
});
