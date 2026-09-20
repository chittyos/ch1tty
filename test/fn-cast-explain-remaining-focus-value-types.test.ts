/**
 * FN: Drift guard — cast explain VALUE TYPES for 7 focus-only fields at
 * verbosity:'full' not covered by EW.
 *
 * EW (ew-cast-explain-focus-value-types-full.test.ts) froze value types for
 * 24 of the 31 focus-only fields that appear at verbosity:'full'. The 7 fields
 * below were present in the DW name freeze but absent from EW type coverage:
 *
 *   focusBias            — fraction of margin attributable to focus boost.
 *                          (winnerInFocus ? focusBoost : 0) / focusMargin.
 *                          Can exceed 1 when boost > raw margin. Always ≥ 0.
 *   focusConfidence      — focusBias clamped to [0,1].
 *                          Math.min(1, focusBias). Always ∈ [0,1].
 *   focusMarginRatio     — focusMargin / winnerScore. The post-focus gap as a
 *                          fraction of winner's total score. ∈ [0,1).
 *   rawFocusMarginRatio  — rawFocusMargin / winnerScoreBase. Same gap in the
 *                          pre-boost score space. Finite (may be negative when
 *                          focus reversed the natural ranking).
 *   runnerUpFocusBoostRatio — runnerUpFocusBoost / runnerUpScore ∈ [0,1].
 *                          Symmetric to winnerFocusBoostRatio for the runner-up.
 *   outOfFocusMeanScore  — arithmetic mean score of out-of-focus candidates. ≥ 0.
 *   outOfFocusBottomScore — lowest score among out-of-focus candidates. ≥ 0.
 *                          Ordering: outOfFocusBottomScore ≤ outOfFocusMeanScore
 *                          ≤ topOutOfFocusScore always holds.
 *
 * Presence conditions (multi-candidate focus resolved case):
 *   focusBias / focusConfidence  — runner-up exists AND focusMargin non-zero
 *   focusMarginRatio             — runner-up exists AND winnerScore > 0
 *   rawFocusMarginRatio          — runner-up exists AND winnerScoreBase > 0
 *   runnerUpFocusBoostRatio      — runner-up exists AND runnerUpScore > 0
 *   outOfFocusMeanScore          — at least one out-of-focus candidate exists
 *   outOfFocusBottomScore        — at least one out-of-focus candidate exists
 *
 * All 7 are absent on no_match (candidateCount === 0) with focus active.
 *
 * CLAUDE.md § buildCastExplanation metric freeze applies here:
 * if a test fails with an unexpected type or range, a field's type was changed —
 * REJECT per the metric freeze; update only after confirming intent.
 *
 * Fixture: neon (code) + stripe + tasks (both ecosystem). focus:code boosts
 * neon tools. The multi-server fixture ensures ≥2 candidates from different
 * categories, providing runner-up and in/out-of-focus score groups.
 *
 * Frozen 2026-09-20.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// NullRoutingCoordinator prevents OllamaBrain routing so assertions are
// deterministic regardless of CH1TTY_USE_OLLAMA_BRAIN.
class NullRoutingCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-fn-${Date.now()}-${++dlqSeq}.jsonl`);
}

const FOCUS_PROFILES = {
  profiles: {
    code: { categories: ['code'] as string[], servers: ['neon'] as string[], boost: 0.5 },
  },
};

const CONFIGS: ServerConfig[] = [
  { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true },
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
  { id: 'tasks', name: 'Tasks', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://tasks.chitty.cc/mcp', lazy: true },
];

function makeAggregator(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  backend.defineServer('tasks', FIXTURE_SERVERS.tasks);
  return new Aggregator(CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    focusProfiles: FOCUS_PROFILES,
    coordinator: new NullRoutingCoordinator({}, { enabled: false }),
  } as Parameters<typeof Aggregator>[1]);
}

function parseBody(result: { content: Array<{ type?: string; text?: unknown }> }): Record<string, unknown> {
  const first = result.content[0] as { type?: string; text?: unknown } | undefined;
  if (typeof first?.text !== 'string') throw new Error('No text content');
  return JSON.parse(first.text) as Record<string, unknown>;
}

function getExplanation(body: Record<string, unknown>): Record<string, unknown> {
  const explanation = body['explanation'];
  assert.ok(explanation !== null && typeof explanation === 'object', 'explanation must be an object');
  return explanation as Record<string, unknown>;
}

// ── Suite FN-1: focusBias and focusConfidence ─────────────────────────────────

describe('FN-1 — focusBias and focusConfidence value types at verbosity:full (focus:code)', () => {
  test('focusBias is number, finite, ≥ 0; focusConfidence is number ∈ [0,1]; focusConfidence ≤ focusBias or both equal 1', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'full',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = parseBody(result);
      const ex = getExplanation(body);

      const focusBias = ex['focusBias'];
      assert.equal(typeof focusBias, 'number', 'focusBias must be a number');
      assert.ok(Number.isFinite(focusBias as number), 'focusBias must be finite');
      assert.ok((focusBias as number) >= 0, `focusBias must be ≥ 0, got ${focusBias}`);

      const focusConfidence = ex['focusConfidence'];
      assert.equal(typeof focusConfidence, 'number', 'focusConfidence must be a number');
      assert.ok(Number.isFinite(focusConfidence as number), 'focusConfidence must be finite');
      assert.ok((focusConfidence as number) >= 0, `focusConfidence must be ≥ 0, got ${focusConfidence}`);
      assert.ok((focusConfidence as number) <= 1, `focusConfidence must be ≤ 1, got ${focusConfidence}`);

      // focusConfidence is Math.min(1, focusBias) — always ≤ focusBias
      assert.ok(
        (focusConfidence as number) <= (focusBias as number) || (focusConfidence as number) === 1,
        `focusConfidence (${focusConfidence}) must be ≤ focusBias (${focusBias}) or equal 1`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('focusBias and focusConfidence are absent on no_match with focus:code active', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'zzzzzzzzz_no_match_fn1_xyz_9999',
        explain: true,
        verbosity: 'full',
        focus: 'code',
      });
      assert.equal(result.isError, undefined, 'cast should not error on no_match');
      const body = parseBody(result);
      assert.equal(body['cast'], 'no_match', 'cast must be no_match');
      const ex = getExplanation(body);

      assert.equal(ex['focusBias'], undefined, 'focusBias must be absent on no_match');
      assert.equal(ex['focusConfidence'], undefined, 'focusConfidence must be absent on no_match');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite FN-2: ratio fields ──────────────────────────────────────────────────

describe('FN-2 — focusMarginRatio, rawFocusMarginRatio, runnerUpFocusBoostRatio value types at verbosity:full (focus:code)', () => {
  test('focusMarginRatio is number ∈ [0,1); rawFocusMarginRatio is finite number; runnerUpFocusBoostRatio is number ∈ [0,1]', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'full',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = parseBody(result);
      const ex = getExplanation(body);

      const focusMarginRatio = ex['focusMarginRatio'];
      assert.equal(typeof focusMarginRatio, 'number', 'focusMarginRatio must be a number');
      assert.ok(Number.isFinite(focusMarginRatio as number), 'focusMarginRatio must be finite');
      assert.ok((focusMarginRatio as number) >= 0, `focusMarginRatio must be ≥ 0, got ${focusMarginRatio}`);
      assert.ok((focusMarginRatio as number) <= 1, `focusMarginRatio must be ≤ 1, got ${focusMarginRatio}`);

      const rawFocusMarginRatio = ex['rawFocusMarginRatio'];
      assert.equal(typeof rawFocusMarginRatio, 'number', 'rawFocusMarginRatio must be a number');
      assert.ok(Number.isFinite(rawFocusMarginRatio as number), 'rawFocusMarginRatio must be finite');

      const runnerUpFocusBoostRatio = ex['runnerUpFocusBoostRatio'];
      assert.equal(typeof runnerUpFocusBoostRatio, 'number', 'runnerUpFocusBoostRatio must be a number');
      assert.ok(Number.isFinite(runnerUpFocusBoostRatio as number), 'runnerUpFocusBoostRatio must be finite');
      assert.ok((runnerUpFocusBoostRatio as number) >= 0, `runnerUpFocusBoostRatio must be ≥ 0, got ${runnerUpFocusBoostRatio}`);
      assert.ok((runnerUpFocusBoostRatio as number) <= 1, `runnerUpFocusBoostRatio must be ≤ 1, got ${runnerUpFocusBoostRatio}`);
    } finally {
      await agg.shutdown();
    }
  });

  test('focusMarginRatio, rawFocusMarginRatio, runnerUpFocusBoostRatio are absent on no_match', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'zzzzzzzzz_no_match_fn2_xyz_9999',
        explain: true,
        verbosity: 'full',
        focus: 'code',
      });
      assert.equal(result.isError, undefined, 'cast should not error on no_match');
      const body = parseBody(result);
      assert.equal(body['cast'], 'no_match', 'cast must be no_match');
      const ex = getExplanation(body);

      assert.equal(ex['focusMarginRatio'], undefined, 'focusMarginRatio must be absent on no_match');
      assert.equal(ex['rawFocusMarginRatio'], undefined, 'rawFocusMarginRatio must be absent on no_match');
      assert.equal(ex['runnerUpFocusBoostRatio'], undefined, 'runnerUpFocusBoostRatio must be absent on no_match');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite FN-3: out-of-focus score range fields ───────────────────────────────

describe('FN-3 — outOfFocusMeanScore and outOfFocusBottomScore value types at verbosity:full (focus:code)', () => {
  test('outOfFocusMeanScore ≥ 0 and outOfFocusBottomScore ≥ 0; bottom ≤ mean ≤ topOutOfFocusScore', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'full',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = parseBody(result);
      const ex = getExplanation(body);

      const outOfFocusMeanScore = ex['outOfFocusMeanScore'];
      assert.equal(typeof outOfFocusMeanScore, 'number', 'outOfFocusMeanScore must be a number');
      assert.ok(Number.isFinite(outOfFocusMeanScore as number), 'outOfFocusMeanScore must be finite');
      assert.ok((outOfFocusMeanScore as number) >= 0, `outOfFocusMeanScore must be ≥ 0, got ${outOfFocusMeanScore}`);

      const outOfFocusBottomScore = ex['outOfFocusBottomScore'];
      assert.equal(typeof outOfFocusBottomScore, 'number', 'outOfFocusBottomScore must be a number');
      assert.ok(Number.isFinite(outOfFocusBottomScore as number), 'outOfFocusBottomScore must be finite');
      assert.ok((outOfFocusBottomScore as number) >= 0, `outOfFocusBottomScore must be ≥ 0, got ${outOfFocusBottomScore}`);

      // Triple ordering: outOfFocusBottomScore ≤ outOfFocusMeanScore ≤ topOutOfFocusScore
      const topOutOfFocusScore = ex['topOutOfFocusScore'] as number;
      assert.ok(
        (outOfFocusBottomScore as number) <= (outOfFocusMeanScore as number),
        `outOfFocusBottomScore (${outOfFocusBottomScore}) must be ≤ outOfFocusMeanScore (${outOfFocusMeanScore})`,
      );
      assert.ok(
        (outOfFocusMeanScore as number) <= topOutOfFocusScore,
        `outOfFocusMeanScore (${outOfFocusMeanScore}) must be ≤ topOutOfFocusScore (${topOutOfFocusScore})`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('outOfFocusMeanScore and outOfFocusBottomScore are absent on no_match', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'zzzzzzzzz_no_match_fn3_xyz_9999',
        explain: true,
        verbosity: 'full',
        focus: 'code',
      });
      assert.equal(result.isError, undefined, 'cast should not error on no_match');
      const body = parseBody(result);
      assert.equal(body['cast'], 'no_match', 'cast must be no_match');
      const ex = getExplanation(body);

      assert.equal(ex['outOfFocusMeanScore'], undefined, 'outOfFocusMeanScore must be absent on no_match');
      assert.equal(ex['outOfFocusBottomScore'], undefined, 'outOfFocusBottomScore must be absent on no_match');
    } finally {
      await agg.shutdown();
    }
  });
});
