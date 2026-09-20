/**
 * FU drift guard: freeze cast explain exact key sets for brain-routed RESOLVED
 * responses when the brain coordinator returns non-uniform confidence scores.
 *
 * FT freezes the brain-routed resolved key sets with uniform confidence (all = 1).
 * Uniform scores mean kurtosis/skewness/z-score fields require score variance and
 * are absent, and focus-confidence fields (focusBias, focusConfidence) likewise
 * need variance to be defined. FT's key sets are therefore DW-subsets plus brainMs.
 *
 * FU closes the remaining gap: BrainVariedConfidenceCoordinator returns the first
 * candidate at confidence=1.0, the second at 0.5, and the rest at 0.1. This creates
 * genuine score variance, enabling the fields that FT's uniform-confidence coordinator
 * could not reach.
 *
 * Key sets frozen (2026-09-20, BrainVariedConfidenceCoordinator + neon+stripe+tasks FixtureBackend):
 *
 *   FU-1  verbosity:low,    no focus   →  9 keys  (identical to FT-1 — stat fields absent at low verbosity)
 *   FU-2  verbosity:low,    focus:code → 13 keys  (identical to FT-2 — stat fields absent at low verbosity)
 *   FU-3  verbosity:medium, no focus   → 16 keys  (identical to FT-3 — stat fields absent at medium/no-focus)
 *   FU-4  verbosity:medium, focus:code → 28 keys  (FT-4's 27 + focusConfidence; variance unlocks it)
 *   FU-5  verbosity:full,   no focus   → 57 keys  (FT-5's 48 + 9 z-score/kurtosis/skewness fields + brainMs already counted)
 *   FU-6  verbosity:full,   focus:code → 88 keys  (FT-6's 86 + focusBias + focusConfidence)
 *
 * Fields absent from FT that appear in FU due to score variance (no-focus path):
 *   candidateScoreKurtosis, candidateScoreSkewness,
 *   runnerUpLowestGapToSpreadRatio, runnerUpScoreZScore,
 *   topCandidatesKurtosis, topCandidatesScoreSkewness,
 *   winnerRunnerUpGapToSpreadRatio, winnerScoreZScore, zScoreGap
 *
 * Fields absent from FT-6 that appear in FU-6 due to focus score variance:
 *   focusBias, focusConfidence
 *
 * Together FT + FU cover the full brain-route explanation key space under both
 * uniform and varied confidence distributions, matching DW's keyword-route coverage.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only change)
 *   - buildCastExplanation metric freeze: no new fields added; freezes existing set
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { FocusProfiles } from '../src/focus.js';
import type { RoutedTool, ToolCandidate } from '../src/ollama-brain.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

/**
 * Returns the first candidate at confidence=1.0, the second at 0.5, the rest at 0.1.
 * This creates genuine score variance, enabling kurtosis/skewness/z-score fields and
 * focus-confidence metrics that the uniform-confidence coordinator in FT cannot trigger.
 */
class BrainVariedConfidenceCoordinator extends SessionCoordinator {
  constructor() {
    super({}, { enabled: false });
  }

  override async routeIntent(
    _query: string,
    candidates: ToolCandidate[],
  ): Promise<RoutedTool[] | null> {
    if (candidates.length === 0) return null;
    return candidates.map((c, i) => ({
      tool: c,
      confidence: i === 0 ? 1.0 : i === 1 ? 0.5 : 0.1,
      reason: 'fu-guard',
    }));
  }
}

const CONFIGS: ServerConfig[] = [
  { id: 'neon',   name: 'Neon',   type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',      lazy: true },
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp',     lazy: true },
  { id: 'tasks',  name: 'Tasks',  type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://tasks.chitty.cc/mcp', lazy: true },
];

const FOCUS_PROFILES: FocusProfiles = {
  profiles: { code: { categories: [], servers: ['neon'], boost: 0.5 } },
};

let dlqSeq = 0;
function makeAgg(withFocus: boolean): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon',   FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  backend.defineServer('tasks',  FIXTURE_SERVERS.tasks);
  const opts: Record<string, unknown> = {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: join(tmpdir(), `ch1tty-fu-${Date.now()}-${++dlqSeq}.jsonl`),
    coordinator: new BrainVariedConfidenceCoordinator(),
  };
  if (withFocus) {
    opts.focusProfiles = FOCUS_PROFILES;
    opts.focus = 'code';
  }
  return new Aggregator(CONFIGS, opts as Parameters<typeof Aggregator.prototype.callTool>[1]);
}

async function explainKeys(agg: Aggregator, verbosity: 'low' | 'medium' | 'full'): Promise<string[]> {
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon database projects',
    explain: true,
    verbosity,
    dryRun: true,
  });
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body['cast'], 'resolved', 'brain route with positive confidence must resolve');
  assert.equal((body['explanation'] as Record<string, unknown> | undefined)?.['method'], 'brain', 'castRoute must be brain');
  return Object.keys(body['explanation'] as Record<string, unknown>).sort();
}

// ── FU-1: verbosity:low, no focus ───────────────────────────────────────────
// Low verbosity omits all statistical fields; identical to FT-1 (9 keys).

