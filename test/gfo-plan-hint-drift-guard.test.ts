/**
 * GFO drift guard: freeze cast:plan hint field invariants.
 *
 * The cast:plan response contains a static guidance string:
 *   hint: 'Call cast again without confirm to execute, or use ch1tty/execute directly.'
 *
 * Source: src/core.ts
 *   cast:plan response (confirm === true path, line ~962):
 *     hint: 'Call cast again without confirm to execute, or use ch1tty/execute directly.'
 *
 * Prior GF* tests frozen all structured fields in cast:plan (GFH–GFN) and
 * the alternatives (GFB–GFG). The hint field — which gives clients the
 * canonical confirmation workflow — has no dedicated frozen invariants:
 *
 *   (a) hint is a string (not undefined/null/number).
 *       A refactor that omits or renames the key could produce a non-string
 *       or missing hint silently.
 *
 *   (b) hint is non-empty.
 *       An empty string would give clients nothing to display.
 *
 *   (c) hint contains the word "confirm" (the workflow keyword).
 *       A rewrite that drops "confirm" would break clients that parse the
 *       hint to understand the confirmation workflow.
 *
 *   (d) hint differs from intent (no field-swap regression).
 *       hint and intent are adjacent in the serialised JSON; a variable
 *       swap during a refactor could silently echo the intent string as hint.
 *
 *   (e) hint is stable across repeated cast:plan calls on the same registry.
 *       It is a static string; any non-determinism here indicates a
 *       regression where the hint is built dynamically and changes per call.
 *
 * Fixture: same 3-tool / "list stripe payments" setup as GFK/GFH.
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
import { FixtureBackend } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gfo-${Date.now()}-${++dlqSeq}.jsonl`);
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

// ── GFO-1: hint is a string ───────────────────────────────────────────────────

test('GFO-1: cast:plan hint is a string (not undefined/null/number)', async () => {
  const agg = makeAgg('gfo-1', MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    assert.equal(
      typeof body['hint'],
      'string',
      `cast:plan hint must be a string, got ${typeof body['hint']}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFO-2: hint is non-empty ──────────────────────────────────────────────────

test('GFO-2: cast:plan hint is non-empty', async () => {
  const agg = makeAgg('gfo-2', MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    const hint = body['hint'] as string;
    assert.ok(
      hint.length > 0,
      'cast:plan hint must be a non-empty string',
    );
  } finally { await agg.shutdown(); }
});

// ── GFO-3: hint contains "confirm" (confirmation-workflow keyword) ────────────

test('GFO-3: cast:plan hint contains the word "confirm" (confirmation-workflow contract)', async () => {
  const agg = makeAgg('gfo-3', MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    const hint = body['hint'] as string;
    assert.ok(
      hint.includes('confirm'),
      `cast:plan hint must contain "confirm" to preserve the confirmation-workflow contract, got: ${JSON.stringify(hint)}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFO-4: hint differs from intent (field-swap regression guard) ─────────────

test('GFO-4: cast:plan hint differs from intent (no field-swap regression)', async () => {
  const agg = makeAgg('gfo-4', MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    const hint = body['hint'] as string;
    const intent = body['intent'] as string;
    assert.notEqual(
      hint,
      intent,
      `cast:plan hint must not equal intent — field-swap regression guard`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFO-5: hint is stable across repeated cast:plan calls ────────────────────

test('GFO-5: cast:plan hint is stable across repeated calls (no drift)', async () => {
  const agg = makeAgg('gfo-5', MULTI_TOOLS);
  try {
    const body1 = await castPlan(agg);
    const body2 = await castPlan(agg);
    const hint1 = body1['hint'] as string;
    const hint2 = body2['hint'] as string;
    assert.equal(
      hint1,
      hint2,
      `cast:plan hint must be stable: first call ${JSON.stringify(hint1)}, second call ${JSON.stringify(hint2)}`,
    );
  } finally { await agg.shutdown(); }
});
