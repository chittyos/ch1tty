/**
 * EW: Drift guard — cast explain focus field VALUE TYPES for verbosity:'full'.
 *
 * DW (dw-cast-explain-fieldnames-drift.test.ts) freezes the 31 focus-only field
 * NAMES for verbosity:'full'. No prior guard freezes their VALUE TYPES. A future
 * refactor that converts a boolean to a number, changes a ratio to a percentage,
 * or introduces NaN/undefined for a numeric field would pass DW silently.
 *
 * CLAUDE.md § buildCastExplanation metric freeze applies here:
 * if a test fails with an unexpected type or range, a field's type was changed —
 * REJECT per the metric freeze; update only after confirming intent.
 *
 * ── always-present focus identity (when focus active + best !== undefined) ─────
 *   focus              → string (non-empty profile name)
 *   focusBoost         → number (finite > 0)
 *   winnerInFocus      → boolean
 *   winnerFocusBoost   → number ∈ {0, focusBoost}
 *   winnerScoreBase    → number (finite ≥ 0)
 *   candidatesInFocusCount    → integer ≥ 0
 *   outOfFocusCandidatesCount → integer ≥ 0
 *   candidatesInFocusCount + outOfFocusCandidatesCount === candidateCount
 *
 * ── fraction/rank fields ─────────────────────────────────────────────────────
 *   inFocusFraction      → number ∈ [0, 1]
 *   focusRank            → integer ≥ 1
 *   focusRankDelta       → integer ≥ 0 (= focusRank − 1)
 *   focusRankPercentile  → number ∈ (0, 1]
 *   winnerFocusBoostRatio → number ∈ [0, 1]
 *
 * ── runner-up focus flags and boost fields (when ≥ 2 candidates) ─────────────
 *   focusDecisive      → boolean
 *   runnerUpInFocus    → boolean
 *   runnerUpFocusBoost → number ∈ {0, focusBoost}
 *   runnerUpScoreBase  → number (finite ≥ 0)
 *   focusNetBoostDelta → number ∈ {−focusBoost, 0, focusBoost}
 *   rawFocusMargin     → number (finite)
 *   focusMargin        → number (finite)
 *
 * ── in/out-of-focus score groups ─────────────────────────────────────────────
 *   inFocusTopScore    → number (finite > 0), ≥ inFocusMeanScore ≥ inFocusBottomScore
 *   outOfFocusWinnerGap → number (finite ≥ 0)
 *   topOutOfFocusScore → number (finite ≥ 0)
 *
 * ── no_match with focus active ───────────────────────────────────────────────
 *   focus and focusBoost are present; winnerInFocus is false; winner-dependent
 *   focus fields are absent (no winnerFocusBoost, winnerScoreBase, etc.)
 *
 * Frozen 2026-09-19.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// ── Fixture setup ─────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-ew-${Date.now()}-${++dlqSeq}.jsonl`);
}

/**
 * Inline focus profiles keep the suite hermetic: CH1TTY_FOCUS_PROFILES env
 * var cannot override the 'code' profile definition at runtime.
 */
const FOCUS_PROFILES = {
  profiles: {
    code: { categories: ['code'] as string[], servers: ['neon'] as string[], boost: 0.5 },
  },
};

