/**
 * GFD drift guard: freeze cast:executed alternatives structural invariants.
 *
 * GFB froze score finiteness and ordinal properties for cast:executed.
 * GFC froze score ordinals for cast:plan.
 * GFD freezes structural properties of the alternatives array itself — properties
 * that GAS (exact keyset) and EH (value types) do not cover:
 *
 *   (a) The alternatives array is capped at 3 items (scoredTools.slice(1,4)).
 *       Off-by-one in the slice bound (e.g. slice(1,5)) would return 4 items.
 *
 *   (b) Every alternatives[i].tool is a non-empty string.
 *       An empty namespace segment or empty map call could produce "".
 *
 *   (c) Every alternatives[i].tool contains '/' (namespaced: serverId/toolName).
 *       Stripping the serverId prefix (e.g. when namespacedName is rebuilt
 *       incorrectly) would produce a bare tool name that looks valid but cannot
 *       be routed by ch1tty/execute.
 *
 *   (d) All alternatives[i].tool values are unique (no duplicate tool names).
 *       A map/dedup regression could include the same tool twice.
 *
 *   (e) No alternatives[i].tool equals the winner's resolved tool.
 *       scoredTools[0] is the winner; slice(1) excludes it. An off-by-one
 *       (slice(0,3)) would include the winner as an alternative.
 *
 * Source: src-stdio/aggregator.ts
 *   alternatives = scoredTools.slice(1, 4).map(t => ({ tool, score, description }))
 *   cast:executed: resolved = best.namespacedName (string at body.resolved)
 *
 * Fixture: same 3-tool / "list stripe payments" setup as GAS/GFB.
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
  return join(tmpdir(), `ch1tty-gfd-${Date.now()}-${++dlqSeq}.jsonl`);
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

async function castExecuted(
  agg: Aggregator,
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT });
  assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body['cast'], 'executed', `expected cast:executed, got ${String(body['cast'])}`);
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

// Additional tools that also score > 0.1 for "list stripe payments" — used only
// in GFD-1 to verify the count cap holds with more than 3 runner-ups available.
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

// ── GFD-1: alternatives count <= 3 ───────────────────────────────────────────

test('GFD-1: cast:executed alternatives count is at most 3', async () => {
  // Use 5 tools (winner + 4 runner-ups) so the cap assertion is non-trivial.
  const agg = makeAgg('gfd-1', MANY_TOOLS);
  try {
    const body = await castExecuted(agg);
    const alternatives = body['alternatives'] as Array<unknown> | undefined;
    if (alternatives === undefined) {
      // No alternatives at all is also valid (cast:executed omits key when empty).
      return;
    }
    assert.ok(
      Array.isArray(alternatives),
      `alternatives must be an array, got ${typeof alternatives}`,
    );
    assert.ok(
      alternatives.length <= 3,
      `alternatives count must be <= 3 (slice(1,4) cap), got ${alternatives.length}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GFD-2: alternatives[i].tool is a non-empty string ────────────────────────

test('GFD-2: cast:executed alternatives[i].tool is a non-empty string', async () => {
  const agg = makeAgg('gfd-2', MULTI_TOOLS);
  try {
    const body = await castExecuted(agg);
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

// ── GFD-3: alternatives[i].tool contains '/' (namespaced) ────────────────────

test('GFD-3: cast:executed alternatives[i].tool contains \'/\' (serverId/toolName format)', async () => {
  const agg = makeAgg('gfd-3', MULTI_TOOLS);
  try {
    const body = await castExecuted(agg);
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

// ── GFD-4: alternatives[i].tool values are unique ────────────────────────────

test('GFD-4: cast:executed alternatives[i].tool values are unique (no duplicates)', async () => {
  const agg = makeAgg('gfd-4', MULTI_TOOLS);
  try {
    const body = await castExecuted(agg);
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

// ── GFD-5: alternatives do not include the winner's resolved tool ─────────────

test('GFD-5: cast:executed alternatives do not include the resolved winner tool', async () => {
  const agg = makeAgg('gfd-5', MULTI_TOOLS);
  try {
    const body = await castExecuted(agg);
    const winner = body['resolved'] as string;
    assert.ok(typeof winner === 'string' && winner.length > 0,
      `resolved must be a non-empty string, got ${JSON.stringify(winner)}`);
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
