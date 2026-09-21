/**
 * GX drift guard: freeze the cast:plan alternatives always-present invariant.
 *
 * Source asymmetry (aggregator.ts):
 *   cast:plan    line ~1616: `alternatives,`
 *                            — unconditionally spread; always in the response object,
 *                              even as [] when there are no runners-up.
 *   cast:executed line ~1665: `...(alternatives.length > 0 ? { alternatives } : {})`
 *                            — conditionally omitted; absent from the response when empty.
 *
 * EH froze alternatives ITEM shapes (both paths) but its single-tool assertions accept
 * "absent OR empty" for both paths — it does not distinguish the asymmetry above.
 * GW froze cast:plan's top-level key set using a 3-tool fixture (alternatives non-empty),
 * which passes whether or not the single-tool path keeps alternatives present.
 * A refactor that makes cast:plan match cast:executed (conditional spread) would:
 *   — pass all EH single-tool tests (absent satisfies "absent OR empty")
 *   — pass GW-1 (multi-tool fixture — alternatives still non-empty and present)
 *   — silently break the always-present contract
 *
 * GX closes those gaps:
 *
 *   GX-1  cast:plan single-tool: `alternatives` key IS present in the response
 *          (not absent — distinguishes from EH which allows absent).
 *
 *   GX-2  cast:plan single-tool: `alternatives` value is an empty array
 *          (proves the key is present as [], not null, not absent).
 *
 *   GX-3  cast:executed single-tool: `alternatives` key IS ABSENT from the response
 *          (proves cast:executed omits alternatives when empty — symmetric freeze to GX-1/GX-2,
 *          ensuring a refactor that makes both paths identical would fail at least one of GX-1/GX-3).
 *
 *   GX-4  cast:plan multi-tool: `alternatives` is a non-empty array and each item
 *          has exactly {description, score, tool} — confirming the non-empty case
 *          is also present and well-formed (cross-check with EH item shape via key set).
 *
 * Actual shapes (probed 2026-09-21):
 *   cast:plan  single-tool   → alternatives: []         (key present, empty)
 *   cast:plan  3-tool stripe → alternatives: [{…},{…}]  (key present, 2 items)
 *   cast:executed single-tool → no `alternatives` key    (absent)
 *
 * Frozen 2026-09-21.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (alternatives array, not explanation)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Frozen key set for an alternatives[] item ─────────────────────────────────

const ALT_ITEM_KEYS: readonly string[] = ['description', 'score', 'tool'];

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gx-${Date.now()}-${++_seq}.jsonl`);
}

/** Single-tool aggregator: only 1 tool in the registry → alternatives = []. */
function makeSingleAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', {
    tools: [FIXTURE_SERVERS.stripe.tools[0]!],
  });
  return new Aggregator(
    [{ id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true }],
    { backendFactory: () => backend, embedEnabled: false, ledgerDlqPath: dlq() },
  );
}

/** Multi-tool aggregator: 3 stripe tools → alternatives = scoredTools.slice(1, 4). */
function makeMultiAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(
    [{ id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true }],
    { backendFactory: () => backend, embedEnabled: false, ledgerDlqPath: dlq() },
  );
}

async function castPlan(agg: Aggregator, intent: string): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent, confirm: true });
  assert.equal(result.isError, undefined, `cast:plan must not error for "${intent}"`);
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body['cast'], 'plan', `expected cast:plan, got cast:${String(body['cast'])}`);
  return body;
}

async function castExecuted(agg: Aggregator, intent: string): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent });
  assert.equal(result.isError, undefined, `cast:executed must not error for "${intent}"`);
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body['cast'], 'executed', `expected cast:executed, got cast:${String(body['cast'])}`);
  return body;
}

const INTENT = 'list stripe payments';

// ── GX-1: cast:plan single-tool — alternatives IS present ────────────────────

test('GX-1: cast:plan single-tool: alternatives key IS present (not absent)', async () => {
  const agg = makeSingleAgg();
  try {
    const body = await castPlan(agg, INTENT);
    assert.ok(
      Object.prototype.hasOwnProperty.call(body, 'alternatives'),
      'cast:plan must include the alternatives key even when registry has only one tool',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GX-2: cast:plan single-tool — alternatives is [] ─────────────────────────

test('GX-2: cast:plan single-tool: alternatives value is an empty array', async () => {
  const agg = makeSingleAgg();
  try {
    const body = await castPlan(agg, INTENT);
    const alts = body['alternatives'];
    assert.ok(Array.isArray(alts), `alternatives must be an array, got ${typeof alts}`);
    assert.equal((alts as unknown[]).length, 0, `alternatives must be empty [] when there is only one tool, got length=${(alts as unknown[]).length}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GX-3: cast:executed single-tool — alternatives IS absent ─────────────────

test('GX-3: cast:executed single-tool: alternatives key IS absent', async () => {
  const agg = makeSingleAgg();
  try {
    const body = await castExecuted(agg, INTENT);
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'alternatives'),
      'cast:executed must NOT include the alternatives key when there are no runners-up',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GX-4: cast:plan multi-tool — alternatives is non-empty, items well-formed ─

test('GX-4: cast:plan multi-tool: alternatives is a non-empty array with exactly {description, score, tool} per item', async () => {
  const agg = makeMultiAgg();
  try {
    const body = await castPlan(agg, INTENT);
    const alts = body['alternatives'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(alts), `alternatives must be an array in multi-tool case, got ${typeof alts}`);
    assert.ok(alts.length > 0, `alternatives must be non-empty in multi-tool case (stripe has 3 tools), got length=${alts.length}`);
    for (const item of alts) {
      const actual = Object.keys(item).sort();
      const expected = [...ALT_ITEM_KEYS].sort();
      assert.deepEqual(
        actual,
        expected,
        `alternatives item must have exactly ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );
      assert.equal(typeof item['tool'], 'string', 'alternatives item.tool must be a string');
      assert.ok((item['tool'] as string).includes('/'), `alternatives item.tool must be namespaced, got "${item['tool']}"`);
      assert.equal(typeof item['score'], 'number', 'alternatives item.score must be a number');
      assert.ok(Number.isFinite(item['score'] as number), `alternatives item.score must be finite, got ${item['score']}`);
      assert.ok((item['score'] as number) >= 0, `alternatives item.score must be >= 0, got ${item['score']}`);
      assert.equal(typeof item['description'], 'string', 'alternatives item.description must be a string');
    }
  } finally {
    await agg.shutdown();
  }
});
