/**
 * GFH drift guard: freeze cast:plan top-level body.score ordinal invariants.
 *
 * GFF froze the same invariants for cast:executed (PR #1693) using body.score
 * (top-level). GFH freezes the plan-path mirror. cast:plan does NOT have a
 * top-level score field — the winner's score lives at resolved.score
 * (GBD-5 confirms its absence at top level). This test ensures the plan path
 * does not regress independently of the executed path.
 *
 * EG freezes `typeof resolved.score === 'number'` — only the type tag. It does
 * not check:
 *
 *   (a) Finiteness: NaN or Infinity would pass typeof === 'number'.
 *   (b) Non-negativity: a negative score cannot come from keyword matching, but
 *       a future change (e.g. a penalty term) could silently violate this.
 *   (c) Filter threshold: every tool in the scored set must exceed 0.1 before
 *       being eligible. The winner therefore always satisfies score > 0.1. A
 *       regression removing the filter would return a near-zero score that still
 *       passes typeof number.
 *   (d) Winner >= all runner-ups: the winner must have the highest (or tied for
 *       highest) score. GFC-2 guards this from the runner-up side for cast:plan;
 *       GFH-4 guards the same invariant from the winner's side for independent
 *       regression coverage.
 *
 * Source: src-stdio/aggregator.ts
 *   cast:plan response includes `resolved: { ..., score: best.score, ... }`.
 *   No top-level score field on the plan path.
 *
 * Fixture: same 3-tool / "list stripe payments" setup as GFF.
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
  return join(tmpdir(), `ch1tty-gfh-${Date.now()}-${++dlqSeq}.jsonl`);
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

// ── GFH-1: winner score is finite ────────────────────────────────────────────

test('GFH-1: cast:plan resolved.score is finite (not NaN, not Infinity)', async () => {
  const agg = makeAgg('gfh-1', MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    const resolved = body['resolved'] as Record<string, unknown>;
    const score = resolved['score'] as number;
    assert.ok(
      Number.isFinite(score),
      `cast:plan resolved.score must be finite, got ${score}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFH-2: winner score is non-negative ──────────────────────────────────────

test('GFH-2: cast:plan resolved.score >= 0 (non-negative)', async () => {
  const agg = makeAgg('gfh-2', MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    const resolved = body['resolved'] as Record<string, unknown>;
    const score = resolved['score'] as number;
    assert.ok(
      score >= 0,
      `cast:plan resolved.score must be >= 0, got ${score}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFH-3: winner score exceeds filter threshold ──────────────────────────────

test('GFH-3: cast:plan resolved.score > 0.1 (filter threshold — winner was eligible)', async () => {
  const agg = makeAgg('gfh-3', MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    const resolved = body['resolved'] as Record<string, unknown>;
    const score = resolved['score'] as number;
    assert.ok(
      score > 0.1,
      `cast:plan resolved.score must be > 0.1 (filter threshold), got ${score}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFH-4: winner score >= all runner-up scores ───────────────────────────────

test('GFH-4: cast:plan resolved.score >= all alternatives[i].score (winner beats runner-ups)', async () => {
  const agg = makeAgg('gfh-4', MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    const resolved = body['resolved'] as Record<string, unknown>;
    const winnerScore = resolved['score'] as number;
    const alternatives = body['alternatives'] as unknown[];
    assert.ok(
      Array.isArray(alternatives) && alternatives.length > 0,
      'alternatives must be a non-empty array for this guard to fire',
    );
    for (const item of alternatives as Record<string, unknown>[]) {
      const altScore = item['score'] as number;
      assert.ok(
        winnerScore >= altScore,
        `cast:plan resolved.score (${winnerScore}) must be >= alternatives[i].score (${altScore})`,
      );
    }
  } finally { await agg.shutdown(); }
});
