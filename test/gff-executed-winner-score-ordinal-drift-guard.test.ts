/**
 * GFF drift guard: freeze cast:executed top-level body.score ordinal invariants.
 *
 * EG freezes `typeof body.score === 'number'` for cast:executed — but only the
 * type tag. It does not check:
 *
 *   (a) Finiteness: NaN or Infinity would pass typeof === 'number'.
 *   (b) Non-negativity: a negative score cannot come from keyword matching, but
 *       a future change (e.g. a penalty term) could silently violate this.
 *   (c) Filter threshold: every tool in the scored set must exceed 0.1 before
 *       being eligible for execution. The winner therefore always satisfies
 *       score > 0.1. A regression removing the filter threshold would return
 *       a near-zero score that would still be typeof number.
 *   (d) Winner ≥ all runner-ups: the winner is scoredTools[0], the runner-ups
 *       are scoredTools[1..4]. The winner must have the highest (or tied for
 *       highest) score. GFB-3 guards this from the runner-up side
 *       (alternatives[i].score <= body.score); GFF-4 guards the same invariant
 *       from the winner's side for independent regression coverage.
 *
 * Source: src-stdio/aggregator.ts
 *   cast:executed response includes `score: best.score` at top level.
 *   GFB confirmed alternatives[i].score <= body.score; GFF freezes the
 *   intrinsic ordinal properties of body.score itself.
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

async function castExecuted(agg: Aggregator): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT });
  assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body['cast'], 'executed', `expected cast:executed, got ${String(body['cast'])}`);
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

// ── GFF-1: winner score is finite ────────────────────────────────────────────

test('GFF-1: cast:executed body.score is finite (not NaN, not Infinity)', async () => {
  const agg = makeAgg('gff-1', MULTI_TOOLS);
  try {
    const body = await castExecuted(agg);
    const score = body['score'] as number;
    assert.ok(
      Number.isFinite(score),
      `cast:executed body.score must be finite, got ${score}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFF-2: winner score is non-negative ──────────────────────────────────────

test('GFF-2: cast:executed body.score >= 0 (non-negative)', async () => {
  const agg = makeAgg('gff-2', MULTI_TOOLS);
  try {
    const body = await castExecuted(agg);
    const score = body['score'] as number;
    assert.ok(
      score >= 0,
      `cast:executed body.score must be >= 0, got ${score}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFF-3: winner score exceeds filter threshold ──────────────────────────────

test('GFF-3: cast:executed body.score > 0.1 (filter threshold — winner was eligible)', async () => {
  const agg = makeAgg('gff-3', MULTI_TOOLS);
  try {
    const body = await castExecuted(agg);
    const score = body['score'] as number;
    assert.ok(
      score > 0.1,
      `cast:executed body.score must be > 0.1 (filter threshold), got ${score}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFF-4: winner score >= all runner-up scores ───────────────────────────────

test('GFF-4: cast:executed body.score >= all alternatives[i].score (winner beats runner-ups)', async () => {
  const agg = makeAgg('gff-4', MULTI_TOOLS);
  try {
    const body = await castExecuted(agg);
    const winnerScore = body['score'] as number;
    const alternatives = body['alternatives'] as unknown[];
    assert.ok(
      Array.isArray(alternatives) && alternatives.length > 0,
      'alternatives must be a non-empty array for this guard to fire',
    );
    for (const item of alternatives as Record<string, unknown>[]) {
      const altScore = item['score'] as number;
      assert.ok(
        winnerScore >= altScore,
        `cast:executed body.score (${winnerScore}) must be >= alternatives[i].score (${altScore})`,
      );
    }
  } finally { await agg.shutdown(); }
});
