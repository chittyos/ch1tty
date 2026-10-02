/**
 * GFQ drift guard: freeze cast mode field value invariants.
 *
 * Background
 * ----------
 * Every cast response includes a `cast` key that identifies the response mode:
 *
 *   confirm:true  → cast === "plan"
 *   confirm:false → cast === "executed"
 *
 * Source: src/core.ts
 *   plan path:     { cast: 'plan', ... }
 *   executed path: { cast: 'executed', ... }
 *
 * Why this matters
 * ----------------
 * The `cast` field is the primary discriminant consumers use to branch on
 * plan-vs-executed output shape. A rename ("plan" → "confirm", "executed" →
 * "run") or case change ("plan" → "Plan") would silently break every consumer
 * that switches on this field. No prior GF* test freezes the literal string
 * value of `cast` as its PRIMARY invariant — earlier tests use it only as a
 * precondition guard.
 *
 * Prior GF* tests that reference body['cast']
 * --------------------------------------------
 *   GFA  — intent echo (outer body key present, value is precondition)
 *   GFB  — outer content passthrough (plan precondition)
 *   GFC  — plan alternatives score ordinal (plan precondition)
 *   GFG  — plan alternatives description (plan precondition)
 *   GFH  — plan winner score ordinal (plan precondition)
 *   GFK  — plan resolved.category (plan precondition)
 *   GFP  — executed.resolved as string (executed precondition)
 *
 * GFQ closes the gap: 5 invariants frozen with `cast` as the primary target.
 *
 *   GFQ-1  cast:plan  → body['cast'] === "plan"    (exact string, not "Plan")
 *   GFQ-2  cast:executed → body['cast'] === "executed"  (exact string)
 *   GFQ-3  cast mode is typeof string (not undefined, not null, not number)
 *   GFQ-4  confirm:true → "plan"; confirm:false → "executed" on same registry
 *          (mode ↔ confirm-param correlation regression guard)
 *   GFQ-5  cast mode is stable across two calls (no non-deterministic drift)
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
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gfq-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

const SERVER_ID = 'stripe';
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

const CFG: ServerConfig = {
  id: SERVER_ID,
  name: 'Stripe',
  type: 'remote',
  access: 'readwrite',
  category: 'ecosystem',
  endpoint: 'https://stripe.com/mcp',
  lazy: true,
};

function makeAgg(suffix: string): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer(SERVER_ID, { tools: MULTI_TOOLS, prompts: [], resources: [] });
  const path = dlq();
  return new Aggregator([CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

async function castBody(agg: Aggregator, confirm: boolean): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, confirm });
  assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

// ── GFQ-1: cast:plan mode is exactly "plan" ───────────────────────────────────

test('GFQ-1: cast:plan response — cast field is exactly "plan" (literal string)', async () => {
  const agg = makeAgg('gfq-1');
  try {
    const body = await castBody(agg, true);
    assert.equal(
      body['cast'],
      'plan',
      `cast:plan must have cast === "plan", got ${JSON.stringify(body['cast'])}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFQ-2: cast:executed mode is exactly "executed" ──────────────────────────

test('GFQ-2: cast:executed response — cast field is exactly "executed" (literal string)', async () => {
  const agg = makeAgg('gfq-2');
  try {
    const body = await castBody(agg, false);
    assert.equal(
      body['cast'],
      'executed',
      `cast:executed must have cast === "executed", got ${JSON.stringify(body['cast'])}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFQ-3: cast mode is always typeof string ──────────────────────────────────

test('GFQ-3: cast mode field is always typeof string (not undefined/null/number)', async () => {
  const agg = makeAgg('gfq-3');
  try {
    const planBody = await castBody(agg, true);
    assert.equal(
      typeof planBody['cast'],
      'string',
      `cast:plan cast field must be a string, got ${typeof planBody['cast']}`,
    );
    const execBody = await castBody(agg, false);
    assert.equal(
      typeof execBody['cast'],
      'string',
      `cast:executed cast field must be a string, got ${typeof execBody['cast']}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFQ-4: confirm:true → "plan"; confirm:false → "executed" (same registry) ──

test('GFQ-4: confirm:true yields mode "plan"; confirm:false yields "executed" — mode↔confirm correlation', async () => {
  const agg = makeAgg('gfq-4');
  try {
    const planBody = await castBody(agg, true);
    const execBody = await castBody(agg, false);
    assert.equal(
      planBody['cast'],
      'plan',
      `confirm:true must yield cast === "plan", got ${JSON.stringify(planBody['cast'])}`,
    );
    assert.equal(
      execBody['cast'],
      'executed',
      `confirm:false must yield cast === "executed", got ${JSON.stringify(execBody['cast'])}`,
    );
    assert.notEqual(
      planBody['cast'],
      execBody['cast'],
      'confirm:true and confirm:false must yield different cast modes',
    );
  } finally { await agg.shutdown(); }
});

// ── GFQ-5: cast mode is stable across repeated calls ─────────────────────────

test('GFQ-5: cast mode is stable across repeated calls on the same registry (no drift)', async () => {
  const agg = makeAgg('gfq-5');
  try {
    const body1 = await castBody(agg, true);
    const body2 = await castBody(agg, true);
    assert.equal(
      body1['cast'],
      body2['cast'],
      `cast mode must be stable: first call ${JSON.stringify(body1['cast'])}, second call ${JSON.stringify(body2['cast'])}`,
    );
  } finally { await agg.shutdown(); }
});
