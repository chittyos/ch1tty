/**
 * FT drift guard: freeze cast explain exact key sets for brain-routed RESOLVED responses.
 *
 * FH freezes the key sets for fallback-routed (keyword) resolved responses.
 * FR/FS freeze the key sets for no_match (fallback and brain routes respectively).
 * FT covers the remaining quadrant: brain-routed RESOLVED responses across all
 * verbosity levels and focus/no-focus combinations.
 *
 * When the brain route resolves a tool (confidence > 0 → scoredTools non-empty),
 * buildCastExplanation receives brainMs and emits it as a top-level field.
 * FH (keyword route) cannot catch renames or additions on this path because it
 * never exercises it. FT closes that gap.
 *
 * Mechanism: BrainPositiveConfidenceCoordinator returns the first candidate with
 * confidence=1, forcing castRoute='brain' with a non-empty scoredTools array.
 *
 * Key sets frozen (2026-09-20, neon+stripe+tasks FixtureBackend):
 *
 * The coordinator returns ALL candidates with confidence=1 (uniform scores). This makes
 * castRoute='brain' with multi-candidate scoredTools, matching FH's pattern. Stat fields
 * requiring score variance (kurtosis, skewness, z-score) are absent when all candidates
 * score identically — so FT's full-verbosity key sets are smaller than DW's (keyword route).
 * focusBias and focusConfidence are absent for the same reason (no score variation to measure).
 *
 * Key sets frozen (2026-09-20, BrainMultiPositiveCoordinator + neon+stripe+tasks FixtureBackend):
 *
 *   FT-1  verbosity:low,    no focus   →  9 keys  (FH-1's 8 + brainMs)
 *   FT-2  verbosity:low,    focus:code → 13 keys  (FH-2's 12 + brainMs)
 *   FT-3  verbosity:medium, no focus   → 16 keys  (FH-3's 15 + brainMs)
 *   FT-4  verbosity:medium, focus:code → 27 keys  (FH-4's 26 non-brainMs + brainMs; focusConfidence absent)
 *   FT-5  verbosity:full,   no focus   → 48 keys  (DW subset + brainMs; kurtosis/skewness/z-score absent)
 *   FT-6  verbosity:full,   focus:code → 86 keys  (DW subset + focus subset + brainMs; focusBias/focusConfidence absent)
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

/** Returns all candidates with confidence=1 so castRoute='brain' with multi-candidate scoredTools. */
class BrainMultiPositiveCoordinator extends SessionCoordinator {
  constructor() {
    // Disable both brain warmup paths so this stub never contacts a real Ollama endpoint.
    super({ enabled: false }, { enabled: false });
  }

  override async routeIntent(
    _query: string,
    candidates: ToolCandidate[],
  ): Promise<RoutedTool[] | null> {
    if (candidates.length === 0) return null;
    return candidates.map((c) => ({ tool: c, confidence: 1, reason: 'ft-guard' }));
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

function makeAgg(withFocus: boolean): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon',   FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  backend.defineServer('tasks',  FIXTURE_SERVERS.tasks);
  const opts: Record<string, unknown> = {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: join(tmpdir(), `ch1tty-ft-${Date.now()}.jsonl`),
    coordinator: new BrainMultiPositiveCoordinator(),
  };
  if (withFocus) {
    opts.focusProfiles = FOCUS_PROFILES;
    opts.focus = 'code';
  }
  return new Aggregator(CONFIGS, opts as Parameters<typeof Aggregator.prototype.callTool>[1]);
}

async function explainKeys(agg: Aggregator, verbosity: 'low' | 'medium' | 'full'): Promise<string[]> {
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list database projects',
    explain: true,
    verbosity,
  });
  assert.equal(result.isError, undefined, 'cast must not error');
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.ok(body.explanation !== undefined, 'explanation must be present');
  return Object.keys(body.explanation as object).sort();
}

