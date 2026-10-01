/**
 * GFB drift guard: freeze cast:executed alternatives[i].score finiteness and
 * ordinal invariants.
 *
 * EH (eh-alternatives-item-shape.test.ts) guards:
 *   – cast:executed alternatives[i].score is typeof 'number' (line 164)
 *   – cast:plan alternatives[i].score is finite (Number.isFinite) (line 305)
 *
 * Neither EH nor any subsequent test freezes the score VALUE properties for
 * cast:executed alternatives specifically. A regression that:
 *   (a) emits NaN or Infinity in alternatives[i].score via a scoring edge case
 *       (zero denominator, empty keyword pool, focus-boost overflow)
 *   (b) emits a negative score for an alternative (normalisation inversion)
 *   (c) emits an alternative with a higher score than the winner (violates the
 *       descending sort invariant; e.g. a transposition in the slice)
 *   (d) returns alternatives out of score order (silent sort regression)
 *   (e) includes an alternative scoring ≤ 0.1 (below the filter threshold)
 * would pass EH (only typeof guard for cast:executed) silently.
 *
 * Source: src-stdio/aggregator.ts
 *   scoredTools: computed at line ~1719, filtered > 0.1, sorted descending by score
 *   alternatives: scoredTools.slice(1, 4).map(t => ({ tool, score, description }))
 *   cast:executed: line ~1662
 *
 * GFB freezes (cast:executed alternatives only):
 *
 *   GFB-1  Every alternatives[i].score is Number.isFinite (not NaN, not Infinity)
 *          (EH froze isFinite for cast:plan but not for cast:executed)
 *
 *   GFB-2  Every alternatives[i].score >= 0 (non-negative)
 *          (EH only checks typeof 'number'; NaN and -1 are both typeof 'number')
 *
 *   GFB-3  Every alternatives[i].score <= body.score (winner's score)
 *          (runner-ups are drawn from scoredTools.slice(1) so their scores
 *           must be ≤ scoredTools[0].score; a swap or off-by-one in the slice
 *           would make an alternative outscore the winner)
 *
 *   GFB-4  Alternatives are in non-increasing score order
 *          (scoredTools is sorted descending, so slice(1,4) preserves that
 *           order; a re-sort or map mutation would break this invariant)
 *
 *   GFB-5  Every alternatives[i].score > 0.1 (filter threshold preserved)
 *          (the scoredTools pool filters score > 0.1 before slicing; a
 *           regression removing that filter would expose near-zero alternatives)
 *
 * Fixture: same tool set as GAS — "list stripe payments" (3 terms) with
 * TOOL_LIST as winner and TOOL_BALANCE + TOOL_CREATE as runner-ups.
 *
 * Frozen 2026-10-01.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (alternatives score
 *     ordinal invariants, not explain sub-object fields)
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
  return join(tmpdir(), `ch1tty-gfb-${Date.now()}-${++dlqSeq}.jsonl`);
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

// Winner: matches all 3 intent terms → highest scorer → cast:executed resolved tool.
const TOOL_LIST = {
  name: 'list_stripe_payments',
  description: 'List recent stripe payment intents',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text', text: '{"data":[]}' }] },
};

// Runner-up 1: "stripe" + "payment" in name+description → score > 0.1 → alternative.
const TOOL_BALANCE = {
  name: 'get_stripe_balance',
  description: 'Get stripe account balance for billing and payments',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text', text: '{"available":[]}' }] },
};

// Runner-up 2: "stripe" + "payment" in name+description → score > 0.1 → alternative.
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

// ── GFB-1: alternatives[i].score is Number.isFinite ──────────────────────────

test('GFB-1: cast:executed alternatives[i].score is finite (not NaN, not Infinity)', async () => {
  const agg = makeAgg('gfb-1', MULTI_TOOLS);
  try {
    const body = await castExecuted(agg);
    const alternatives = body['alternatives'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(alternatives) && alternatives.length > 0,
      'multi-tool fixture must yield at least one alternative');
    for (let i = 0; i < alternatives.length; i++) {
      const s = alternatives[i]!['score'];
      assert.ok(
        typeof s === 'number' && Number.isFinite(s),
        `alternatives[${i}].score must be finite, got ${String(s)}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GFB-2: alternatives[i].score >= 0 ────────────────────────────────────────

test('GFB-2: cast:executed alternatives[i].score >= 0 (non-negative)', async () => {
  const agg = makeAgg('gfb-2', MULTI_TOOLS);
  try {
    const body = await castExecuted(agg);
    const alternatives = body['alternatives'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(alternatives) && alternatives.length > 0,
      'multi-tool fixture must yield at least one alternative');
    for (let i = 0; i < alternatives.length; i++) {
      const s = alternatives[i]!['score'] as number;
      assert.ok(s >= 0, `alternatives[${i}].score must be >= 0, got ${s}`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GFB-3: alternatives[i].score <= body.score (runner-up ≤ winner) ──────────

test('GFB-3: cast:executed alternatives[i].score <= winner score', async () => {
  const agg = makeAgg('gfb-3', MULTI_TOOLS);
  try {
    const body = await castExecuted(agg);
    const winnerScore = body['score'] as number;
    const alternatives = body['alternatives'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(alternatives) && alternatives.length > 0,
      'multi-tool fixture must yield at least one alternative');
    for (let i = 0; i < alternatives.length; i++) {
      const s = alternatives[i]!['score'] as number;
      assert.ok(
        s <= winnerScore,
        `alternatives[${i}].score(${s}) must be <= winner score(${winnerScore}) — runner-ups must not outscore the winner`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GFB-4: alternatives in non-increasing score order ────────────────────────

test('GFB-4: cast:executed alternatives are in non-increasing score order', async () => {
  const agg = makeAgg('gfb-4', MULTI_TOOLS);
  try {
    const body = await castExecuted(agg);
    const alternatives = body['alternatives'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(alternatives) && alternatives.length >= 2,
      'multi-tool fixture must yield ≥ 2 alternatives to test ordering');
    for (let i = 1; i < alternatives.length; i++) {
      const prev = alternatives[i - 1]!['score'] as number;
      const curr = alternatives[i]!['score'] as number;
      assert.ok(
        prev >= curr,
        `alternatives[${i - 1}].score(${prev}) must be >= alternatives[${i}].score(${curr}) — alternatives must be in non-increasing score order`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GFB-5: alternatives[i].score > 0.1 (filter threshold preserved) ──────────

test('GFB-5: cast:executed alternatives[i].score > 0.1 (filter threshold preserved)', async () => {
  const agg = makeAgg('gfb-5', MULTI_TOOLS);
  try {
    const body = await castExecuted(agg);
    const alternatives = body['alternatives'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(alternatives) && alternatives.length > 0,
      'multi-tool fixture must yield at least one alternative');
    for (let i = 0; i < alternatives.length; i++) {
      const s = alternatives[i]!['score'] as number;
      assert.ok(
        s > 0.1,
        `alternatives[${i}].score(${s}) must be > 0.1 — the scoredTools filter threshold must be preserved for alternatives`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});
