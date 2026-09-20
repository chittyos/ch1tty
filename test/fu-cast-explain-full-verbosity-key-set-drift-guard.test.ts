/**
 * FU drift guard: freeze cast explain exact key sets at verbosity:full
 * for the fallback (non-brain) route with multi-candidate results.
 *
 * Complements FH (which freezes verbosity:low and verbosity:medium key sets)
 * and FT (which freezes brain-route key sets at all 3 verbosities).
 * This test freezes verbosity:full for the fallback route (NullRoutingCoordinator),
 * closing the last multi-candidate × verbosity × route gap in the drift-guard matrix.
 *
 * Key sets are deterministic with FixtureBackend (neon+stripe+tasks, 3 servers,
 * intent "list database projects" → multi-candidate every run).
 *
 * Suites:
 *   FU-1  verbosity:full, no focus   → 56-key set
 *   FU-2  verbosity:full, focus:code → 87-key set
 *
 * Frozen 2026-09-20 (probed against main @ 7eeb371).
 *
 * CLAUDE.md compliance:
 *   - 5-tool surface: unchanged (test-only)
 *   - buildCastExplanation metric freeze: no new fields added; freezes existing set only
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { FocusProfiles } from '../src/focus.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

class NullRoutingCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

const CONFIGS: ServerConfig[] = [
  { id: 'neon',   name: 'Neon',   type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',      lazy: true },
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp',     lazy: true },
  { id: 'tasks',  name: 'Tasks',  type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://tasks.chitty.cc/mcp', lazy: true },
];

const FOCUS_PROFILES: FocusProfiles = {
  profiles: { code: { categories: [], servers: ['neon'], boost: 0.5 } },
};

function makeAgg(withFocus: boolean): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon',   FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  backend.defineServer('tasks',  FIXTURE_SERVERS.tasks);
  const opts: Record<string, unknown> = {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: join(tmpdir(), `ch1tty-fu-${Date.now()}.jsonl`),
    coordinator: new NullRoutingCoordinator(),
  };
  if (withFocus) {
    opts.focusProfiles = FOCUS_PROFILES;
    opts.focus = 'code';
  }
  return new Aggregator(CONFIGS, opts as Parameters<typeof Aggregator.prototype.callTool>[1]);
}

// ── Frozen key sets ───────────────────────────────────────────────────────────

const FULL_NO_FOCUS_56: readonly string[] = [
  'candidateCount',
  'candidateGiniCoefficient',
  'candidateScoreCoefficientOfVariation',
  'candidateScoreEntropy',
  'candidateScoreFieldStrengthRatio',
  'candidateScoreHerfindahlIndex',
  'candidateScoreIQR',
  'candidateScoreIQRRatio',
  'candidateScoreKurtosis',
  'candidateScoreLowestToMeanRatio',
  'candidateScoreLowestToMedianRatio',
  'candidateScoreMean',
  'candidateScoreMeanRatio',
  'candidateScoreNonWinnerMean',
  'candidateScoreNormalizedRange',
  'candidateScoreSkewness',
  'candidateScoreSpread',
  'candidateScoreStdDev',
  'candidateScoreVariance',
  'candidateScoreWinnerFieldGap',
  'effectiveN',
  'lowestCandidateScore',
  'lowestCandidateScoreRatio',
  'medianCandidateScore',
  'medianToMeanRatio',
  'method',
  'nonZeroCandidateFraction',
  'rationale',
  'runnerUpCategory',
  'runnerUpLowestGapToSpreadRatio',
  'runnerUpMeanGap',
  'runnerUpScore',
  'runnerUpScoreZScore',
  'runnerUpServer',
  'runnerUpTool',
  'scoreDominanceIndex',
  'scoreEntropyNormalized',
  'top2HeavinessRatio',
  'topCandidates',
  'topCandidatesGiniCoefficient',
  'topCandidatesKurtosis',
  'topCandidatesMeanScore',
  'topCandidatesScoreSkewness',
  'topCandidatesScoreStdDev',
  'topCandidatesScoreVariance',
  'topHeavinessRatio',
  'winnerCategory',
  'winnerMeanGap',
  'winnerRunnerUpGap',
  'winnerRunnerUpGapToSpreadRatio',
  'winnerScore',
  'winnerScoreRatio',
  'winnerScoreZScore',
  'winnerServer',
  'winnerToMedianRatio',
  'zScoreGap',
];

const FULL_FOCUS_87: readonly string[] = [
  'candidateCount',
  'candidateGiniCoefficient',
  'candidateScoreCoefficientOfVariation',
  'candidateScoreEntropy',
  'candidateScoreFieldStrengthRatio',
  'candidateScoreHerfindahlIndex',
  'candidateScoreIQR',
  'candidateScoreIQRRatio',
  'candidateScoreKurtosis',
  'candidateScoreLowestToMeanRatio',
  'candidateScoreLowestToMedianRatio',
  'candidateScoreMean',
  'candidateScoreMeanRatio',
  'candidateScoreNonWinnerMean',
  'candidateScoreNormalizedRange',
  'candidateScoreSkewness',
  'candidateScoreSpread',
  'candidateScoreStdDev',
  'candidateScoreVariance',
  'candidateScoreWinnerFieldGap',
  'candidatesInFocusCount',
  'effectiveN',
  'focus',
  'focusBias',
  'focusBoost',
  'focusConfidence',
  'focusDecisive',
  'focusMargin',
  'focusMarginRatio',
  'focusNetBoostDelta',
  'focusRank',
  'focusRankDelta',
  'focusRankPercentile',
  'inFocusBottomScore',
  'inFocusFraction',
  'inFocusMeanScore',
  'inFocusTopScore',
  'lowestCandidateScore',
  'lowestCandidateScoreRatio',
  'medianCandidateScore',
  'medianToMeanRatio',
  'method',
  'nonZeroCandidateFraction',
  'outOfFocusBottomScore',
  'outOfFocusCandidatesCount',
  'outOfFocusMeanScore',
  'outOfFocusWinnerGap',
  'rationale',
  'rawFocusMargin',
  'rawFocusMarginRatio',
  'runnerUpCategory',
  'runnerUpFocusBoost',
  'runnerUpFocusBoostRatio',
  'runnerUpInFocus',
  'runnerUpLowestGapToSpreadRatio',
  'runnerUpMeanGap',
  'runnerUpScore',
  'runnerUpScoreBase',
  'runnerUpScoreZScore',
  'runnerUpServer',
  'runnerUpTool',
  'scoreDominanceIndex',
  'scoreEntropyNormalized',
  'top2HeavinessRatio',
  'topCandidates',
  'topCandidatesGiniCoefficient',
  'topCandidatesKurtosis',
  'topCandidatesMeanScore',
  'topCandidatesScoreSkewness',
  'topCandidatesScoreStdDev',
  'topCandidatesScoreVariance',
  'topHeavinessRatio',
  'topOutOfFocusScore',
  'winnerCategory',
  'winnerFocusBoost',
  'winnerFocusBoostRatio',
  'winnerInFocus',
  'winnerMeanGap',
  'winnerRunnerUpGap',
  'winnerRunnerUpGapToSpreadRatio',
  'winnerScore',
  'winnerScoreBase',
  'winnerScoreRatio',
  'winnerScoreZScore',
  'winnerServer',
  'winnerToMedianRatio',
  'zScoreGap',
];

// ── Suite FU-1: verbosity:full, no focus ─────────────────────────────────────

test('FU-1a: verbosity:full no-focus — explain key set is exactly 56 keys', async () => {
  const agg = makeAgg(false);
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list database projects',
      explain: true,
      verbosity: 'full',
    });
    assert.equal(result.isError, undefined, 'cast must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.ok(body.explanation !== undefined, 'explanation must be present');
    const keys = Object.keys(body.explanation as object).sort();
    assert.deepEqual(
      keys,
      [...FULL_NO_FOCUS_56],
      'verbosity:full no-focus exact key set must equal the frozen 56-key list',
    );
  } finally {
    await agg.shutdown();
  }
});

test('FU-1b: verbosity:full no-focus — castRoute is fallback (not brain)', async () => {
  const agg = makeAgg(false);
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list database projects',
      explain: true,
      verbosity: 'full',
    });
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    const explain = body.explanation as Record<string, unknown>;
    assert.equal(explain['brainMs'], undefined, 'brainMs must be absent on fallback route');
    assert.equal(typeof explain['method'], 'string', 'method must be a string');
  } finally {
    await agg.shutdown();
  }
});

test('FU-1c: verbosity:full no-focus — no focus fields leak into explain', async () => {
  const agg = makeAgg(false);
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list database projects',
      explain: true,
      verbosity: 'full',
    });
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    const explain = body.explanation as Record<string, unknown>;
    const focusKeys = Object.keys(explain).filter(
      (k) => k.startsWith('focus') || k.startsWith('inFocus') || k.startsWith('outOfFocus')
           || k.startsWith('rawFocus') || k === 'winnerInFocus' || k === 'winnerFocusBoost'
           || k === 'winnerFocusBoostRatio' || k === 'winnerScoreBase' || k === 'candidatesInFocusCount'
           || k === 'runnerUpFocusBoost' || k === 'runnerUpFocusBoostRatio' || k === 'runnerUpInFocus'
           || k === 'runnerUpScoreBase' || k === 'topOutOfFocusScore',
    );
    assert.deepEqual(focusKeys, [], 'no focus-related keys in verbosity:full no-focus explain');
  } finally {
    await agg.shutdown();
  }
});

// ── Suite FU-2: verbosity:full, focus:code ───────────────────────────────────

test('FU-2a: verbosity:full focus:code — explain key set is exactly 87 keys', async () => {
  const agg = makeAgg(true);
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list database projects',
      explain: true,
      verbosity: 'full',
    });
    assert.equal(result.isError, undefined, 'cast must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.ok(body.explanation !== undefined, 'explanation must be present');
    const keys = Object.keys(body.explanation as object).sort();
    assert.deepEqual(
      keys,
      [...FULL_FOCUS_87],
      'verbosity:full focus:code exact key set must equal the frozen 87-key list',
    );
  } finally {
    await agg.shutdown();
  }
});

test('FU-2b: verbosity:full focus:code — castRoute is fallback (not brain)', async () => {
  const agg = makeAgg(true);
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list database projects',
      explain: true,
      verbosity: 'full',
    });
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    const explain = body.explanation as Record<string, unknown>;
    assert.equal(explain['brainMs'], undefined, 'brainMs must be absent on fallback route');
    assert.equal(explain['focus'], 'code', 'focus must be active profile name');
    assert.equal(typeof explain['focusBoost'], 'number', 'focusBoost must be a number');
  } finally {
    await agg.shutdown();
  }
});

test('FU-2c: verbosity:full focus:code — focus delta fields are present and typed', async () => {
  const agg = makeAgg(true);
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list database projects',
      explain: true,
      verbosity: 'full',
    });
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    const explain = body.explanation as Record<string, unknown>;
    for (const k of ['focusBias', 'focusNetBoostDelta', 'focusMarginRatio', 'rawFocusMargin',
      'rawFocusMarginRatio', 'runnerUpFocusBoost', 'runnerUpFocusBoostRatio',
      'outOfFocusBottomScore', 'outOfFocusWinnerGap', 'topOutOfFocusScore']) {
      assert.equal(typeof explain[k], 'number', `${k} must be a number at verbosity:full focus`);
      assert.ok(Number.isFinite(explain[k] as number), `${k} must be finite`);
    }
    assert.equal(typeof explain['runnerUpInFocus'], 'boolean', 'runnerUpInFocus must be boolean');
    assert.equal(typeof explain['focusDecisive'], 'boolean', 'focusDecisive must be boolean');
    assert.equal(typeof explain['winnerInFocus'], 'boolean', 'winnerInFocus must be boolean');
  } finally {
    await agg.shutdown();
  }
});
