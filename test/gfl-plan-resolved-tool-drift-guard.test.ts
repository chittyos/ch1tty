/**
 * GFL drift guard: freeze cast:plan resolved.tool invariants.
 *
 * The resolved object on a cast:plan response includes:
 *   { tool, server, category, description, score, inputSchema }
 *
 * Prior GF* tests frozen:
 *   GFH — resolved.score (4 invariants)
 *   GFI — resolved.description (5 invariants)
 *   GFJ — resolved.server (5 invariants, incl. tool/server namespace relationship)
 *   GFK — resolved.category (5 invariants)
 *
 * GFL directly freezes resolved.tool invariants. GFJ-4/GFJ-5 had indirect
 * coverage (server ≠ tool; tool starts with server+'/'), but no dedicated
 * invariant set existed for the tool field itself.
 *
 * Source: src/core.ts
 *   cast:plan response:
 *     resolved: { ..., tool: best.namespaced, ... }
 *   best.namespaced = `${serverId}/${toolName}` (set in aggregator.ts)
 *
 * Fixture: same 3-tool / "list stripe payments" setup as GFH–GFK.
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
  return join(tmpdir(), `ch1tty-gfl-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

const FIXTURE_SERVER = 'gfl-stripe';
const FIXTURE_TOOL_NAME = 'list_stripe_payments';
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
  name: FIXTURE_TOOL_NAME,
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

// ── GFL-1: tool is a string ───────────────────────────────────────────────────

test('GFL-1: cast:plan resolved.tool is a string (not undefined/null/number)', async () => {
  const agg = makeAgg(`${FIXTURE_SERVER}-1`, MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    const resolved = body['resolved'] as Record<string, unknown>;
    assert.equal(
      typeof resolved['tool'],
      'string',
      `cast:plan resolved.tool must be a string, got ${typeof resolved['tool']}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFL-2: tool is non-empty ──────────────────────────────────────────────────

test('GFL-2: cast:plan resolved.tool is non-empty', async () => {
  const agg = makeAgg(`${FIXTURE_SERVER}-2`, MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    const resolved = body['resolved'] as Record<string, unknown>;
    const tool = resolved['tool'] as string;
    assert.ok(
      tool.length > 0,
      `cast:plan resolved.tool must be non-empty`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFL-3: tool contains exactly one '/' (namespaced format invariant) ─────────

test('GFL-3: cast:plan resolved.tool contains exactly one "/" (namespaced format)', async () => {
  const agg = makeAgg(`${FIXTURE_SERVER}-3`, MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    const resolved = body['resolved'] as Record<string, unknown>;
    const tool = resolved['tool'] as string;
    const slashCount = (tool.match(/\//g) ?? []).length;
    assert.equal(
      slashCount,
      1,
      `cast:plan resolved.tool must contain exactly one '/' (got ${slashCount} in '${tool}')`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFL-4: tool suffix matches the fixture's winning tool name ─────────────────

test(`GFL-4: cast:plan resolved.tool ends with "/${FIXTURE_TOOL_NAME}" (fixture round-trip)`, async () => {
  const serverId = `${FIXTURE_SERVER}-4`;
  const agg = makeAgg(serverId, MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    const resolved = body['resolved'] as Record<string, unknown>;
    const tool = resolved['tool'] as string;
    assert.ok(
      tool.endsWith(`/${FIXTURE_TOOL_NAME}`),
      `cast:plan resolved.tool must end with '/${FIXTURE_TOOL_NAME}', got '${tool}'`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFL-5: tool is stable across repeated cast:plan calls ─────────────────────

test('GFL-5: cast:plan resolved.tool is stable across repeated calls (no drift)', async () => {
  const agg = makeAgg(`${FIXTURE_SERVER}-5`, MULTI_TOOLS);
  try {
    const body1 = await castPlan(agg);
    const body2 = await castPlan(agg);
    const tool1 = (body1['resolved'] as Record<string, unknown>)['tool'];
    const tool2 = (body2['resolved'] as Record<string, unknown>)['tool'];
    assert.equal(
      tool1,
      tool2,
      `cast:plan resolved.tool must be stable: first '${String(tool1)}', second '${String(tool2)}'`,
    );
  } finally { await agg.shutdown(); }
});
