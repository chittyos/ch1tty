/**
 * GAS drift guard: freeze alternatives item exact key set in cast:executed responses.
 *
 * EH (eh-alternatives-item-shape.test.ts) checks "no unexpected keys" in
 * alternatives items by filtering out permitted keys — a permissive assertion
 * that passes even when required keys are missing. For example, a regression
 * removing `description` from the alternatives map would leave {tool, score}
 * which has no unexpected keys, so EH would pass silently.
 *
 * GAS is the complementary strict assertion: each alternatives item has EXACTLY
 * {description, score, tool} — no more, no fewer.
 *
 * Aggregator alternatives map (src-stdio/aggregator.ts ~line 1389):
 *   scoredTools.slice(1, 4).map((t) => ({
 *     tool: t.namespacedName,
 *     score: t.score,
 *     description: t.description,
 *   }))
 * All 3 fields are always present (description = tool description string, never undefined).
 * No optional fields; this is a fixed schema unlike resources/prompts.
 *
 * Invariants frozen by GAS:
 *   1. cast:executed alternatives item has EXACTLY {description, score, tool}.
 *      EH verified no extra keys; GAS adds the required-keys side (deepEqual).
 *   2. cast:plan (confirm:true) alternatives item has EXACTLY {description, score, tool}.
 *   3. Every alternatives item in the array (when length > 1) has ALL 3 required keys.
 *   4. alternatives item.description is always a non-empty string (tool's own description).
 *   5. cast:executed has no `alternatives` key when only one tool is registered
 *      (slice(1,4) on a 1-element array is empty → key omitted from body).
 *
 * All tests use intent "list stripe payments" (3 terms: list, stripe, payments).
 * TOOL_LIST scores highest → cast:executed (no confirm) / cast:plan (confirm:true).
 * TOOL_BALANCE and TOOL_CREATE each contain "stripe" and "payment" → score above 0.1
 * → appear as alternatives.
 *
 * Source refs:
 *   alternatives map:  src-stdio/aggregator.ts line ~1389
 *   cast:executed:     src-stdio/aggregator.ts line ~1666
 *   cast:plan:         src-stdio/aggregator.ts line ~1617
 *
 * Frozen 2026-09-24.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (alternatives item key set, not explain)
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
  return join(tmpdir(), `ch1tty-gas-${Date.now()}-${++dlqSeq}.jsonl`);
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

async function cast(
  agg: Aggregator,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', args);
  assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

function sortedKeys(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).sort();
}

// Intent: "list stripe payments" — 3 terms
const INTENT = 'list stripe payments';

// Winning tool: matches all 3 intent terms → highest scorer → cast:executed resolved tool.
const TOOL_LIST = {
  name: 'list_stripe_payments',
  description: 'List recent stripe payment intents',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text', text: '{"data":[]}' }] },
};

// Runner-up 1: "stripe" + "payment" in name+description → scores above 0.1 → alternative.
const TOOL_BALANCE = {
  name: 'get_stripe_balance',
  description: 'Get stripe account balance for billing and payments',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text', text: '{"available":[]}' }] },
};

// Runner-up 2: "stripe" + "payment" in name+description → scores above 0.1 → alternative.
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

// ── GAS-1: cast:executed alternatives item has exactly {description, score, tool}

test('GAS-1: cast:executed alternatives item has exactly keys {description, score, tool}', async () => {
  const agg = makeAgg('gas-exec-1', MULTI_TOOLS);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const alternatives = body['alternatives'] as unknown[];
    assert.ok(Array.isArray(alternatives) && alternatives.length > 0, 'alternatives must be a non-empty array for multi-tool fixture');
    const item = (alternatives as Record<string, unknown>[])[0]!;
    assert.deepEqual(
      sortedKeys(item),
      ['description', 'score', 'tool'],
      `alternatives item must have exactly {description, score, tool}, got ${JSON.stringify(sortedKeys(item))}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GAS-2: cast:plan alternatives item has exactly {description, score, tool}

test('GAS-2: cast:plan alternatives item has exactly keys {description, score, tool}', async () => {
  const agg = makeAgg('gas-plan-2', MULTI_TOOLS);
  try {
    const body = await cast(agg, { intent: INTENT, confirm: true });
    assert.equal(body['cast'], 'plan', `expected cast:plan, got ${body['cast']}`);
    const alternatives = body['alternatives'] as unknown[];
    assert.ok(Array.isArray(alternatives) && alternatives.length > 0, 'cast:plan alternatives must be a non-empty array for multi-tool fixture');
    const item = (alternatives as Record<string, unknown>[])[0]!;
    assert.deepEqual(
      sortedKeys(item),
      ['description', 'score', 'tool'],
      `cast:plan alternatives item must have exactly {description, score, tool}, got ${JSON.stringify(sortedKeys(item))}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GAS-3: every alternatives item has ALL 3 required keys present

test('GAS-3: every cast:executed alternatives item has all 3 required keys present', async () => {
  const agg = makeAgg('gas-exec-3', MULTI_TOOLS);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const alternatives = body['alternatives'] as unknown[];
    assert.ok(Array.isArray(alternatives) && alternatives.length > 0, 'alternatives must be non-empty');
    for (const item of alternatives as Record<string, unknown>[]) {
      assert.deepEqual(
        sortedKeys(item),
        ['description', 'score', 'tool'],
        `every alternatives item must have exactly {description, score, tool}, got ${JSON.stringify(sortedKeys(item))}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GAS-4: alternatives item.description is always a non-empty string

test('GAS-4: cast:executed alternatives item.description is a non-empty string', async () => {
  const agg = makeAgg('gas-exec-4', MULTI_TOOLS);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const alternatives = body['alternatives'] as unknown[];
    assert.ok(Array.isArray(alternatives) && alternatives.length > 0, 'alternatives must be non-empty');
    for (const item of alternatives as Record<string, unknown>[]) {
      const desc = item['description'];
      assert.ok(
        typeof desc === 'string' && desc.length > 0,
        `alternatives item.description must be a non-empty string, got ${JSON.stringify(desc)}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GAS-5: alternatives absent when only one tool registered

test('GAS-5: cast:executed has no alternatives key when only one tool is registered', async () => {
  const agg = makeAgg('gas-exec-5', [TOOL_LIST]);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'alternatives') ||
        (body['alternatives'] as unknown[]).length === 0,
      `alternatives must be absent (or empty) when only one tool is registered, got ${JSON.stringify(body['alternatives'])}`,
    );
  } finally {
    await agg.shutdown();
  }
});
