/**
 * GFS drift guard: freeze cast:plan `args` echo invariants.
 *
 * Background
 * ----------
 * cast:plan includes an `args` field that mirrors the caller's input `args`
 * parameter back to the caller so they can review and edit before executing:
 *
 *   cast:plan → args: toolArgs  (toolArgs derived from caller's args param)
 *
 * Source: src/core.ts
 *   line ~849: toolArgs = typeof args.args === 'object' && … ? args.args : {}
 *   line ~961: { …, args: toolArgs, … }
 *
 * GFR-4 confirmed args is an object (not null/array), but no test has frozen:
 *
 *   (a) That args is `{}` when the caller passes no args param.
 *   (b) That a caller-supplied number value echoes exactly.
 *   (c) That a caller-supplied string value echoes exactly.
 *   (d) That a multi-key args object is echoed completely with no extras.
 *   (e) That args stays `{}` even when the tool's inputSchema has required
 *       properties — i.e., schema defaults are NOT injected into args.
 *
 * A refactor that "helpfully" injects inputSchema default values, adds an
 * `intent` key, or transforms primitive values would pass GFR-4 silently.
 *
 * GFS freezes 5 invariants:
 *
 *   GFS-1  cast:plan args equals `{}` when no args param is given
 *   GFS-2  cast:plan args.limit === 10 when args { limit: 10 } is passed (number echo)
 *   GFS-3  cast:plan args.query === 'SELECT 1' when args { query: 'SELECT 1' } is passed (string echo)
 *   GFS-4  cast:plan args equals the multi-key input exactly — no extra keys injected
 *   GFS-5  cast:plan args is `{}` even when the tool has required inputSchema properties
 *          (schema defaults are NOT injected)
 *
 * Frozen 2026-10-02.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (cast:plan args field,
 *     not the explanation sub-object)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gfs-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
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

// Tool with required inputSchema properties — used for GFS-5 (schema injection guard).
const TOOL_CREATE = {
  name: 'create_stripe_payment',
  description: 'Create a new stripe payment intent or charge',
  inputSchema: {
    type: 'object',
    properties: {
      amount: { type: 'number' },
      currency: { type: 'string' },
    },
    required: ['amount', 'currency'],
  },
  response: { content: [{ type: 'text', text: '{"id":"pi_new"}' }] },
};

const CFG: ServerConfig = {
  id: 'stripe',
  name: 'Stripe',
  type: 'remote',
  access: 'readwrite',
  category: 'ecosystem',
  endpoint: 'https://stripe.com/mcp',
  lazy: true,
};

function makeAgg(suffix: string): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', { tools: [TOOL_LIST, TOOL_BALANCE, TOOL_CREATE], prompts: [], resources: [] });
  const path = dlq();
  return new Aggregator([CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

async function castPlanBody(
  agg: Aggregator,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, confirm: true, ...extra });
  assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body['cast'], 'plan', `expected cast:plan, got ${JSON.stringify(body['cast'])}`);
  return body;
}

// ── GFS-1: no args param → cast:plan.args is empty object ────────────────────

test('GFS-1: cast:plan args equals {} when no args param is given', async () => {
  const agg = makeAgg('gfs-1');
  try {
    const body = await castPlanBody(agg);
    assert.deepEqual(
      body['args'],
      {},
      `GFS-1: cast:plan args must be {} when no args param passed, got ${JSON.stringify(body['args'])}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFS-2: number value echoed exactly ───────────────────────────────────────

test('GFS-2: cast:plan args.limit === 10 when args { limit: 10 } is passed (number echo)', async () => {
  const agg = makeAgg('gfs-2');
  try {
    const body = await castPlanBody(agg, { args: { limit: 10 } });
    const args = body['args'] as Record<string, unknown>;
    assert.equal(
      args['limit'],
      10,
      `GFS-2: cast:plan args.limit must equal 10 (number echo), got ${JSON.stringify(args['limit'])}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFS-3: string value echoed exactly ───────────────────────────────────────

test('GFS-3: cast:plan args.query === \'SELECT 1\' when args { query: \'SELECT 1\' } is passed (string echo)', async () => {
  const agg = makeAgg('gfs-3');
  try {
    const body = await castPlanBody(agg, { args: { query: 'SELECT 1' } });
    const args = body['args'] as Record<string, unknown>;
    assert.equal(
      args['query'],
      'SELECT 1',
      `GFS-3: cast:plan args.query must equal 'SELECT 1' (string echo), got ${JSON.stringify(args['query'])}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFS-4: multi-key args echoed exactly, no injection ───────────────────────

test('GFS-4: cast:plan args equals multi-key input exactly — no extra keys injected', async () => {
  const agg = makeAgg('gfs-4');
  const inputArgs = { page: 2, format: 'json' };
  try {
    const body = await castPlanBody(agg, { args: inputArgs });
    assert.deepEqual(
      body['args'],
      inputArgs,
      `GFS-4: cast:plan args must equal the input args exactly, got ${JSON.stringify(body['args'])}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFS-5: no schema injection even when tool has required properties ─────────

test('GFS-5: cast:plan args is {} even when the winner tool has required inputSchema properties', async () => {
  const backend = new FixtureBackend();
  // Use only TOOL_CREATE (the one with required amount/currency) as the sole tool,
  // with an intent that matches it.
  backend.defineServer('stripe', {
    tools: [TOOL_CREATE],
    prompts: [],
    resources: [],
  });
  const path = dlq();
  const agg = new Aggregator([CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'create stripe payment intent',
      confirm: true,
    });
    assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'plan', `expected cast:plan, got ${JSON.stringify(body['cast'])}`);
    assert.deepEqual(
      body['args'],
      {},
      `GFS-5: cast:plan args must remain {} even when tool has required inputSchema props (no schema injection); got ${JSON.stringify(body['args'])}`,
    );
  } finally { await agg.shutdown(); }
});
