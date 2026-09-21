/**
 * DW: Drift guard — cast explain field NAMES.
 *
 * Complements zzzz-cast-explain-field-count-drift-guard.test.ts (which guards
 * the COUNT of explain fields). The count guard catches additions; this guard
 * catches RENAMES — a rename leaves the count unchanged but silently breaks
 * every API client relying on a specific field name.
 *
 * CLAUDE.md declares a metric freeze on buildCastExplanation: no new fields,
 * no renames. These two tests together fully enforce that contract.
 *
 * Field names frozen 2026-09-19:
 *   no-focus,   verbosity:full, multi-candidate: 56 fields
 *   with-focus, verbosity:full, multi-candidate: 87 fields (56 + 31 focus-specific)
 *
 * If a test fails with an UNEXPECTED name: a rename or new field was added —
 *   REJECT per CLAUDE.md § buildCastExplanation metric freeze.
 * If a test fails with a MISSING name: a field was intentionally removed —
 *   update the frozen set below only after confirming the removal intent.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

const DLQ = join(tmpdir(), `ch1tty-dw-fieldnames-${Date.now()}.jsonl`);

// ── Frozen field name sets (2026-09-19) ────────────────────────────────────

/** 56 fields present when no focus profile is active (verbosity:full). */
const NO_FOCUS_FIELD_NAMES: readonly string[] = [
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

/**
 * 31 additional fields present ONLY when a focus profile is active.
 * Full with-focus set = NO_FOCUS_FIELD_NAMES ∪ FOCUS_ONLY_FIELD_NAMES (87 total).
 */
const FOCUS_ONLY_FIELD_NAMES: readonly string[] = [
  'candidatesInFocusCount',
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
  'outOfFocusBottomScore',
  'outOfFocusCandidatesCount',
  'outOfFocusMeanScore',
  'outOfFocusWinnerGap',
  'rawFocusMargin',
  'rawFocusMarginRatio',
  'runnerUpFocusBoost',
  'runnerUpFocusBoostRatio',
  'runnerUpInFocus',
  'runnerUpScoreBase',
  'topOutOfFocusScore',
  'winnerFocusBoost',
  'winnerFocusBoostRatio',
  'winnerInFocus',
  'winnerScoreBase',
];

// ── Fixture setup ───────────────────────────────────────────────────────────

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
    ledgerDlqPath: DLQ,
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

test('cast explain field names — no focus — exact frozen set (56 names)', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list database projects',
      explain: true,
      verbosity: 'full',
    });
    assert.equal(result.isError, undefined, 'cast should not error');
    const body = JSON.parse((result.content[0] as { text: string }).text);
    assert.ok(body.explanation !== undefined, 'explanation field must be present');

    const actual = Object.keys(body.explanation).sort();
    const expected = [...NO_FOCUS_FIELD_NAMES].sort();

    const unexpected = actual.filter((f) => !expected.includes(f));
    const missing = expected.filter((f) => !actual.includes(f));

    assert.deepEqual(
      unexpected,
      [],
      `Unexpected explain fields (new metric added — REJECT per CLAUDE.md metric freeze): ${unexpected.join(', ')}`,
    );
    assert.deepEqual(
      missing,
      [],
      `Missing explain fields (field renamed or removed — update frozen set after confirming intent): ${missing.join(', ')}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('cast explain field names — focus:code active — exact frozen set (87 names)', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list database projects',
      explain: true,
      verbosity: 'full',
      focus: 'code',
    });
    assert.equal(result.isError, undefined, 'cast should not error');
    const body = JSON.parse((result.content[0] as { text: string }).text);
    assert.ok(body.explanation !== undefined, 'explanation field must be present');

    const actual = Object.keys(body.explanation).sort();
    const expectedSet = new Set([...NO_FOCUS_FIELD_NAMES, ...FOCUS_ONLY_FIELD_NAMES]);
    const expected = [...expectedSet].sort();

    const unexpected = actual.filter((f) => !expectedSet.has(f));
    const missing = expected.filter((f) => !actual.includes(f));

    assert.deepEqual(
      unexpected,
      [],
      `Unexpected explain fields with focus (new metric added — REJECT per CLAUDE.md metric freeze): ${unexpected.join(', ')}`,
    );
    assert.deepEqual(
      missing,
      [],
      `Missing explain fields with focus (field renamed or removed — update frozen set after confirming intent): ${missing.join(', ')}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('cast explain — focus-only fields absent when no focus active', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list database projects',
      explain: true,
      verbosity: 'full',
    });
    assert.equal(result.isError, undefined, 'cast should not error');
    const body = JSON.parse((result.content[0] as { text: string }).text);
    const actual = new Set(Object.keys(body.explanation));
    const leaking = FOCUS_ONLY_FIELD_NAMES.filter((f) => actual.has(f));
    assert.deepEqual(
      leaking,
      [],
      `Focus-only fields leaked into no-focus explain output: ${leaking.join(', ')}`,
    );
  } finally {
    await agg.shutdown();
  }
});
