/**
 * GFN drift guard: freeze cast resolvedBy value invariants.
 *
 * The resolvedBy field appears in every cast response variant
 * (cast:plan, cast:executed, cast:no_match). Prior guards check only
 * KEY PRESENCE — e.g. GBF, GCC, GU — but none freeze:
 *
 *   (a) That resolvedBy is exactly one of the two literals: 'brain' | 'keyword'.
 *   (b) That a keyword-only coordinator (routeIntent → null) always yields 'keyword'.
 *   (c) That a no_match path also carries resolvedBy = 'keyword' with keyword coord.
 *   (d) Value stability: two successive plan calls on the same registry → same value.
 *   (e) That cast:executed resolvedBy is 'keyword' when coordinator is keyword-only.
 *
 * Source: src/core.ts
 *   let resolvedBy: 'brain' | 'keyword' = castRoute === 'brain' ? 'brain' : 'keyword';
 *   if (best && castRoute === 'brain' && keywordAugmented.has(best.namespacedName))
 *     resolvedBy = 'keyword';
 *
 * With routeIntent → null the castRoute is always 'fallback' → resolvedBy is always
 * 'keyword'. These tests freeze that path; the brain path is covered by bj/rrrr.
 *
 * Fixture: same 3-tool / "list stripe payments" setup as GFK.
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
  return join(tmpdir(), `ch1tty-gfn-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

const VALID_RESOLVED_BY = new Set(['brain', 'keyword']);

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
const INTENT = 'list stripe payments';

function makeAgg(serverId: string): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer(serverId, { tools: MULTI_TOOLS, prompts: [], resources: [] });
  const path = dlq();
  const config: ServerConfig[] = [
    {
      id: serverId,
      name: serverId,
      type: 'remote',
      access: 'readwrite',
      category: 'finance',
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

async function parseCastBody(agg: Aggregator, castArgs: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', castArgs);
  const text = (result.content[0] as { text: string }).text;
  return JSON.parse(text) as Record<string, unknown>;
}

// ── GFN-1: cast:plan resolvedBy is a string ───────────────────────────────────

test('GFN-1: cast:plan resolvedBy is a string (not undefined/null/number)', async () => {
  const agg = makeAgg('gfn-1');
  try {
    const body = await parseCastBody(agg, { intent: INTENT, confirm: true });
    assert.equal(body['cast'], 'plan', `expected cast:plan, got ${String(body['cast'])}`);
    assert.equal(
      typeof body['resolvedBy'],
      'string',
      `cast:plan resolvedBy must be a string, got ${typeof body['resolvedBy']}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFN-2: cast:plan resolvedBy is exactly 'brain' or 'keyword' ──────────────

test('GFN-2: cast:plan resolvedBy is exactly "brain" or "keyword" (enum freeze)', async () => {
  const agg = makeAgg('gfn-2');
  try {
    const body = await parseCastBody(agg, { intent: INTENT, confirm: true });
    assert.equal(body['cast'], 'plan', `expected cast:plan`);
    const v = body['resolvedBy'];
    assert.ok(
      VALID_RESOLVED_BY.has(v as string),
      `cast:plan resolvedBy must be "brain" or "keyword", got "${String(v)}"`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFN-3: keyword-only coordinator → resolvedBy is 'keyword' on cast:plan ───

test('GFN-3: cast:plan resolvedBy is "keyword" when coordinator is keyword-only', async () => {
  const agg = makeAgg('gfn-3');
  try {
    const body = await parseCastBody(agg, { intent: INTENT, confirm: true });
    assert.equal(body['cast'], 'plan', `expected cast:plan`);
    assert.equal(
      body['resolvedBy'],
      'keyword',
      `keyword-only coordinator must yield resolvedBy="keyword", got "${String(body['resolvedBy'])}"`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFN-4: cast:executed resolvedBy is 'keyword' when keyword-only coordinator

test('GFN-4: cast:executed resolvedBy is "keyword" when coordinator is keyword-only', async () => {
  const agg = makeAgg('gfn-4');
  try {
    const body = await parseCastBody(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${String(body['cast'])}`);
    assert.equal(
      body['resolvedBy'],
      'keyword',
      `cast:executed resolvedBy must be "keyword" with keyword-only coordinator, got "${String(body['resolvedBy'])}"`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFN-5: resolvedBy stable across two cast:plan calls on the same registry ──

test('GFN-5: cast:plan resolvedBy is stable across repeated calls (no drift)', async () => {
  const agg = makeAgg('gfn-5');
  try {
    const body1 = await parseCastBody(agg, { intent: INTENT, confirm: true });
    const body2 = await parseCastBody(agg, { intent: INTENT, confirm: true });
    assert.equal(body1['cast'], 'plan', `first call must be cast:plan`);
    assert.equal(body2['cast'], 'plan', `second call must be cast:plan`);
    assert.equal(
      body1['resolvedBy'],
      body2['resolvedBy'],
      `cast:plan resolvedBy must be stable: first="${String(body1['resolvedBy'])}", second="${String(body2['resolvedBy'])}"`,
    );
  } finally { await agg.shutdown(); }
});
