/**
 * GFR drift guard: freeze plan/executed structural asymmetry for hint, args, and score location.
 *
 * Background
 * ----------
 * cast:plan and cast:executed carry a specific set of PLAN-ONLY keys (hint, args)
 * and differ in WHERE the winner's score lives:
 *
 *   cast:plan     → hint: <string>         (navigation hint for the caller)
 *                   args: <object>         (parsed tool arguments)
 *                   resolved.score         (score nested inside resolved object)
 *                   NO top-level `score` key
 *
 *   cast:executed → NO `hint` key          (tool already executed — no navigation needed)
 *                   NO `args` key          (args were consumed by the execution)
 *                   score: <number>        (score at top level, NOT inside resolved)
 *
 * Source: src/core.ts
 *   plan path (~line 960):
 *     { cast: 'plan', ..., resolved: { ..., score: best.score, ... }, args: toolArgs,
 *       hint: 'Call cast again without confirm...', ... }
 *   executed path (~line 974):
 *     { cast: 'executed', ..., resolved: best.namespacedName, score: best.score, ... }
 *     (no hint, no args)
 *
 * Why this matters
 * ----------------
 * A refactor that "unifies" the plan/executed response shapes could silently add
 * `hint` or `args` to the executed path (confusing consumers that switch on `cast`).
 * Conversely, removing `hint` or `args` from the plan path is an equally silent
 * breaking change for consumers that depend on them.
 *
 * GFH (PR #1693) already confirmed that cast:plan has NO top-level `score` key
 * (score is nested inside resolved). GFF confirmed executed HAS top-level `score`.
 * GFR closes the remaining gap: hint/args presence/absence is unguarded across both paths.
 *
 * GFR freezes 5 invariants:
 *
 *   GFR-1  cast:executed body does NOT have a `hint` key
 *   GFR-2  cast:executed body does NOT have an `args` key
 *   GFR-3  cast:plan body DOES have a `hint` key and it is a non-empty string
 *   GFR-4  cast:plan body DOES have an `args` key and it is an object (not null/array)
 *   GFR-5  score-location asymmetry: executed has top-level `score` (number),
 *          plan has NO top-level `score` (score lives inside resolved)
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
  return join(tmpdir(), `ch1tty-gfr-${Date.now()}-${++dlqSeq}.jsonl`);
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

// ── GFR-1: cast:executed has NO `hint` key ────────────────────────────────────

test('GFR-1: cast:executed body — no `hint` key (hint is plan-only)', async () => {
  const agg = makeAgg('gfr-1');
  try {
    const body = await castBody(agg, false);
    assert.equal(
      body['cast'],
      'executed',
      `precondition: expected cast:executed, got ${JSON.stringify(body['cast'])}`,
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'hint'),
      false,
      `cast:executed must NOT have a top-level 'hint' key, but got: ${JSON.stringify(body['hint'])}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFR-2: cast:executed has NO `args` key ────────────────────────────────────

test('GFR-2: cast:executed body — no `args` key (args is plan-only)', async () => {
  const agg = makeAgg('gfr-2');
  try {
    const body = await castBody(agg, false);
    assert.equal(
      body['cast'],
      'executed',
      `precondition: expected cast:executed, got ${JSON.stringify(body['cast'])}`,
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'args'),
      false,
      `cast:executed must NOT have a top-level 'args' key, but got: ${JSON.stringify(body['args'])}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFR-3: cast:plan DOES have `hint` key (non-empty string) ─────────────────

test('GFR-3: cast:plan body — `hint` key is present and is a non-empty string', async () => {
  const agg = makeAgg('gfr-3');
  try {
    const body = await castBody(agg, true);
    assert.equal(
      body['cast'],
      'plan',
      `precondition: expected cast:plan, got ${JSON.stringify(body['cast'])}`,
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'hint'),
      true,
      'cast:plan must have a top-level `hint` key',
    );
    assert.equal(
      typeof body['hint'],
      'string',
      `cast:plan hint must be a string, got ${typeof body['hint']}`,
    );
    assert.ok(
      (body['hint'] as string).length > 0,
      'cast:plan hint must be a non-empty string',
    );
  } finally { await agg.shutdown(); }
});

// ── GFR-4: cast:plan DOES have `args` key (plain object, not null/array) ─────

test('GFR-4: cast:plan body — `args` key is present and is a plain object', async () => {
  const agg = makeAgg('gfr-4');
  try {
    const body = await castBody(agg, true);
    assert.equal(
      body['cast'],
      'plan',
      `precondition: expected cast:plan, got ${JSON.stringify(body['cast'])}`,
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'args'),
      true,
      'cast:plan must have a top-level `args` key',
    );
    assert.equal(
      typeof body['args'],
      'object',
      `cast:plan args must be typeof 'object', got ${typeof body['args']}`,
    );
    assert.notEqual(body['args'], null, 'cast:plan args must not be null');
    assert.equal(
      Array.isArray(body['args']),
      false,
      'cast:plan args must be a plain object, not an array',
    );
  } finally { await agg.shutdown(); }
});

// ── GFR-5: score-location asymmetry ──────────────────────────────────────────

test('GFR-5: score-location asymmetry — executed has top-level score (number); plan has no top-level score', async () => {
  const agg = makeAgg('gfr-5');
  try {
    const execBody = await castBody(agg, false);
    const planBody = await castBody(agg, true);

    // executed: score is at the top level and is a number
    assert.equal(
      Object.prototype.hasOwnProperty.call(execBody, 'score'),
      true,
      'cast:executed must have a top-level `score` key',
    );
    assert.equal(
      typeof execBody['score'],
      'number',
      `cast:executed top-level score must be typeof 'number', got ${typeof execBody['score']}`,
    );

    // plan: NO top-level score key (score lives inside resolved)
    assert.equal(
      Object.prototype.hasOwnProperty.call(planBody, 'score'),
      false,
      `cast:plan must NOT have a top-level 'score' key (score lives in resolved.score), but got: ${JSON.stringify(planBody['score'])}`,
    );

    // plan: score IS inside resolved
    const resolved = planBody['resolved'] as Record<string, unknown> | undefined;
    assert.ok(
      resolved !== null && typeof resolved === 'object' && !Array.isArray(resolved),
      'cast:plan resolved must be an object',
    );
    assert.equal(
      typeof resolved!['score'],
      'number',
      `cast:plan resolved.score must be typeof 'number', got ${typeof resolved!['score']}`,
    );
  } finally { await agg.shutdown(); }
});
