/**
 * FL drift guard: freeze cast explain exact key sets at verbosity:full.
 *
 * Complements:
 *   - zzzz: freezes TOTAL field COUNT at verbosity:full (56 no-focus, 87 focus)
 *   - fh:   freezes EXACT KEY SETS at verbosity:low and verbosity:medium
 *
 * This test freezes the EXACT top-level key set at verbosity:full via
 * deepEqual, so a rename or accidental addition/removal fails regardless of
 * whether the total count stays the same.
 *
 * Key sets are deterministic with FixtureBackend (neon+stripe+tasks, 3 servers,
 * intent "list database projects" → multi-candidate every run).
 *
 * Suites:
 *   FL-1  verbosity:full, no focus     → exact 56-key set
 *   FL-2  verbosity:full, focus:code   → exact 87-key set
 *   FL-3  no-focus → focus-only keys must be absent
 *   FL-4  focus:code → focus-only keys must all be present
 *
 * CLAUDE.md compliance:
 *   - 5-tool surface: unchanged (test-only)
 *   - buildCastExplanation metric freeze: no new fields added; freezes existing set
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
  { id: 'neon',   name: 'Neon',   type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',          lazy: true },
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp',          lazy: true },
  { id: 'tasks',  name: 'Tasks',  type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://tasks.chitty.cc/mcp',     lazy: true },
];

const FOCUS_PROFILES: FocusProfiles = {
  profiles: { code: { categories: [], servers: ['neon'], boost: 0.5 } },
};

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon',   FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  backend.defineServer('tasks',  FIXTURE_SERVERS.tasks);
  const dlq = join(tmpdir(), `ch1tty-fl-${process.pid}-${Date.now()}.jsonl`);
  const opts: Record<string, unknown> = {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq,
    focusProfiles: FOCUS_PROFILES,
    coordinator: new NullRoutingCoordinator(),
  };
  return new Aggregator(CONFIGS, opts as Parameters<typeof Aggregator>[1]);
}

// ── Exact key sets measured 2026-09-20 ──────────────────────────────────────

const NO_FOCUS_FULL_KEYS: readonly string[] = [
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

const FOCUS_FULL_KEYS: readonly string[] = [
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

// focus-only keys: present in FOCUS_FULL_KEYS but not in NO_FOCUS_FULL_KEYS
const FOCUS_ONLY_KEYS: readonly string[] = FOCUS_FULL_KEYS.filter(
  (k) => !(NO_FOCUS_FULL_KEYS as readonly string[]).includes(k),
);

// ── FL-1: verbosity:full no-focus → exact 56-key set ───────────────────────

test('FL-1: verbosity:full no-focus — exact 56-key set', async () => {
  const agg = makeAgg();
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list database projects',
      explain: true,
      verbosity: 'full',
    });
    assert.equal(result.isError, undefined, 'cast should not error');
    const body = JSON.parse((result.content[0] as { text: string }).text);
    assert.ok(body.explanation !== undefined, 'explanation must be present');
    const actual = Object.keys(body.explanation).sort();
    assert.deepEqual(actual, [...NO_FOCUS_FULL_KEYS].sort(),
      'verbosity:full no-focus explanation keys must match frozen set exactly');
  } finally {
    await agg.shutdown();
  }
});

// ── FL-2: verbosity:full focus:code → exact 87-key set ─────────────────────

test('FL-2: verbosity:full focus:code — exact 87-key set', async () => {
  const agg = makeAgg();
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list database projects',
      explain: true,
      verbosity: 'full',
      focus: 'code',
    });
    assert.equal(result.isError, undefined, 'cast should not error');
    const body = JSON.parse((result.content[0] as { text: string }).text);
    assert.ok(body.explanation !== undefined, 'explanation must be present');
    const actual = Object.keys(body.explanation).sort();
    assert.deepEqual(actual, [...FOCUS_FULL_KEYS].sort(),
      'verbosity:full focus:code explanation keys must match frozen set exactly');
  } finally {
    await agg.shutdown();
  }
});

// ── FL-3: no-focus → focus-only keys must be absent ────────────────────────

test('FL-3: verbosity:full no-focus — focus-only keys absent', async () => {
  const agg = makeAgg();
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list database projects',
      explain: true,
      verbosity: 'full',
    });
    assert.equal(result.isError, undefined);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    const expl = body.explanation as Record<string, unknown>;
    const leaked = FOCUS_ONLY_KEYS.filter((k) => k in expl);
    assert.deepEqual(leaked, [],
      `focus-only keys must be absent when no focus active; found: ${leaked.join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

// ── FL-4: focus:code → all focus-only keys must be present ─────────────────

test('FL-4: verbosity:full focus:code — all focus-only keys present', async () => {
  const agg = makeAgg();
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list database projects',
      explain: true,
      verbosity: 'full',
      focus: 'code',
    });
    assert.equal(result.isError, undefined);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    const expl = body.explanation as Record<string, unknown>;
    const missing = FOCUS_ONLY_KEYS.filter((k) => !(k in expl));
    assert.deepEqual(missing, [],
      `focus-only keys must be present when focus:code active; missing: ${missing.join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});
