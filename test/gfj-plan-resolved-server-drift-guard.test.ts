/**
 * GFJ drift guard: freeze cast:plan resolved.server invariants.
 *
 * GFI (PR #1697) froze resolved.description for cast:plan. GFJ freezes
 * resolved.server — the serverId of the backend that owns the winning tool.
 * This field is set by the aggregator from `best.serverId` when building the
 * plan body. Five invariants:
 *
 *   (a) resolved.server is a string (not undefined/null/number).
 *       A missing or mistyped field would surface as an empty field in clients.
 *
 *   (b) resolved.server is non-empty.
 *       An empty-string serverId should never reach the plan response.
 *
 *   (c) resolved.server round-trips the fixture serverId exactly.
 *       Verifies the aggregator forwards best.serverId without mutation.
 *
 *   (d) resolved.server differs from resolved.tool.
 *       They are separate fields; identical values would indicate a
 *       field-assignment swap regression (tool is namespaced; server is bare id).
 *
 *   (e) resolved.tool starts with resolved.server + '/'.
 *       Namespace invariant: the tool's namespaced name is {serverId}/{toolName}.
 *       A regression that changes namespacing logic would break this.
 *
 * Source: src/core.ts
 *   resolved: { tool: best.namespacedName, server: best.serverId, ... }
 *   best.namespacedName = `${best.serverId}/${toolName}`
 *
 * Fixture: same 3-tool / "list stripe payments" setup as GFG/GFH.
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
  return join(tmpdir(), `ch1tty-gfj-${Date.now()}-${++dlqSeq}.jsonl`);
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

// ── GFJ-1: resolved.server is typeof string ──────────────────────────────────

test('GFJ-1: cast:plan resolved.server is typeof string', async () => {
  const agg = makeAgg('gfj-1', MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    const resolved = body['resolved'] as Record<string, unknown>;
    const server = resolved['server'];
    assert.ok(
      typeof server === 'string',
      `cast:plan resolved.server must be typeof string, got ${typeof server} (${JSON.stringify(server)})`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFJ-2: resolved.server is non-empty ──────────────────────────────────────

test('GFJ-2: cast:plan resolved.server is non-empty', async () => {
  const agg = makeAgg('gfj-2', MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    const resolved = body['resolved'] as Record<string, unknown>;
    const server = resolved['server'] as string;
    assert.ok(
      server.length > 0,
      'cast:plan resolved.server must be non-empty',
    );
  } finally { await agg.shutdown(); }
});

// ── GFJ-3: resolved.server round-trips the fixture serverId ──────────────────

test('GFJ-3: cast:plan resolved.server round-trips the fixture serverId exactly', async () => {
  const serverId = 'gfj-3';
  const agg = makeAgg(serverId, MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    const resolved = body['resolved'] as Record<string, unknown>;
    const server = resolved['server'] as string;
    assert.equal(
      server,
      serverId,
      `cast:plan resolved.server must equal the fixture serverId "${serverId}", got "${server}"`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFJ-4: resolved.server differs from resolved.tool ────────────────────────

test('GFJ-4: cast:plan resolved.server differs from resolved.tool (no field-swap)', async () => {
  const agg = makeAgg('gfj-4', MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    const resolved = body['resolved'] as Record<string, unknown>;
    const server = resolved['server'] as string;
    const tool = resolved['tool'] as string;
    assert.notEqual(
      server,
      tool,
      `cast:plan resolved.server must not equal resolved.tool — field-assignment swap guard (server="${server}", tool="${tool}")`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFJ-5: resolved.tool starts with resolved.server + '/' ───────────────────

test('GFJ-5: cast:plan resolved.tool starts with resolved.server + "/" (namespace invariant)', async () => {
  const agg = makeAgg('gfj-5', MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    const resolved = body['resolved'] as Record<string, unknown>;
    const server = resolved['server'] as string;
    const tool = resolved['tool'] as string;
    assert.ok(
      tool.startsWith(server + '/'),
      `cast:plan resolved.tool must start with resolved.server + "/" — namespace invariant. server="${server}", tool="${tool}"`,
    );
  } finally { await agg.shutdown(); }
});
