/**
 * GFF drift guard: freeze cast:executed alternatives[i].description invariants.
 *
 * GFB froze score finiteness and ordinal properties for cast:executed alternatives.
 * GFC froze score ordinals for cast:plan.
 * GFD froze structural properties of cast:executed alternatives (count, tool format).
 * GFE froze structural properties of cast:plan alternatives.
 * GFF freezes the description field of cast:executed alternatives — the one property
 * not yet pinned by exact-keyset (GAS/EH) or value-type (EH) guards:
 *
 *   (a) alternatives[i].description is a string (not undefined, null, or number).
 *       A misconfigured backend or a partial-map regression could produce a
 *       non-string or missing description.
 *
 *   (b) alternatives[i].description is non-empty.
 *       An empty string would surface a blank description in clients.
 *
 *   (c) alternatives[i].description round-trips the fixture value exactly.
 *       Verifies that the aggregator forwards the backend's description without
 *       truncating, trimming, or transforming it.
 *
 *   (d) alternatives[i].description differs from alternatives[i].tool.
 *       They are different fields from the backend; identical values would
 *       indicate a field-assignment swap regression.
 *
 *   (e) All alternatives[i].description values are unique when the fixture
 *       supplies tools with distinct descriptions (no cross-contamination).
 *
 * Source: src-stdio/aggregator.ts
 *   alternatives = scoredTools.slice(1, 4).map(t => ({
 *     tool: t.namespacedName, score: t.score, description: t.description
 *   }))
 *
 * Fixture: same 3-tool / "list stripe payments" setup as GFB/GFD.
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
  return join(tmpdir(), `ch1tty-gff-${Date.now()}-${++dlqSeq}.jsonl`);
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

// Descriptions indexed by tool name — used for round-trip check in GFF-3.
const EXPECTED_DESCRIPTIONS: Record<string, string> = {
  get_stripe_balance: 'Get stripe account balance for billing and payments',
  create_stripe_payment: 'Create a new stripe payment intent or charge',
};

const MULTI_TOOLS = [TOOL_LIST, TOOL_BALANCE, TOOL_CREATE];

// ── GFF-1: alternatives[i].description is a string ───────────────────────────

test('GFF-1: cast:executed alternatives[i].description is typeof string', async () => {
  const agg = makeAgg('gff-1', MULTI_TOOLS);
  try {
    const body = await castExecuted(agg);
    const alternatives = body['alternatives'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(alternatives) && alternatives.length > 0,
      'multi-tool fixture must yield at least one alternative');
    for (let i = 0; i < alternatives.length; i++) {
      const d = alternatives[i]!['description'];
      assert.ok(
        typeof d === 'string',
        `alternatives[${i}].description must be typeof string, got ${typeof d} (${JSON.stringify(d)})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GFF-2: alternatives[i].description is non-empty ──────────────────────────

test('GFF-2: cast:executed alternatives[i].description is non-empty', async () => {
  const agg = makeAgg('gff-2', MULTI_TOOLS);
  try {
    const body = await castExecuted(agg);
    const alternatives = body['alternatives'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(alternatives) && alternatives.length > 0,
      'multi-tool fixture must yield at least one alternative');
    for (let i = 0; i < alternatives.length; i++) {
      const d = alternatives[i]!['description'] as string;
      assert.ok(
        d.length > 0,
        `alternatives[${i}].description must be non-empty`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GFF-3: description round-trips fixture value exactly ─────────────────────

test('GFF-3: cast:executed alternatives[i].description round-trips fixture description', async () => {
  const agg = makeAgg('gff-3', MULTI_TOOLS);
  try {
    const body = await castExecuted(agg);
    const alternatives = body['alternatives'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(alternatives) && alternatives.length > 0,
      'multi-tool fixture must yield at least one alternative');
    for (let i = 0; i < alternatives.length; i++) {
      const toolNs = alternatives[i]!['tool'] as string;
      const toolName = toolNs.split('/').pop()!;
      const expected = EXPECTED_DESCRIPTIONS[toolName];
      if (expected !== undefined) {
        const actual = alternatives[i]!['description'] as string;
        assert.equal(
          actual,
          expected,
          `alternatives[${i}].description must match fixture for tool ${toolName}`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GFF-4: description !== tool (no field-assignment swap) ───────────────────

test('GFF-4: cast:executed alternatives[i].description differs from alternatives[i].tool', async () => {
  const agg = makeAgg('gff-4', MULTI_TOOLS);
  try {
    const body = await castExecuted(agg);
    const alternatives = body['alternatives'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(alternatives) && alternatives.length > 0,
      'multi-tool fixture must yield at least one alternative');
    for (let i = 0; i < alternatives.length; i++) {
      const d = alternatives[i]!['description'] as string;
      const t = alternatives[i]!['tool'] as string;
      assert.notEqual(
        d,
        t,
        `alternatives[${i}].description must not equal .tool — field-assignment swap guard`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GFF-5: descriptions are unique across alternatives ───────────────────────

test('GFF-5: cast:executed alternatives[i].description values are unique', async () => {
  const agg = makeAgg('gff-5', MULTI_TOOLS);
  try {
    const body = await castExecuted(agg);
    const alternatives = body['alternatives'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(alternatives) && alternatives.length > 0,
      'multi-tool fixture must yield at least one alternative');
    const descriptions = alternatives.map((a) => a['description'] as string);
    const unique = new Set(descriptions);
    assert.equal(
      unique.size,
      descriptions.length,
      `alternatives must have unique descriptions; duplicates found: ${JSON.stringify(descriptions)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