function makeAggregator(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  backend.defineServer('tasks', FIXTURE_SERVERS.tasks);
  const configs: ServerConfig[] = [
    { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true },
    { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
    { id: 'tasks', name: 'Tasks', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://tasks.chitty.cc/mcp', lazy: true },
  ];
  return new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    focusProfiles: FOCUS_PROFILES,
  });
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

// ── Suite 1: focus identity field types ───────────────────────────────────────

describe('EW — focus identity field types at verbosity:full (focus:code)', () => {
  test('focus (string), focusBoost (finite>0), winnerInFocus (boolean), winnerFocusBoost (∈{0,boost}), winnerScoreBase (≥0)', async () => {
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

      assert.equal(typeof ex['focus'], 'string', 'focus must be a string');
      assert.ok((ex['focus'] as string).length > 0, 'focus must be non-empty');

      assert.equal(typeof ex['focusBoost'], 'number', 'focusBoost must be a number');
      assert.ok(Number.isFinite(ex['focusBoost'] as number), 'focusBoost must be finite');
      assert.ok((ex['focusBoost'] as number) > 0, 'focusBoost must be > 0');

      assert.equal(typeof ex['winnerInFocus'], 'boolean', 'winnerInFocus must be a boolean');

      assert.equal(typeof ex['winnerFocusBoost'], 'number', 'winnerFocusBoost must be a number');
      assert.ok(Number.isFinite(ex['winnerFocusBoost'] as number), 'winnerFocusBoost must be finite');
      assert.ok((ex['winnerFocusBoost'] as number) >= 0, 'winnerFocusBoost must be ≥ 0');
      const boost = ex['focusBoost'] as number;
      const wfb = ex['winnerFocusBoost'] as number;
      assert.ok(wfb === 0 || wfb === boost, `winnerFocusBoost must be 0 or focusBoost (${boost}), got ${wfb}`);

      assert.equal(typeof ex['winnerScoreBase'], 'number', 'winnerScoreBase must be a number');
      assert.ok(Number.isFinite(ex['winnerScoreBase'] as number), 'winnerScoreBase must be finite');
      assert.ok((ex['winnerScoreBase'] as number) >= 0, 'winnerScoreBase must be ≥ 0');
    } finally {
      await agg.shutdown();
    }
  });

  test('candidatesInFocusCount + outOfFocusCandidatesCount === candidateCount (partition invariant)', async () => {
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

      const candidateCount = ex['candidateCount'] as number;
      const inFocusCount = ex['candidatesInFocusCount'] as number;
      const outOfFocusCount = ex['outOfFocusCandidatesCount'] as number;

      assert.equal(typeof inFocusCount, 'number', 'candidatesInFocusCount must be a number');
      assert.equal(typeof outOfFocusCount, 'number', 'outOfFocusCandidatesCount must be a number');
      assert.ok(Number.isInteger(inFocusCount), 'candidatesInFocusCount must be an integer');
      assert.ok(Number.isInteger(outOfFocusCount), 'outOfFocusCandidatesCount must be an integer');
      assert.ok(inFocusCount >= 0, 'candidatesInFocusCount must be ≥ 0');
      assert.ok(outOfFocusCount >= 0, 'outOfFocusCandidatesCount must be ≥ 0');
      assert.equal(
        inFocusCount + outOfFocusCount,
        candidateCount,
        `candidatesInFocusCount (${inFocusCount}) + outOfFocusCandidatesCount (${outOfFocusCount}) must equal candidateCount (${candidateCount})`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 2: fraction and rank field types ────────────────────────────────────

describe('EW — focus fraction and rank field types at verbosity:full (focus:code)', () => {
  test('inFocusFraction ∈[0,1], focusRank ≥1 integer, focusRankDelta === focusRank−1, focusRankPercentile ∈(0,1], winnerFocusBoostRatio ∈[0,1]', async () => {
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

      const inFocusFraction = ex['inFocusFraction'] as number;
      assert.equal(typeof inFocusFraction, 'number', 'inFocusFraction must be a number');
      assert.ok(Number.isFinite(inFocusFraction), 'inFocusFraction must be finite');
      assert.ok(inFocusFraction >= 0 && inFocusFraction <= 1, `inFocusFraction must be ∈[0,1], got ${inFocusFraction}`);

      const focusRank = ex['focusRank'] as number;
      assert.equal(typeof focusRank, 'number', 'focusRank must be a number');
      assert.ok(Number.isInteger(focusRank), 'focusRank must be an integer');
      assert.ok(focusRank >= 1, `focusRank must be ≥ 1, got ${focusRank}`);

      const focusRankDelta = ex['focusRankDelta'] as number;
      assert.equal(typeof focusRankDelta, 'number', 'focusRankDelta must be a number');
      assert.ok(Number.isInteger(focusRankDelta), 'focusRankDelta must be an integer');
      assert.equal(focusRankDelta, focusRank - 1, `focusRankDelta must equal focusRank−1 (${focusRank - 1}), got ${focusRankDelta}`);

      const focusRankPercentile = ex['focusRankPercentile'] as number;
      assert.equal(typeof focusRankPercentile, 'number', 'focusRankPercentile must be a number');
      assert.ok(Number.isFinite(focusRankPercentile), 'focusRankPercentile must be finite');
      assert.ok(focusRankPercentile > 0 && focusRankPercentile <= 1, `focusRankPercentile must be ∈(0,1], got ${focusRankPercentile}`);

      const winnerFocusBoostRatio = ex['winnerFocusBoostRatio'] as number;
      assert.equal(typeof winnerFocusBoostRatio, 'number', 'winnerFocusBoostRatio must be a number');
      assert.ok(Number.isFinite(winnerFocusBoostRatio), 'winnerFocusBoostRatio must be finite');
      assert.ok(winnerFocusBoostRatio >= 0 && winnerFocusBoostRatio <= 1, `winnerFocusBoostRatio must be ∈[0,1], got ${winnerFocusBoostRatio}`);
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 3: runner-up focus flag and boost field types ───────────────────────

describe('EW — runner-up focus field types at verbosity:full (focus:code)', () => {
  test('focusDecisive and runnerUpInFocus are booleans; runnerUpFocusBoost ∈{0,boost}; runnerUpScoreBase ≥0; focusNetBoostDelta ∈{−boost,0,boost}; rawFocusMargin and focusMargin are finite', async () => {
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
      const boost = ex['focusBoost'] as number;

      assert.equal(typeof ex['focusDecisive'], 'boolean', 'focusDecisive must be a boolean');
      assert.equal(typeof ex['runnerUpInFocus'], 'boolean', 'runnerUpInFocus must be a boolean');

      const runnerUpFocusBoost = ex['runnerUpFocusBoost'] as number;
      assert.equal(typeof runnerUpFocusBoost, 'number', 'runnerUpFocusBoost must be a number');
      assert.ok(Number.isFinite(runnerUpFocusBoost), 'runnerUpFocusBoost must be finite');
      assert.ok(runnerUpFocusBoost === 0 || runnerUpFocusBoost === boost, `runnerUpFocusBoost must be 0 or focusBoost (${boost}), got ${runnerUpFocusBoost}`);

      const runnerUpScoreBase = ex['runnerUpScoreBase'] as number;
      assert.equal(typeof runnerUpScoreBase, 'number', 'runnerUpScoreBase must be a number');
      assert.ok(Number.isFinite(runnerUpScoreBase), 'runnerUpScoreBase must be finite');
      assert.ok(runnerUpScoreBase >= 0, `runnerUpScoreBase must be ≥ 0, got ${runnerUpScoreBase}`);

      const focusNetBoostDelta = ex['focusNetBoostDelta'] as number;
      assert.equal(typeof focusNetBoostDelta, 'number', 'focusNetBoostDelta must be a number');
      assert.ok(Number.isFinite(focusNetBoostDelta), 'focusNetBoostDelta must be finite');
      assert.ok(
        focusNetBoostDelta === -boost || focusNetBoostDelta === 0 || focusNetBoostDelta === boost,
        `focusNetBoostDelta must be ∈{−${boost}, 0, ${boost}}, got ${focusNetBoostDelta}`,
      );

      const rawFocusMargin = ex['rawFocusMargin'] as number;
      assert.equal(typeof rawFocusMargin, 'number', 'rawFocusMargin must be a number');
      assert.ok(Number.isFinite(rawFocusMargin), 'rawFocusMargin must be finite');

      const focusMargin = ex['focusMargin'] as number;
      assert.equal(typeof focusMargin, 'number', 'focusMargin must be a number');
      assert.ok(Number.isFinite(focusMargin), 'focusMargin must be finite');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 4: in/out-of-focus score groups ─────────────────────────────────────

describe('EW — in/out-of-focus score group types at verbosity:full (focus:code)', () => {
  test('inFocusTop ≥ inFocusMean ≥ inFocusBottom; outOfFocusWinnerGap ≥ 0; topOutOfFocusScore ≥ 0', async () => {
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

      const inFocusTopScore = ex['inFocusTopScore'] as number;
      const inFocusMeanScore = ex['inFocusMeanScore'] as number;
      const inFocusBottomScore = ex['inFocusBottomScore'] as number;

      assert.equal(typeof inFocusTopScore, 'number', 'inFocusTopScore must be a number');
      assert.equal(typeof inFocusMeanScore, 'number', 'inFocusMeanScore must be a number');
      assert.equal(typeof inFocusBottomScore, 'number', 'inFocusBottomScore must be a number');
      assert.ok(Number.isFinite(inFocusTopScore), 'inFocusTopScore must be finite');
      assert.ok(Number.isFinite(inFocusMeanScore), 'inFocusMeanScore must be finite');
      assert.ok(Number.isFinite(inFocusBottomScore), 'inFocusBottomScore must be finite');
      assert.ok(inFocusTopScore > 0, `inFocusTopScore must be > 0, got ${inFocusTopScore}`);
      assert.ok(inFocusTopScore >= inFocusMeanScore, `inFocusTopScore (${inFocusTopScore}) must be ≥ inFocusMeanScore (${inFocusMeanScore})`);
      assert.ok(inFocusMeanScore >= inFocusBottomScore, `inFocusMeanScore (${inFocusMeanScore}) must be ≥ inFocusBottomScore (${inFocusBottomScore})`);

      const topOutOfFocusScore = ex['topOutOfFocusScore'] as number;
      assert.equal(typeof topOutOfFocusScore, 'number', 'topOutOfFocusScore must be a number');
      assert.ok(Number.isFinite(topOutOfFocusScore), 'topOutOfFocusScore must be finite');
      assert.ok(topOutOfFocusScore >= 0, `topOutOfFocusScore must be ≥ 0, got ${topOutOfFocusScore}`);

      const outOfFocusWinnerGap = ex['outOfFocusWinnerGap'] as number;
      assert.equal(typeof outOfFocusWinnerGap, 'number', 'outOfFocusWinnerGap must be a number');
      assert.ok(Number.isFinite(outOfFocusWinnerGap), 'outOfFocusWinnerGap must be finite');
      assert.ok(outOfFocusWinnerGap >= 0, `outOfFocusWinnerGap must be ≥ 0, got ${outOfFocusWinnerGap}`);
    } finally {
      await agg.shutdown();
    }
  });

  test('no_match with focus:code — focus/focusBoost present, winnerInFocus false, winner-dependent focus fields absent', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'zzzzzzzzz_no_match_ew_test_xyz_9999',
        explain: true,
        verbosity: 'full',
        focus: 'code',
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = parseBody(result);
      assert.equal(body['cast'], 'no_match', 'cast must be no_match');
      const ex = getExplanation(body);

      assert.equal(typeof ex['focus'], 'string', 'focus must be a string on no_match');
      assert.ok((ex['focus'] as string).length > 0, 'focus must be non-empty on no_match');

      assert.equal(typeof ex['focusBoost'], 'number', 'focusBoost must be a number on no_match');
      assert.ok(Number.isFinite(ex['focusBoost'] as number), 'focusBoost must be finite on no_match');

      assert.equal(ex['winnerInFocus'], false, 'winnerInFocus must be false on no_match (no winner)');

      assert.equal(ex['winnerFocusBoost'], undefined, 'winnerFocusBoost must be absent on no_match');
      assert.equal(ex['winnerScoreBase'], undefined, 'winnerScoreBase must be absent on no_match');
      assert.equal(ex['candidatesInFocusCount'], undefined, 'candidatesInFocusCount must be absent on no_match');
      assert.equal(ex['focusDecisive'], undefined, 'focusDecisive must be absent on no_match');
      assert.equal(ex['focusMargin'], undefined, 'focusMargin must be absent on no_match');
      assert.equal(ex['runnerUpInFocus'], undefined, 'runnerUpInFocus must be absent on no_match');
    } finally {
      await agg.shutdown();
    }
  });
});
