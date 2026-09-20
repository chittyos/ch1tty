/**
 * FM: Value-type guard for cast explain verbosity:'full' remaining fields.
 *
 * DW freezes the exact 56-key no-focus field NAME set at verbosity:'full'.
 * EV freezes VALUE TYPES for ~20 of those 56 fields. This test freezes value
 * types for the remaining ~36 fields NOT covered by EV, organized by category.
 *
 * CLAUDE.md compliance:
 *   - 5-tool surface: unchanged (test-only)
 *   - buildCastExplanation metric freeze: no new fields added; freezes types of
 *     existing fields only
 *
 * All tests use FixtureBackend (neon+stripe+tasks) + NullRoutingCoordinator so
 * the explain fields are deterministic (no Ollama/brain routing).
 *
 * ── Suites ───────────────────────────────────────────────────────────────────
 *   FM-1  Concentration / entropy metrics  (7 fields)
 *   FM-2  Ratio and normalized metrics     (10 fields)
 *   FM-3  Z-score and gap metrics          (9 fields)
 *   FM-4  Distribution shape metrics       (5 fields)
 *   FM-5  Absolute / remaining metrics     (7 fields)
 *
 * Frozen 2026-09-20.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

class NullRoutingCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

const CONFIGS: ServerConfig[] = [
  { id: 'neon',   name: 'Neon',   type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',      lazy: true },
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp',      lazy: true },
  { id: 'tasks',  name: 'Tasks',  type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://tasks.chitty.cc/mcp', lazy: true },
];

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon',   FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  backend.defineServer('tasks',  FIXTURE_SERVERS.tasks);
  return new Aggregator(CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: join(tmpdir(), `ch1tty-fm-${Date.now()}.jsonl`),
    coordinator: new NullRoutingCoordinator(),
  } as Parameters<typeof Aggregator>[1]);
}

async function getExplain(agg: Aggregator): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list database projects',
    explain: true,
    verbosity: 'full',
    dryRun: true,
  });
  assert.equal(result.isError, undefined, 'cast must not error');
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.ok(body.explanation !== undefined, 'explanation must be present');
  return body.explanation as Record<string, unknown>;
}

function assertFiniteNumber(val: unknown, field: string): void {
  assert.equal(typeof val, 'number', `${field} must be a number`);
  assert.ok(Number.isFinite(val as number), `${field} must be finite`);
}

// ── Suite FM-1: Concentration / entropy metrics ───────────────────────────────
// candidateScoreHerfindahlIndex ∈ (0,1], topHeavinessRatio ∈ (0,1],
// top2HeavinessRatio ∈ (0,1], topCandidatesGiniCoefficient ∈ [0,1),
// nonZeroCandidateFraction ∈ [0,1], scoreEntropyNormalized ∈ [0,1],
// candidateScoreEntropy ≥ 0

describe('FM-1 — concentration / entropy metrics', () => {
  test('candidateScoreHerfindahlIndex is a finite number in (0, 1]', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const v = ex['candidateScoreHerfindahlIndex'];
      assertFiniteNumber(v, 'candidateScoreHerfindahlIndex');
      assert.ok((v as number) > 0, 'candidateScoreHerfindahlIndex must be > 0');
      assert.ok((v as number) <= 1, 'candidateScoreHerfindahlIndex must be ≤ 1');
    } finally { await agg.shutdown(); }
  });

  test('topHeavinessRatio is a finite number in (0, 1]', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const v = ex['topHeavinessRatio'];
      assertFiniteNumber(v, 'topHeavinessRatio');
      assert.ok((v as number) > 0, 'topHeavinessRatio must be > 0');
      assert.ok((v as number) <= 1, 'topHeavinessRatio must be ≤ 1');
    } finally { await agg.shutdown(); }
  });

  test('top2HeavinessRatio is a finite number in (0, 1]', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const v = ex['top2HeavinessRatio'];
      assertFiniteNumber(v, 'top2HeavinessRatio');
      assert.ok((v as number) > 0, 'top2HeavinessRatio must be > 0');
      assert.ok((v as number) <= 1, 'top2HeavinessRatio must be ≤ 1');
    } finally { await agg.shutdown(); }
  });

  test('topCandidatesGiniCoefficient is a finite number in [0, 1)', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const v = ex['topCandidatesGiniCoefficient'];
      assertFiniteNumber(v, 'topCandidatesGiniCoefficient');
      assert.ok((v as number) >= 0, 'topCandidatesGiniCoefficient must be ≥ 0');
      assert.ok((v as number) < 1, 'topCandidatesGiniCoefficient must be < 1');
    } finally { await agg.shutdown(); }
  });

  test('nonZeroCandidateFraction is a finite number in [0, 1]', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const v = ex['nonZeroCandidateFraction'];
      assertFiniteNumber(v, 'nonZeroCandidateFraction');
      assert.ok((v as number) >= 0, 'nonZeroCandidateFraction must be ≥ 0');
      assert.ok((v as number) <= 1, 'nonZeroCandidateFraction must be ≤ 1');
    } finally { await agg.shutdown(); }
  });

  test('scoreEntropyNormalized is a finite number in [0, 1]', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const v = ex['scoreEntropyNormalized'];
      assertFiniteNumber(v, 'scoreEntropyNormalized');
      assert.ok((v as number) >= 0, 'scoreEntropyNormalized must be ≥ 0');
      assert.ok((v as number) <= 1, 'scoreEntropyNormalized must be ≤ 1');
    } finally { await agg.shutdown(); }
  });

  test('candidateScoreEntropy is a finite number ≥ 0', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const v = ex['candidateScoreEntropy'];
      assertFiniteNumber(v, 'candidateScoreEntropy');
      assert.ok((v as number) >= 0, 'candidateScoreEntropy must be ≥ 0');
    } finally { await agg.shutdown(); }
  });
});

// ── Suite FM-2: Ratio and normalized metrics ──────────────────────────────────
// candidateScoreMeanRatio ∈ (0,1], candidateScoreFieldStrengthRatio ∈ [0,1],
// lowestCandidateScoreRatio ∈ [0,1], candidateScoreNormalizedRange ≥ 0,
// candidateScoreIQRRatio ≥ 0, medianToMeanRatio > 0, winnerToMedianRatio ≥ 1,
// candidateScoreCoefficientOfVariation ≥ 0,
// candidateScoreLowestToMeanRatio ≥ 0, candidateScoreLowestToMedianRatio ≥ 0

describe('FM-2 — ratio and normalized metrics', () => {
  test('candidateScoreMeanRatio is a finite number in (0, 1]', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const v = ex['candidateScoreMeanRatio'];
      assertFiniteNumber(v, 'candidateScoreMeanRatio');
      assert.ok((v as number) > 0, 'candidateScoreMeanRatio must be > 0');
      assert.ok((v as number) <= 1, 'candidateScoreMeanRatio must be ≤ 1');
    } finally { await agg.shutdown(); }
  });

  test('candidateScoreFieldStrengthRatio is a finite number in [0, 1]', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const v = ex['candidateScoreFieldStrengthRatio'];
      assertFiniteNumber(v, 'candidateScoreFieldStrengthRatio');
      assert.ok((v as number) >= 0, 'candidateScoreFieldStrengthRatio must be ≥ 0');
      assert.ok((v as number) <= 1, 'candidateScoreFieldStrengthRatio must be ≤ 1');
    } finally { await agg.shutdown(); }
  });

  test('lowestCandidateScoreRatio is a finite number in [0, 1]', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const v = ex['lowestCandidateScoreRatio'];
      assertFiniteNumber(v, 'lowestCandidateScoreRatio');
      assert.ok((v as number) >= 0, 'lowestCandidateScoreRatio must be ≥ 0');
      assert.ok((v as number) <= 1, 'lowestCandidateScoreRatio must be ≤ 1');
    } finally { await agg.shutdown(); }
  });

  test('candidateScoreNormalizedRange is a finite number ≥ 0', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const v = ex['candidateScoreNormalizedRange'];
      assertFiniteNumber(v, 'candidateScoreNormalizedRange');
      assert.ok((v as number) >= 0, 'candidateScoreNormalizedRange must be ≥ 0');
    } finally { await agg.shutdown(); }
  });

  test('candidateScoreIQRRatio is a finite number ≥ 0', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const v = ex['candidateScoreIQRRatio'];
      assertFiniteNumber(v, 'candidateScoreIQRRatio');
      assert.ok((v as number) >= 0, 'candidateScoreIQRRatio must be ≥ 0');
    } finally { await agg.shutdown(); }
  });

  test('medianToMeanRatio is a finite number > 0', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const v = ex['medianToMeanRatio'];
      assertFiniteNumber(v, 'medianToMeanRatio');
      assert.ok((v as number) > 0, 'medianToMeanRatio must be > 0');
    } finally { await agg.shutdown(); }
  });

  test('winnerToMedianRatio is a finite number ≥ 1', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const v = ex['winnerToMedianRatio'];
      assertFiniteNumber(v, 'winnerToMedianRatio');
      assert.ok((v as number) >= 1, 'winnerToMedianRatio must be ≥ 1 (winner ≥ median)');
    } finally { await agg.shutdown(); }
  });

  test('candidateScoreCoefficientOfVariation is a finite number ≥ 0', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const v = ex['candidateScoreCoefficientOfVariation'];
      assertFiniteNumber(v, 'candidateScoreCoefficientOfVariation');
      assert.ok((v as number) >= 0, 'candidateScoreCoefficientOfVariation must be ≥ 0');
    } finally { await agg.shutdown(); }
  });

  test('candidateScoreLowestToMeanRatio is a finite number ≥ 0', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const v = ex['candidateScoreLowestToMeanRatio'];
      assertFiniteNumber(v, 'candidateScoreLowestToMeanRatio');
      assert.ok((v as number) >= 0, 'candidateScoreLowestToMeanRatio must be ≥ 0');
    } finally { await agg.shutdown(); }
  });

  test('candidateScoreLowestToMedianRatio is a finite number ≥ 0', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const v = ex['candidateScoreLowestToMedianRatio'];
      assertFiniteNumber(v, 'candidateScoreLowestToMedianRatio');
      assert.ok((v as number) >= 0, 'candidateScoreLowestToMedianRatio must be ≥ 0');
    } finally { await agg.shutdown(); }
  });
});

// ── Suite FM-3: Z-score and gap metrics ──────────────────────────────────────
// winnerScoreZScore ≥ 0, runnerUpScoreZScore (any sign), zScoreGap ≥ 0,
// winnerMeanGap ≥ 0, winnerRunnerUpGap ≥ 0, winnerScoreRatio ≥ 1,
// runnerUpMeanGap (any sign), winnerRunnerUpGapToSpreadRatio ≥ 0 (conditional),
// runnerUpLowestGapToSpreadRatio ≥ 0 (conditional)

describe('FM-3 — z-score and gap metrics', () => {
  test('winnerScoreZScore is a finite number ≥ 0', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const v = ex['winnerScoreZScore'];
      assertFiniteNumber(v, 'winnerScoreZScore');
      assert.ok((v as number) >= 0, 'winnerScoreZScore must be ≥ 0 (winner always ≥ mean)');
    } finally { await agg.shutdown(); }
  });

  test('runnerUpScoreZScore is a finite number (may be negative)', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const v = ex['runnerUpScoreZScore'];
      assertFiniteNumber(v, 'runnerUpScoreZScore');
    } finally { await agg.shutdown(); }
  });

  test('zScoreGap is a finite number ≥ 0', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const v = ex['zScoreGap'];
      assertFiniteNumber(v, 'zScoreGap');
      assert.ok((v as number) >= 0, 'zScoreGap must be ≥ 0');
    } finally { await agg.shutdown(); }
  });

  test('winnerMeanGap is a finite number ≥ 0', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const v = ex['winnerMeanGap'];
      assertFiniteNumber(v, 'winnerMeanGap');
      assert.ok((v as number) >= 0, 'winnerMeanGap must be ≥ 0');
    } finally { await agg.shutdown(); }
  });

  test('winnerRunnerUpGap is a finite number ≥ 0', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const v = ex['winnerRunnerUpGap'];
      assertFiniteNumber(v, 'winnerRunnerUpGap');
      assert.ok((v as number) >= 0, 'winnerRunnerUpGap must be ≥ 0');
    } finally { await agg.shutdown(); }
  });

  test('winnerScoreRatio is a finite number ≥ 1', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const v = ex['winnerScoreRatio'];
      assertFiniteNumber(v, 'winnerScoreRatio');
      assert.ok((v as number) >= 1, 'winnerScoreRatio must be ≥ 1 (winner/runnerUp, winner always ≥ runnerUp)');
    } finally { await agg.shutdown(); }
  });

  test('runnerUpMeanGap is a finite number (may be negative)', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const v = ex['runnerUpMeanGap'];
      assertFiniteNumber(v, 'runnerUpMeanGap');
    } finally { await agg.shutdown(); }
  });

  test('winnerRunnerUpGapToSpreadRatio is a finite number ≥ 0 when spread > 0', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const spread = ex['candidateScoreSpread'] as number | undefined;
      const v = ex['winnerRunnerUpGapToSpreadRatio'];
      if (spread !== undefined && spread > 0) {
        assertFiniteNumber(v, 'winnerRunnerUpGapToSpreadRatio');
        assert.ok((v as number) >= 0, 'winnerRunnerUpGapToSpreadRatio must be ≥ 0');
      }
    } finally { await agg.shutdown(); }
  });

  test('runnerUpLowestGapToSpreadRatio is a finite number ≥ 0 when spread > 0', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const spread = ex['candidateScoreSpread'] as number | undefined;
      const v = ex['runnerUpLowestGapToSpreadRatio'];
      if (spread !== undefined && spread > 0) {
        assertFiniteNumber(v, 'runnerUpLowestGapToSpreadRatio');
        assert.ok((v as number) >= 0, 'runnerUpLowestGapToSpreadRatio must be ≥ 0');
      }
    } finally { await agg.shutdown(); }
  });
});

// ── Suite FM-4: Distribution shape metrics ────────────────────────────────────
// candidateScoreSkewness (any sign), candidateScoreKurtosis (any sign),
// topCandidatesScoreSkewness (any sign), topCandidatesKurtosis (any sign),
// topCandidatesScoreStdDev ≥ 0

describe('FM-4 — distribution shape metrics', () => {
  test('candidateScoreSkewness is a finite number (any sign)', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      assertFiniteNumber(ex['candidateScoreSkewness'], 'candidateScoreSkewness');
    } finally { await agg.shutdown(); }
  });

  test('candidateScoreKurtosis is a finite number (any sign)', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      assertFiniteNumber(ex['candidateScoreKurtosis'], 'candidateScoreKurtosis');
    } finally { await agg.shutdown(); }
  });

  test('topCandidatesScoreSkewness is a finite number (any sign)', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      assertFiniteNumber(ex['topCandidatesScoreSkewness'], 'topCandidatesScoreSkewness');
    } finally { await agg.shutdown(); }
  });

  test('topCandidatesKurtosis is a finite number (any sign)', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      assertFiniteNumber(ex['topCandidatesKurtosis'], 'topCandidatesKurtosis');
    } finally { await agg.shutdown(); }
  });

  test('topCandidatesScoreStdDev is a finite number ≥ 0', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const v = ex['topCandidatesScoreStdDev'];
      assertFiniteNumber(v, 'topCandidatesScoreStdDev');
      assert.ok((v as number) >= 0, 'topCandidatesScoreStdDev must be ≥ 0');
    } finally { await agg.shutdown(); }
  });
});

// ── Suite FM-5: Absolute / remaining metrics ──────────────────────────────────
// medianCandidateScore ≥ 0, candidateScoreIQR ≥ 0,
// candidateScoreNonWinnerMean ≥ 0, candidateScoreWinnerFieldGap ≥ 0,
// topCandidates is a non-empty Array (multi-candidate fixture),
// candidateScoreMeanRatio and winnerToMedianRatio consistency

describe('FM-5 — absolute and remaining metrics', () => {
  test('medianCandidateScore is a finite number ≥ 0', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const v = ex['medianCandidateScore'];
      assertFiniteNumber(v, 'medianCandidateScore');
      assert.ok((v as number) >= 0, 'medianCandidateScore must be ≥ 0');
    } finally { await agg.shutdown(); }
  });

  test('candidateScoreIQR is a finite number ≥ 0', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const v = ex['candidateScoreIQR'];
      assertFiniteNumber(v, 'candidateScoreIQR');
      assert.ok((v as number) >= 0, 'candidateScoreIQR must be ≥ 0');
    } finally { await agg.shutdown(); }
  });

  test('candidateScoreNonWinnerMean is a finite number ≥ 0', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const v = ex['candidateScoreNonWinnerMean'];
      assertFiniteNumber(v, 'candidateScoreNonWinnerMean');
      assert.ok((v as number) >= 0, 'candidateScoreNonWinnerMean must be ≥ 0');
    } finally { await agg.shutdown(); }
  });

  test('candidateScoreWinnerFieldGap is a finite number ≥ 0', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const v = ex['candidateScoreWinnerFieldGap'];
      assertFiniteNumber(v, 'candidateScoreWinnerFieldGap');
      assert.ok((v as number) >= 0, 'candidateScoreWinnerFieldGap must be ≥ 0');
    } finally { await agg.shutdown(); }
  });

  test('topCandidates is a non-empty Array for multi-candidate fixture', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const v = ex['topCandidates'];
      assert.ok(Array.isArray(v), 'topCandidates must be an Array');
      assert.ok((v as unknown[]).length > 0, 'topCandidates must be non-empty for multi-candidate fixture');
    } finally { await agg.shutdown(); }
  });

  test('winnerToMedianRatio consistency: winnerScore / medianCandidateScore ≈ ratio', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const winner = ex['winnerScore'] as number;
      const median = ex['medianCandidateScore'] as number;
      const ratio = ex['winnerToMedianRatio'] as number;
      if (median > 0) {
        const expected = winner / median;
        assert.ok(Math.abs(ratio - expected) < 1e-9, `winnerToMedianRatio (${ratio}) must equal winnerScore/medianCandidateScore (${expected})`);
      }
    } finally { await agg.shutdown(); }
  });

  test('candidateScoreMeanRatio consistency: candidateScoreMean / winnerScore ≈ ratio', async () => {
    const agg = makeAgg();
    try {
      const ex = await getExplain(agg);
      const winner = ex['winnerScore'] as number;
      const mean = ex['candidateScoreMean'] as number;
      const ratio = ex['candidateScoreMeanRatio'] as number;
      if (winner > 0) {
        const expected = mean / winner;
        assert.ok(Math.abs(ratio - expected) < 1e-9, `candidateScoreMeanRatio (${ratio}) must equal candidateScoreMean/winnerScore (${expected})`);
      }
    } finally { await agg.shutdown(); }
  });
});
