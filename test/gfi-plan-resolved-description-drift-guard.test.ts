/**
 * GFI drift guard: freeze cast:plan resolved.description invariants.
 *
 * GFG froze alternatives[i].description for cast:plan (5 invariants — same
 * shape as GFF which covered cast:executed alternatives). GFH froze the
 * ordinal invariants of resolved.score for cast:plan. GFI closes the remaining
 * gap: the winner's description at resolved.description has never been frozen
 * beyond the key-presence guards in earlier workstreams.
 *
 * cast:plan embeds the winner's tool metadata at resolved.{tool, server,
 * category, description, score, inputSchema}. The description field:
 *
 *   (a) Must be a string — a misconfigured backend or a partial-map regression
 *       could yield undefined, null, or a non-string value that passes loose
 *       equality checks but breaks downstream string operations.
 *
 *   (b) Must be non-empty — an empty string surfaces as a blank description in
 *       any client that renders it.
 *
 *   (c) Must round-trip the fixture value exactly — the aggregator must forward
 *       the backend's description without truncating, trimming, or transforming.
 *
 *   (d) Must differ from resolved.tool — tool is the namespaced name
 *       ("serverId/toolName"); description is human-readable prose. Identical
 *       values would indicate a field-assignment swap regression (the same bug
 *       GFG-4 guards against in alternatives[i]).
 *
 *   (e) resolved.description must not appear in any alternatives[i].description
 *       when the fixture supplies tools with distinct descriptions — no
 *       cross-contamination between the winner's slot and the runner-up slots.
 *       (The converse is already covered by GFG-5 which checks uniqueness across
 *       alternatives; GFI-5 adds the winner↔runner-up boundary check.)
 *
 * Source: src-stdio/aggregator.ts
 *   cast:plan resolved object includes `description: best.description`.
 *   best.description comes from NamespacedTool.description (forwarded from
 *   the backend's tool definition — no transformation applied).
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
  return join(tmpdir(), `ch1tty-gfi-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

const SERVER_ID = 'gfi-stripe';

const TOOL_LIST = {
  name: 'list_stripe_payments',
  description: 'List recent stripe payment intents for a customer',
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
  description: 'Create a new stripe payment intent or charge amount',
  inputSchema: {
    type: 'object',
    properties: { amount: { type: 'number' }, currency: { type: 'string' } },
  },
  response: { content: [{ type: 'text', text: '{"id":"pi_new"}' }] },
};

const MULTI_TOOLS = [TOOL_LIST, TOOL_BALANCE, TOOL_CREATE];

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer(SERVER_ID, { tools: MULTI_TOOLS, prompts: [], resources: [] });
  const path = dlq();
  const config: ServerConfig[] = [
    {
      id: SERVER_ID,
      name: SERVER_ID,
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

const INTENT = 'list stripe payments';

async function castPlan(agg: Aggregator): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, confirm: true });
  assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body['cast'], 'plan', `expected cast:plan, got ${String(body['cast'])}`);
  return body;
}

// ── GFI-1: resolved.description is a string ──────────────────────────────────

test('GFI-1: cast:plan resolved.description is a string', async () => {
  const agg = makeAgg();
  try {
    const body = await castPlan(agg);
    const resolved = body['resolved'] as Record<string, unknown>;
    assert.equal(
      typeof resolved['description'],
      'string',
      `cast:plan resolved.description must be a string, got ${typeof resolved['description']}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFI-2: resolved.description is non-empty ─────────────────────────────────

test('GFI-2: cast:plan resolved.description is non-empty', async () => {
  const agg = makeAgg();
  try {
    const body = await castPlan(agg);
    const resolved = body['resolved'] as Record<string, unknown>;
    const desc = resolved['description'] as string;
    assert.ok(
      desc.length > 0,
      'cast:plan resolved.description must be a non-empty string',
    );
  } finally { await agg.shutdown(); }
});

// ── GFI-3: resolved.description round-trips fixture value exactly ─────────────

test('GFI-3: cast:plan resolved.description round-trips the fixture description exactly', async () => {
  const agg = makeAgg();
  try {
    const body = await castPlan(agg);
    const resolved = body['resolved'] as Record<string, unknown>;
    const desc = resolved['description'] as string;
    assert.equal(
      desc,
      TOOL_LIST.description,
      `cast:plan resolved.description must equal fixture description; got "${desc}"`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFI-4: resolved.description differs from resolved.tool ────────────────────

test('GFI-4: cast:plan resolved.description differs from resolved.tool (no field-swap regression)', async () => {
  const agg = makeAgg();
  try {
    const body = await castPlan(agg);
    const resolved = body['resolved'] as Record<string, unknown>;
    const desc = resolved['description'] as string;
    const tool = resolved['tool'] as string;
    assert.notEqual(
      desc,
      tool,
      `cast:plan resolved.description must differ from resolved.tool; both were "${desc}"`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFI-5: resolved.description does not appear in alternatives[i].description ─

test('GFI-5: cast:plan resolved.description does not appear in any alternatives[i].description', async () => {
  const agg = makeAgg();
  try {
    const body = await castPlan(agg);
    const resolved = body['resolved'] as Record<string, unknown>;
    const winnerDesc = resolved['description'] as string;
    const alternatives = body['alternatives'] as Array<Record<string, unknown>>;
    assert.ok(
      Array.isArray(alternatives) && alternatives.length > 0,
      'alternatives must be a non-empty array for this guard to fire',
    );
    for (let i = 0; i < alternatives.length; i++) {
      const altDesc = alternatives[i]!['description'] as string;
      assert.notEqual(
        altDesc,
        winnerDesc,
        `alternatives[${i}].description must not equal resolved.description ("${winnerDesc}") — cross-contamination detected`,
      );
    }
  } finally { await agg.shutdown(); }
});
