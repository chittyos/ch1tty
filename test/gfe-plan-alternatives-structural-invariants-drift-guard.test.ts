/**
 * GFE drift guard: freeze cast:plan alternatives structural invariants.
 *
 * GFB froze score finiteness and ordinal properties for cast:executed.
 * GFC froze score ordinals for cast:plan.
 * GFD froze structural properties of cast:executed alternatives.
 * GFE freezes the same structural properties for cast:plan alternatives:
 *
 *   (a) The alternatives array is capped at 3 items (scoredTools.slice(1,4)).
 *       Off-by-one in the slice bound (e.g. slice(1,5)) would return 4 items.
 *
 *   (b) Every alternatives[i].tool is a non-empty string.
 *       An empty namespace segment or empty map call could produce "".
 *
 *   (c) Every alternatives[i].tool contains '/' (namespaced: serverId/toolName).
 *       Stripping the serverId prefix would produce a bare tool name that
 *       looks valid but cannot be routed by ch1tty/execute.
 *
 *   (d) All alternatives[i].tool values are unique (no duplicate tool names).
 *       A map/dedup regression could include the same tool twice.
 *
 *   (e) No alternatives[i].tool equals the winner's resolved tool.
 *       On cast:plan the winner is body.resolved.tool (an object property),
 *       not body.resolved (a bare string as in cast:executed).
 *       An off-by-one (slice(0,3)) would include the winner as an alternative.
 *
 * Key difference from GFD: cast:plan is triggered with confirm:true and its
 * winner is embedded in the resolved sub-object as resolved.tool, not as a
 * top-level resolved string. The alternatives array is always present on the
 * plan path (cast:executed is conditional; cast:plan is unconditional).
 *
 * Source: src-stdio/aggregator.ts
 *   alternatives = scoredTools.slice(1, 4).map(t => ({ tool, score, description }))
 *   cast:plan: resolved = { tool: best.namespacedName, score: best.score, ... }
 *
 * Fixture: same 3-tool / "list stripe payments" setup as GAS/GFB/GFD.
 * GFE-1 uses a 5-tool fixture (MANY_TOOLS) for a non-trivial cap assertion.
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
  return join(tmpdir(), `ch1tty-gfe-${Date.now()}-${++dlqSeq}.jsonl`);
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

async function castPlan(
  agg: Aggregator,
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, confirm: true });
  assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body['cast'], 'plan', `expected cast:plan, got ${String(body['cast'])}`);
  return body;
}

// Intent: "list stripe payments" — 3 terms
const INTENT = 'list stripe payments';

// Winner: matches all 3 intent terms → highest scorer.
const TOOL_LIST = {
  name: 'list_stripe_payments',
  description: 'List recent stripe payment intents',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text', text: '{"data":[]}' }] },
};

// Runner-up 1: "stripe" + "payment" → score > 0.1 → alternative.
const TOOL_BALANCE = {
  name: 'get_stripe_balance',
  description: 'Get stripe account balance for billing and payments',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text', text: '{"available":[]}' }] },
};

// Runner-up 2: "stripe" + "payment" → score > 0.1 → alternative.
const TOOL_CREATE = {
  name: 'create_stripe_payment',
  description: 'Create a new stripe payment intent or charge',
  inputSchema: {
    type: 'object',
    properties: { amount: { type: 'number' }, currency: { type: 'string' } },
  },
  response: { content: [{ type: 'text', text: '{"id":"pi_new"}' }] },
};

// Additional tools for GFE-1 five-tool cap assertion.
const TOOL_CANCEL = {
  name: 'cancel_stripe_payment',
  description: 'Cancel a stripe payment intent for billing',
  inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
  response: { content: [{ type: 'text', text: '{"cancelled":true}' }] },
};

const TOOL_REFUND = {
  name: 'refund_stripe_payment',
  description: 'Refund a stripe payment and list refund details',
  inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
  response: { content: [{ type: 'text', text: '{"refunded":true}' }] },
};

const MULTI_TOOLS = [TOOL_LIST, TOOL_BALANCE, TOOL_CREATE];
const MANY_TOOLS = [TOOL_LIST, TOOL_BALANCE, TOOL_CREATE, TOOL_CANCEL, TOOL_REFUND];

// ── GFE-1: alternatives count === 3 (slice(1,4) cap) ────────────────────────

test('GFE-1: cast:plan alternatives count is exactly 3 with 5-tool fixture', async () => {
  // Use 5 tools (winner + 4 runner-ups) so slice(1,4) must hit its cap of 3.
  const agg = makeAgg('gfe-1', MANY_TOOLS);
  try {
    const body = await castPlan(agg);
    const alternatives = body['alternatives'];
    assert.ok(
      Array.isArray(alternatives),
      `alternatives must be an array, got ${typeof alternatives}`,
    );
    assert.equal(
      alternatives.length,
      3,
      `5-tool fixture must hit the slice(1,4) cap of 3, got ${alternatives.length}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GFE-2: alternatives[i].tool is a non-empty string ────────────────────────

test('GFE-2: cast:plan alternatives[i].tool is a non-empty string', async () => {
  const agg = makeAgg('gfe-2', MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    const alternatives = body['alternatives'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(alternatives) && alternatives.length > 0,
      'multi-tool fixture must yield at least one alternative');
    for (let i = 0; i < alternatives.length; i++) {
      const t = alternatives[i]!['tool'];
      assert.ok(
        typeof t === 'string' && t.length > 0,
        `alternatives[${i}].tool must be a non-empty string, got ${JSON.stringify(t)}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GFE-3: alternatives[i].tool contains '/' (namespaced) ────────────────────

test('GFE-3: cast:plan alternatives[i].tool contains \'/\' (serverId/toolName format)', async () => {
  const agg = makeAgg('gfe-3', MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    const alternatives = body['alternatives'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(alternatives) && alternatives.length > 0,
      'multi-tool fixture must yield at least one alternative');
    for (let i = 0; i < alternatives.length; i++) {
      const t = alternatives[i]!['tool'] as string;
      assert.ok(
        t.includes('/'),
        `alternatives[${i}].tool must contain '/' (namespaced), got ${JSON.stringify(t)}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GFE-4: alternatives[i].tool values are unique ────────────────────────────

test('GFE-4: cast:plan alternatives[i].tool values are unique (no duplicates)', async () => {
  const agg = makeAgg('gfe-4', MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    const alternatives = body['alternatives'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(alternatives) && alternatives.length > 0,
      'multi-tool fixture must yield at least one alternative');
    const tools = alternatives.map((a) => a['tool'] as string);
    const unique = new Set(tools);
    assert.equal(
      unique.size,
      tools.length,
      `alternatives must have unique tool names; duplicates found: ${JSON.stringify(tools)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GFE-5: alternatives do not include the winner's resolved tool ─────────────

test('GFE-5: cast:plan alternatives do not include the resolved winner tool', async () => {
  const agg = makeAgg('gfe-5', MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    // cast:plan embeds the winner in resolved.tool (an object), not a bare string.
    const resolved = body['resolved'] as Record<string, unknown>;
    const winner = resolved['tool'] as string;
    assert.ok(typeof winner === 'string' && winner.length > 0,
      `resolved.tool must be a non-empty string, got ${JSON.stringify(winner)}`);
    const alternatives = body['alternatives'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(alternatives) && alternatives.length > 0,
      'multi-tool fixture must yield at least one alternative');
    for (let i = 0; i < alternatives.length; i++) {
      const t = alternatives[i]!['tool'] as string;
      assert.notEqual(
        t,
        winner,
        `alternatives[${i}].tool (${JSON.stringify(t)}) must differ from the winner (${JSON.stringify(winner)}) — scoredTools.slice(1) must exclude index 0`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});