// ── FT-1: verbosity:low, no focus ────────────────────────────────────────────

test('FT-1: brain-routed resolved, verbosity:low no-focus — exact 9-key set', async () => {
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
    ], 'verbosity:low no-focus brain-route exact key set must equal frozen 9-key list');
  } finally {
    await agg.shutdown();
  }
});

test('FT-1b: brain-routed resolved, verbosity:low no-focus — brainMs is a non-negative number', async () => {
  const agg = makeAgg(false);
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list database projects',
      explain: true,
      verbosity: 'low',
    });
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    const explain = body.explanation as Record<string, unknown>;
    assert.equal(typeof explain.brainMs, 'number', 'brainMs must be a number on brain route');
    assert.ok((explain.brainMs as number) >= 0, 'brainMs must be non-negative');
    assert.equal(explain.method, 'brain', 'method must be "brain" on brain route');
  } finally {
    await agg.shutdown();
  }
});

// ── FT-2: verbosity:low, focus:code ──────────────────────────────────────────

test('FT-2: brain-routed resolved, verbosity:low focus:code — exact 13-key set', async () => {
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
    ], 'verbosity:low focus:code brain-route exact key set must equal frozen 13-key list');
  } finally {
    await agg.shutdown();
  }
});

// ── FT-3: verbosity:medium, no focus ─────────────────────────────────────────

test('FT-3: brain-routed resolved, verbosity:medium no-focus — exact 16-key set', async () => {
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
    ], 'verbosity:medium no-focus brain-route exact key set must equal frozen 16-key list');
  } finally {
    await agg.shutdown();
  }
});

// ── FT-4: verbosity:medium, focus:code ───────────────────────────────────────

test('FT-4: brain-routed resolved, verbosity:medium focus:code — exact 27-key set', async () => {
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
    ], 'verbosity:medium focus:code brain-route exact key set must equal frozen 27-key list (focusConfidence absent — uniform brain scores)');
  } finally {
    await agg.shutdown();
  }
});

// ── FT-5: verbosity:full, no focus ───────────────────────────────────────────
// Uniform brain scores → kurtosis/skewness/z-score stats absent (48 keys vs DW's 56)

test('FT-5: brain-routed resolved, verbosity:full no-focus — exact 48-key set', async () => {
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
      'candidateScoreLowestToMeanRatio',
      'candidateScoreLowestToMedianRatio',
      'candidateScoreMean',
      'candidateScoreMeanRatio',
      'candidateScoreNonWinnerMean',
      'candidateScoreNormalizedRange',
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
      'runnerUpMeanGap',
      'runnerUpScore',
      'runnerUpServer',
      'runnerUpTool',
      'scoreDominanceIndex',
      'scoreEntropyNormalized',
      'top2HeavinessRatio',
      'topCandidates',
      'topCandidatesGiniCoefficient',
      'topCandidatesMeanScore',
      'topCandidatesScoreStdDev',
      'topCandidatesScoreVariance',
      'topHeavinessRatio',
      'winnerCategory',
      'winnerMeanGap',
      'winnerRunnerUpGap',
      'winnerScore',
      'winnerScoreRatio',
      'winnerServer',
      'winnerToMedianRatio',
    ], 'verbosity:full no-focus brain-route exact key set must equal frozen 48-key list (kurtosis/skewness/z-score absent — uniform brain scores)');
  } finally {
    await agg.shutdown();
  }
});

// ── FT-6: verbosity:full, focus:code ─────────────────────────────────────────
// Uniform brain scores (pre-focus): focusBias/focusConfidence absent (86 keys vs DW's 87)

test('FT-6: brain-routed resolved, verbosity:full focus:code — exact 86-key set', async () => {
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
      'focusBoost',
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
    ].sort(), 'verbosity:full focus:code brain-route exact key set must equal frozen 86-key list (focusBias/focusConfidence absent — uniform brain scores)');
  } finally {
    await agg.shutdown();
  }
});