test('FU-1: brain varied-confidence, verbosity:low no-focus — exact 9-key set', async () => {
  const agg = makeAgg(false);
  try {
    const keys = await explainKeys(agg, 'low');
    assert.deepEqual(keys, [
      'brainMs',
      'candidateCount',
      'method',
      'rationale',
      'runnerUpScore',
      'runnerUpTool',
      'topCandidates',
      'winnerScore',
      'winnerServer',
    ], 'verbosity:low no-focus brain varied-confidence exact key set must equal frozen 9-key list');
  } finally {
    await agg.shutdown();
  }
});

// ── FU-2: verbosity:low, focus:code ─────────────────────────────────────────
// Low verbosity omits all statistical fields; identical to FT-2 (13 keys).

test('FU-2: brain varied-confidence, verbosity:low focus:code — exact 13-key set', async () => {
  const agg = makeAgg(true);
  try {
    const keys = await explainKeys(agg, 'low');
    assert.deepEqual(keys, [
      'brainMs',
      'candidateCount',
      'focus',
      'focusBoost',
      'focusDecisive',
      'method',
      'rationale',
      'runnerUpScore',
      'runnerUpTool',
      'topCandidates',
      'winnerInFocus',
      'winnerScore',
      'winnerServer',
    ], 'verbosity:low focus:code brain varied-confidence exact key set must equal frozen 13-key list');
  } finally {
    await agg.shutdown();
  }
});

// ── FU-3: verbosity:medium, no focus ────────────────────────────────────────
// Medium verbosity adds spread/stdev/mean but not kurtosis/skewness; identical to FT-3 (16 keys).

test('FU-3: brain varied-confidence, verbosity:medium no-focus — exact 16-key set', async () => {
  const agg = makeAgg(false);
  try {
    const keys = await explainKeys(agg, 'medium');
    assert.deepEqual(keys, [
      'brainMs',
      'candidateCount',
      'candidateScoreMean',
      'candidateScoreSpread',
      'candidateScoreStdDev',
      'medianCandidateScore',
      'method',
      'rationale',
      'runnerUpCategory',
      'runnerUpScore',
      'runnerUpServer',
      'runnerUpTool',
      'topCandidates',
      'winnerCategory',
      'winnerScore',
      'winnerServer',
    ], 'verbosity:medium no-focus brain varied-confidence exact key set must equal frozen 16-key list');
  } finally {
    await agg.shutdown();
  }
});

// ── FU-4: verbosity:medium, focus:code ──────────────────────────────────────
// Medium+focus with varied scores: adds focusConfidence vs FT-4's 27 keys → 28 keys.
// focusConfidence requires score variance to be meaningful; uniform confidence (FT-4) omits it.

test('FU-4: brain varied-confidence, verbosity:medium focus:code — exact 28-key set', async () => {
  const agg = makeAgg(true);
  try {
    const keys = await explainKeys(agg, 'medium');
    assert.deepEqual(keys, [
      'brainMs',
      'candidateCount',
      'candidateScoreMean',
      'candidateScoreSpread',
      'candidateScoreStdDev',
      'candidatesInFocusCount',
      'focus',
      'focusBoost',
      'focusConfidence',
      'focusDecisive',
      'focusMargin',
      'focusRank',
      'focusRankDelta',
      'inFocusFraction',
      'medianCandidateScore',
      'method',
      'rationale',
      'runnerUpCategory',
      'runnerUpScore',
      'runnerUpServer',
      'runnerUpTool',
      'topCandidates',
      'winnerCategory',
      'winnerFocusBoost',
      'winnerInFocus',
      'winnerScore',
      'winnerScoreBase',
      'winnerServer',
    ], 'verbosity:medium focus:code brain varied-confidence exact key set must equal frozen 28-key list (focusConfidence present; absent in FT-4 due to uniform scores)');
  } finally {
    await agg.shutdown();
  }
});

// ── FU-5: verbosity:full, no focus ───────────────────────────────────────────
// Full verbosity + varied scores: DW's 56 full-verbosity fields + brainMs = 57 keys.
// The 9 fields absent from FT-5 (kurtosis/skewness/z-score) are present here.

test('FU-5: brain varied-confidence, verbosity:full no-focus — exact 57-key set', async () => {
  const agg = makeAgg(false);
  try {
    const keys = await explainKeys(agg, 'full');
    assert.deepEqual(keys, [
      'brainMs',
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
    ], 'verbosity:full no-focus brain varied-confidence exact key set must equal frozen 57-key list (= DW 56 + brainMs; all z-score/kurtosis/skewness fields present)');
  } finally {
    await agg.shutdown();
  }
});

// ── FU-6: verbosity:full, focus:code ─────────────────────────────────────────
// Full verbosity + focus + varied scores: DW's 87 full-focus fields + brainMs = 88 keys.
// Adds focusBias and focusConfidence vs FT-6's 86 keys (both require focus score variance).

test('FU-6: brain varied-confidence, verbosity:full focus:code — exact 88-key set', async () => {
  const agg = makeAgg(true);
  try {
    const keys = await explainKeys(agg, 'full');
    assert.deepEqual(keys, [
      'brainMs',
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
    ], 'verbosity:full focus:code brain varied-confidence exact key set must equal frozen 88-key list (= DW 87 + brainMs; focusBias/focusConfidence present)');
  } finally {
    await agg.shutdown();
  }
});
