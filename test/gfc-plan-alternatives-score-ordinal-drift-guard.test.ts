/**
 * GFC drift guard: freeze cast:plan alternatives[i].score ordinal invariants.
 *
 * Prior coverage:
 *   GAS (gas-alternatives-executed-exact-keyset-drift-guard.test.ts)
 *       froze the exact key set {description, score, tool} for alternatives items
 *       in both cast:executed and cast:plan.
 *   EH (eh-alternatives-item-shape.test.ts)
 *       froze cast:plan alternatives[i].score as `typeof === 'number' && isFinite`
 *       (cast:plan describe block, line ~305).
 *   GFB (gfb-executed-alternatives-score-ordinal-drift-guard.test.ts)
 *       froze cast:executed alternatives[i].score ordinal invariants:
 *       non-negative, runner-up ≤ winner (body.score), non-increasing order,
 *       > 0.1 threshold.
 *
 * Gap: EH froze finiteness for cast:plan, but the ordinal invariants are
 * unfrozen on the plan path:
 *
 *   (a) alternatives[i].score >= 0 — non-negativity guard. A sign-flip
 *       regression in keyword scoring would be invisible to EH.
 *
 *   (b) alternatives[i].score <= resolved.score — runner-up must not exceed
 *       the winner. cast:plan embeds winner score inside `resolved.score`
 *       (no top-level `score` on plan — GBD-5 confirms its absence).
 *       A transposition that emits runner-up scores in the winner slot and
 *       vice-versa would pass EH and GAS.
 *
 *   (c) Non-increasing score order — alternatives must be sorted descending.
 *       A regression re-sorting by tool name instead of score would pass EH.
 *
 *   (d) alternatives[i].score > 0.1 — the aggregator filter at
 *       src-stdio/aggregator.ts line ~1384 drops scoredTools with score ≤ 0.1
 *       before slicing. A regression that bypasses or weakens this filter on
 *       the plan path would go undetected.
 *
 * GFC freezes (cast:plan only — cast:executed covered by GFB):
 *
 *   GFC-1  alternatives[i].score >= 0 (non-negative) for all items.
 *          Parallel to GFB-2 on the plan path.
 *
 *   GFC-2  alternatives[i].score <= resolved.score (runner-up ≤ winner).
 *          Uses body.resolved.score (plan embeds winner score in resolved
 *          sub-object; no top-level score field on cast:plan).
 *          Parallel to GFB-3 adapted for the plan response shape.
 *
 *   GFC-3  alternatives items are in non-increasing score order.
 *          Parallel to GFB-4 on the plan path.
 *
 *   GFC-4  alternatives[i].score > 0.1 (filter threshold preserved).
 *          Parallel to GFB-5 on the plan path.
 *
 * Fixture: same tools as GAS/GFB — "list stripe payments" intent, 3 tools
 * (TOOL_LIST wins, TOOL_BALANCE and TOOL_CREATE score above 0.1 as alternatives).
 * Cast is invoked with confirm:true → cast:plan (not cast:executed).
 * KeywordOnlyCoordinator (no brain) keeps scoring deterministic.
 *
 * Source: src-stdio/aggregator.ts
 *   alternatives filter: line ~1384  (scoredTools.filter(t => t.score > 0.1))
 *   alternatives map:    line ~1389  ({tool, score, description})
 *   cast:plan body:      line ~1617  (resolved: { tool, score }, alternatives, ...)
 *
 * Frozen 2026-10-01.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (alternatives item
 *     ordinal invariants, not explain sub-object fields)
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
  return join(tmpdir(), `ch1tty-gfc-${Date.now()}-${++dlqSeq}.jsonl`);
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

async function castPlan(
  agg: Aggregator,
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', {
    intent: INTENT,
    confirm: true,
  });
  assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body['cast'], 'plan', `expected cast:plan, got cast="${String(body['cast'])}"`);
  return body;
}

// Intent: "list stripe payments" — 3 terms
const INTENT = 'list stripe payments';

// Winning tool: matches all 3 intent terms → highest scorer.
const TOOL_LIST = {
  name: 'list_stripe_payments',
  description: 'List recent stripe payment intents',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text', text: '{"data":[]}' }] },
};

// Runner-up 1: "stripe" + "payment" → scores above 0.1 → appears as alternative.
const TOOL_BALANCE = {
  name: 'get_stripe_balance',
  description: 'Get stripe account balance for billing and payments',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text', text: '{"available":[]}' }] },
};

// Runner-up 2: "stripe" + "payment" → scores above 0.1 → appears as alternative.
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

// ── GFC-1: alternatives[i].score >= 0 ────────────────────────────────────────

test('GFC-1: cast:plan alternatives[i].score >= 0 (non-negative) for all items', async () => {
  const agg = makeAgg('gfc-plan-1', MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    const alternatives = body['alternatives'] as unknown[];
    assert.ok(Array.isArray(alternatives) && alternatives.length > 0, 'alternatives must be a non-empty array for multi-tool fixture');
    for (const item of alternatives as Record<string, unknown>[]) {
      const score = item['score'] as number;
      assert.ok(
        score >= 0,
        `cast:plan alternatives[i].score must be >= 0, got ${score}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GFC-2: alternatives[i].score <= resolved.score ────────────────────────────

test('GFC-2: cast:plan alternatives[i].score <= resolved.score (runner-up does not exceed winner)', async () => {
  const agg = makeAgg('gfc-plan-2', MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    const alternatives = body['alternatives'] as unknown[];
    assert.ok(Array.isArray(alternatives) && alternatives.length > 0, 'alternatives must be non-empty for multi-tool fixture');
    const resolvedScore = (body['resolved'] as { score: number }).score;
    assert.ok(
      typeof resolvedScore === 'number',
      `cast:plan resolved.score must be a number, got ${typeof resolvedScore}`,
    );
    for (const item of alternatives as Record<string, unknown>[]) {
      const score = item['score'] as number;
      assert.ok(
        score <= resolvedScore,
        `cast:plan alternatives[i].score (${score}) must be <= resolved.score (${resolvedScore}) — runner-up must not exceed winner`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GFC-3: non-increasing score order ────────────────────────────────────────

test('GFC-3: cast:plan alternatives are in non-increasing score order', async () => {
  const agg = makeAgg('gfc-plan-3', MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    const alternatives = body['alternatives'] as unknown[];
    assert.ok(Array.isArray(alternatives) && alternatives.length > 1, 'need ≥ 2 alternatives to test ordering');
    const scores = (alternatives as Record<string, unknown>[]).map((item) => item['score'] as number);
    for (let i = 1; i < scores.length; i++) {
      assert.ok(
        scores[i]! <= scores[i - 1]!,
        `cast:plan alternatives must be in non-increasing score order: scores[${i - 1}]=${scores[i - 1]} > scores[${i}]=${scores[i]} — ordering broken`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GFC-4: alternatives[i].score > 0.1 ───────────────────────────────────────

test('GFC-4: cast:plan alternatives[i].score > 0.1 (filter threshold preserved)', async () => {
  const agg = makeAgg('gfc-plan-4', MULTI_TOOLS);
  try {
    const body = await castPlan(agg);
    const alternatives = body['alternatives'] as unknown[];
    assert.ok(Array.isArray(alternatives) && alternatives.length > 0, 'alternatives must be non-empty for multi-tool fixture');
    for (const item of alternatives as Record<string, unknown>[]) {
      const score = item['score'] as number;
      assert.ok(
        score > 0.1,
        `cast:plan alternatives[i].score must be > 0.1 (aggregator filter threshold), got ${score}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});
