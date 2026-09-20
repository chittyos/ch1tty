/**
 * FQ: Drift guard — cast explain field VALUE TYPES for verbosity:'full',
 * single-candidate (exactly one tool in registry).
 *
 * EY (ey-cast-explain-single-candidate-full-verbosity.test.ts) froze the
 * field NAMES for single-candidate at verbosity:'full'. FQ freezes the VALUE
 * TYPES of those same fields. A change in type (e.g. scoreDominanceIndex from
 * number → undefined, or topCandidatesMeanScore becoming NaN) would pass EY's
 * name-only guards silently.
 *
 * EZ freezes value types for single-candidate at verbosity:low/medium; FQ
 * extends that coverage to verbosity:'full', which emits additional fields:
 *   scoreDominanceIndex, topCandidatesMeanScore
 * and with focus active:
 *   focusRankPercentile, inFocusBottomScore, inFocusMeanScore, inFocusTopScore,
 *   outOfFocusCandidatesCount, winnerFocusBoostRatio
 *
 * Single-candidate invariants at verbosity:'full':
 *   - scoreDominanceIndex === 1.0 (sole candidate holds 100% of score mass)
 *   - topCandidatesMeanScore === winnerScore (mean of 1 item)
 *   - runner-up fields absent (runnerUpScore, runnerUpTool, …)
 *   - distribution fields absent (candidateScoreSpread, candidateScoreStdDev, …)
 *   - focus-decisiveness fields absent (focusDecisive, focusMargin, …)
 *   - outOfFocusCandidatesCount === 0 (sole tool is in-focus)
 *   - inFocusTopScore === inFocusMeanScore === inFocusBottomScore (1-item group)
 *
 * CLAUDE.md § buildCastExplanation metric freeze applies here.
 * If a test fails with an unexpected type, a field's type changed —
 * REJECT per the metric freeze; update only after confirming intent.
 *
 * ── verbosity:'full', no focus, single-candidate (9 fields) ─────────────────
 *   candidateCount        → number, integer === 1
 *   method                → string, non-empty
 *   rationale             → string, non-empty
 *   scoreDominanceIndex   → number, finite, === 1.0 (single candidate)
 *   topCandidates         → Array, length === 1
 *   topCandidatesMeanScore → number, finite, ≥ 0, === winnerScore
 *   winnerCategory        → string, non-empty
 *   winnerScore           → number, finite, > 0
 *   winnerServer          → string, non-empty
 *
 * ── verbosity:'full', focus:code, single-candidate (adds 15 fields) ─────────
 *   candidatesInFocusCount → number, integer === 1
 *   focus                  → string === 'code'
 *   focusBoost             → number, finite, ≥ 0
 *   focusRank              → number, integer === 1
 *   focusRankDelta         → number, integer === 0
 *   focusRankPercentile    → number, finite, ∈ [0, 1]
 *   inFocusBottomScore     → number, finite, ≥ 0 (=== inFocusMeanScore === inFocusTopScore)
 *   inFocusFraction        → number, finite, === 1.0
 *   inFocusMeanScore       → number, finite, ≥ 0
 *   inFocusTopScore        → number, finite, ≥ 0
 *   outOfFocusCandidatesCount → number, integer === 0
 *   winnerFocusBoost       → number, finite, ≥ 0
 *   winnerFocusBoostRatio  → number, finite, ∈ [0, 1]
 *   winnerInFocus          → boolean === true
 *   winnerScoreBase        → number, finite, ≥ 0
 *
 * Frozen 2026-09-20.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// Suppress OllamaBrain routing so full-verbosity field sets are deterministic.
class NullRoutingCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

const FOCUS_PROFILES = {
  profiles: {
    code: { categories: ['code'] as string[], boost: 0.5 },
  },
};

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-fq-${Date.now()}-${++dlqSeq}.jsonl`);
}

function makeAggregator(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('solo', {
    tools: [{
      name: 'list_projects',
      description: 'List all Neon database projects in the account',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: '[]' }] },
    }],
  });
  const configs: ServerConfig[] = [
    { id: 'solo', name: 'Solo DB', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://solo.example.com/mcp', lazy: true },
  ];
  const dlqPath = dlq();
  return new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlqPath,
    focusProfiles: FOCUS_PROFILES,
    coordinator: new NullRoutingCoordinator({}, { enabled: false }, dlqPath),
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

// ── Suite 1: verbosity:'full', no focus ───────────────────────────────────────

describe('FQ — single-candidate value types at verbosity:full (no focus)', () => {
  test('FQ-1: all full-verbosity scalar fields have correct types (candidateCount===1)', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list neon database projects',
        explain: true,
        verbosity: 'full',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = parseBody(result);
      const exp = getExplanation(body);

      // candidateCount: exactly 1 (single-candidate invariant)
      assert.equal(typeof exp['candidateCount'], 'number', 'candidateCount must be a number');
      assert.ok(Number.isInteger(exp['candidateCount'] as number), 'candidateCount must be an integer');
      assert.equal(exp['candidateCount'], 1, 'candidateCount must be exactly 1 for single-candidate');

      // method: non-empty string
      assert.equal(typeof exp['method'], 'string', 'method must be a string');
      assert.ok((exp['method'] as string).length > 0, 'method must be non-empty');

      // rationale: non-empty string
      assert.equal(typeof exp['rationale'], 'string', 'rationale must be a string');
      assert.ok((exp['rationale'] as string).length > 0, 'rationale must be non-empty');

      // scoreDominanceIndex: finite number ∈ [0, 1], === 1.0 for single candidate
      assert.equal(typeof exp['scoreDominanceIndex'], 'number', 'scoreDominanceIndex must be a number');
      assert.ok(Number.isFinite(exp['scoreDominanceIndex'] as number), 'scoreDominanceIndex must be finite');
      assert.ok((exp['scoreDominanceIndex'] as number) >= 0, 'scoreDominanceIndex must be ≥ 0');
      assert.ok((exp['scoreDominanceIndex'] as number) <= 1, 'scoreDominanceIndex must be ≤ 1');
      assert.equal(exp['scoreDominanceIndex'], 1, 'scoreDominanceIndex must be 1.0 for single-candidate (sole score holder)');

      // topCandidates: array of exactly length 1
      assert.ok(Array.isArray(exp['topCandidates']), 'topCandidates must be an array');
      assert.equal((exp['topCandidates'] as unknown[]).length, 1, 'topCandidates must have exactly 1 entry for single-candidate');

      // winnerScore: finite number > 0
      assert.equal(typeof exp['winnerScore'], 'number', 'winnerScore must be a number');
      assert.ok(Number.isFinite(exp['winnerScore'] as number), 'winnerScore must be finite');
      assert.ok((exp['winnerScore'] as number) > 0, 'winnerScore must be > 0');

      // topCandidatesMeanScore: finite number ≥ 0, equals winnerScore (mean of 1 item)
      assert.equal(typeof exp['topCandidatesMeanScore'], 'number', 'topCandidatesMeanScore must be a number');
      assert.ok(Number.isFinite(exp['topCandidatesMeanScore'] as number), 'topCandidatesMeanScore must be finite');
      assert.ok((exp['topCandidatesMeanScore'] as number) >= 0, 'topCandidatesMeanScore must be ≥ 0');
      assert.equal(
        exp['topCandidatesMeanScore'],
        exp['winnerScore'],
        'topCandidatesMeanScore must equal winnerScore for single-candidate (mean of 1)',
      );

      // winnerCategory: non-empty string
      assert.equal(typeof exp['winnerCategory'], 'string', 'winnerCategory must be a string');
      assert.ok((exp['winnerCategory'] as string).length > 0, 'winnerCategory must be non-empty');

      // winnerServer: non-empty string
      assert.equal(typeof exp['winnerServer'], 'string', 'winnerServer must be a string');
      assert.ok((exp['winnerServer'] as string).length > 0, 'winnerServer must be non-empty');
    } finally {
      await agg.shutdown();
    }
  });

  test('FQ-1b: runner-up, distribution, and focus fields absent at verbosity:full (single-candidate, no focus)', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list neon database projects',
        explain: true,
        verbosity: 'full',
        dryRun: true,
      });
      assert.equal(result.isError, undefined);
      const body = parseBody(result);
      const exp = getExplanation(body);

      // runner-up fields must be absent (require candidateCount > 1)
      assert.equal(exp['runnerUpScore'], undefined, 'runnerUpScore must be absent for single-candidate');
      assert.equal(exp['runnerUpTool'], undefined, 'runnerUpTool must be absent for single-candidate');
      assert.equal(exp['runnerUpCategory'], undefined, 'runnerUpCategory must be absent for single-candidate');
      assert.equal(exp['runnerUpServer'], undefined, 'runnerUpServer must be absent for single-candidate');

      // distribution fields must be absent (require ≥2 candidates)
      assert.equal(exp['candidateScoreSpread'], undefined, 'candidateScoreSpread must be absent for single-candidate');
      assert.equal(exp['candidateScoreStdDev'], undefined, 'candidateScoreStdDev must be absent for single-candidate');
      assert.equal(exp['candidateScoreVariance'], undefined, 'candidateScoreVariance must be absent for single-candidate');
      assert.equal(exp['candidateGiniCoefficient'], undefined, 'candidateGiniCoefficient must be absent for single-candidate');
      assert.equal(exp['effectiveN'], undefined, 'effectiveN must be absent for single-candidate');

      // focus fields must be absent (no focus active)
      assert.equal(exp['focus'], undefined, 'focus must be absent when no focus profile selected');
      assert.equal(exp['focusBoost'], undefined, 'focusBoost must be absent when no focus profile selected');
      assert.equal(exp['focusDecisive'], undefined, 'focusDecisive must be absent for single-candidate and no focus');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 2: verbosity:'full', focus:code ─────────────────────────────────────

describe('FQ — single-candidate value types at verbosity:full (focus:code active)', () => {
  test('FQ-2: full+focus-specific field types and single-candidate invariants', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list neon database projects',
        explain: true,
        verbosity: 'full',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = parseBody(result);
      const exp = getExplanation(body);

      // candidateCount: exactly 1
      assert.equal(typeof exp['candidateCount'], 'number', 'candidateCount must be a number');
      assert.equal(exp['candidateCount'], 1, 'candidateCount must be exactly 1 for single-candidate');

      // scoreDominanceIndex: still 1.0 for single-candidate with focus
      assert.equal(typeof exp['scoreDominanceIndex'], 'number', 'scoreDominanceIndex must be a number');
      assert.ok(Number.isFinite(exp['scoreDominanceIndex'] as number), 'scoreDominanceIndex must be finite');
      assert.equal(exp['scoreDominanceIndex'], 1, 'scoreDominanceIndex must be 1.0 for single-candidate');

      // topCandidatesMeanScore: equals winnerScore (mean of 1)
      assert.equal(typeof exp['topCandidatesMeanScore'], 'number', 'topCandidatesMeanScore must be a number');
      assert.ok(Number.isFinite(exp['topCandidatesMeanScore'] as number), 'topCandidatesMeanScore must be finite');
      assert.equal(exp['topCandidatesMeanScore'], exp['winnerScore'], 'topCandidatesMeanScore must equal winnerScore for single-candidate');

      // candidatesInFocusCount: integer === 1 (sole tool is in-focus)
      assert.equal(typeof exp['candidatesInFocusCount'], 'number', 'candidatesInFocusCount must be a number');
      assert.ok(Number.isInteger(exp['candidatesInFocusCount'] as number), 'candidatesInFocusCount must be an integer');
      assert.equal(exp['candidatesInFocusCount'], 1, 'candidatesInFocusCount must be 1 (sole tool in-focus)');

      // outOfFocusCandidatesCount: integer === 0 (no out-of-focus candidates)
      assert.equal(typeof exp['outOfFocusCandidatesCount'], 'number', 'outOfFocusCandidatesCount must be a number');
      assert.ok(Number.isInteger(exp['outOfFocusCandidatesCount'] as number), 'outOfFocusCandidatesCount must be an integer');
      assert.equal(exp['outOfFocusCandidatesCount'], 0, 'outOfFocusCandidatesCount must be 0 for single-in-focus candidate');

      // focus: string === 'code'
      assert.equal(typeof exp['focus'], 'string', 'focus must be a string');
      assert.equal(exp['focus'], 'code', "focus must equal 'code'");

      // focusBoost: finite number ≥ 0
      assert.equal(typeof exp['focusBoost'], 'number', 'focusBoost must be a number');
      assert.ok(Number.isFinite(exp['focusBoost'] as number), 'focusBoost must be finite');
      assert.ok((exp['focusBoost'] as number) >= 0, 'focusBoost must be ≥ 0');

      // focusRank: integer === 1
      assert.equal(typeof exp['focusRank'], 'number', 'focusRank must be a number');
      assert.ok(Number.isInteger(exp['focusRank'] as number), 'focusRank must be an integer');
      assert.equal(exp['focusRank'], 1, 'focusRank must be 1 for single-candidate');

      // focusRankDelta: integer === 0 (rank unchanged: was 1, still 1)
      assert.equal(typeof exp['focusRankDelta'], 'number', 'focusRankDelta must be a number');
      assert.ok(Number.isInteger(exp['focusRankDelta'] as number), 'focusRankDelta must be an integer');
      assert.equal(exp['focusRankDelta'], 0, 'focusRankDelta must be 0 for single-candidate (rank unchanged)');

      // focusRankPercentile: finite number ∈ [0, 1]
      assert.equal(typeof exp['focusRankPercentile'], 'number', 'focusRankPercentile must be a number');
      assert.ok(Number.isFinite(exp['focusRankPercentile'] as number), 'focusRankPercentile must be finite');
      assert.ok((exp['focusRankPercentile'] as number) >= 0, 'focusRankPercentile must be ≥ 0');
      assert.ok((exp['focusRankPercentile'] as number) <= 1, 'focusRankPercentile must be ≤ 1');

      // inFocusFraction: finite number === 1.0 (all candidates are in-focus)
      assert.equal(typeof exp['inFocusFraction'], 'number', 'inFocusFraction must be a number');
      assert.ok(Number.isFinite(exp['inFocusFraction'] as number), 'inFocusFraction must be finite');
      assert.equal(exp['inFocusFraction'], 1, 'inFocusFraction must be 1.0 (all candidates in-focus)');

      // inFocusMeanScore: finite number ≥ 0
      assert.equal(typeof exp['inFocusMeanScore'], 'number', 'inFocusMeanScore must be a number');
      assert.ok(Number.isFinite(exp['inFocusMeanScore'] as number), 'inFocusMeanScore must be finite');
      assert.ok((exp['inFocusMeanScore'] as number) >= 0, 'inFocusMeanScore must be ≥ 0');

      // inFocusTopScore: finite number ≥ 0
      assert.equal(typeof exp['inFocusTopScore'], 'number', 'inFocusTopScore must be a number');
      assert.ok(Number.isFinite(exp['inFocusTopScore'] as number), 'inFocusTopScore must be finite');
      assert.ok((exp['inFocusTopScore'] as number) >= 0, 'inFocusTopScore must be ≥ 0');

      // inFocusBottomScore: finite number ≥ 0
      assert.equal(typeof exp['inFocusBottomScore'], 'number', 'inFocusBottomScore must be a number');
      assert.ok(Number.isFinite(exp['inFocusBottomScore'] as number), 'inFocusBottomScore must be finite');
      assert.ok((exp['inFocusBottomScore'] as number) >= 0, 'inFocusBottomScore must be ≥ 0');

      // winnerInFocus: boolean === true (sole tool is in-focus)
      assert.equal(typeof exp['winnerInFocus'], 'boolean', 'winnerInFocus must be a boolean');
      assert.equal(exp['winnerInFocus'], true, 'winnerInFocus must be true (sole tool is in-focus)');

      // winnerFocusBoost: finite number ≥ 0
      assert.equal(typeof exp['winnerFocusBoost'], 'number', 'winnerFocusBoost must be a number');
      assert.ok(Number.isFinite(exp['winnerFocusBoost'] as number), 'winnerFocusBoost must be finite');
      assert.ok((exp['winnerFocusBoost'] as number) >= 0, 'winnerFocusBoost must be ≥ 0');

      // winnerFocusBoostRatio: finite number ∈ [0, 1]
      assert.equal(typeof exp['winnerFocusBoostRatio'], 'number', 'winnerFocusBoostRatio must be a number');
      assert.ok(Number.isFinite(exp['winnerFocusBoostRatio'] as number), 'winnerFocusBoostRatio must be finite');
      assert.ok((exp['winnerFocusBoostRatio'] as number) >= 0, 'winnerFocusBoostRatio must be ≥ 0');
      assert.ok((exp['winnerFocusBoostRatio'] as number) <= 1, 'winnerFocusBoostRatio must be ≤ 1');

      // winnerScoreBase: finite number ≥ 0
      assert.equal(typeof exp['winnerScoreBase'], 'number', 'winnerScoreBase must be a number');
      assert.ok(Number.isFinite(exp['winnerScoreBase'] as number), 'winnerScoreBase must be finite');
      assert.ok((exp['winnerScoreBase'] as number) >= 0, 'winnerScoreBase must be ≥ 0');

      // focus-decisiveness fields absent (require > 1 candidate)
      assert.equal(exp['focusDecisive'], undefined, 'focusDecisive must be absent for single-candidate');
      assert.equal(exp['focusMargin'], undefined, 'focusMargin must be absent for single-candidate');
      assert.equal(exp['focusConfidence'], undefined, 'focusConfidence must be absent for single-candidate');
      assert.equal(exp['unfocusedWinner'], undefined, 'unfocusedWinner must be absent for single-candidate');
    } finally {
      await agg.shutdown();
    }
  });

  test('FQ-2b: cross-field invariants at verbosity:full with focus:code (single-candidate)', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list neon database projects',
        explain: true,
        verbosity: 'full',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined);
      const body = parseBody(result);
      const exp = getExplanation(body);

      // score decomposition: winnerScoreBase + winnerFocusBoost === winnerScore
      const base = exp['winnerScoreBase'] as number;
      const boost = exp['winnerFocusBoost'] as number;
      const total = exp['winnerScore'] as number;
      assert.ok(
        Math.abs(base + boost - total) < 1e-10,
        `winnerScoreBase (${base}) + winnerFocusBoost (${boost}) must equal winnerScore (${total})`,
      );

      // single in-focus item: top === mean === bottom
      const top = exp['inFocusTopScore'] as number;
      const mean = exp['inFocusMeanScore'] as number;
      const bottom = exp['inFocusBottomScore'] as number;
      assert.equal(top, mean, 'inFocusTopScore must equal inFocusMeanScore for single in-focus candidate');
      assert.equal(mean, bottom, 'inFocusMeanScore must equal inFocusBottomScore for single in-focus candidate');

      // focusRankDelta identity: focusRankDelta === focusRank - 1 (from EZ-4b)
      const focusRank = exp['focusRank'] as number;
      const focusRankDelta = exp['focusRankDelta'] as number;
      assert.equal(
        focusRankDelta,
        focusRank - 1,
        `focusRankDelta (${focusRankDelta}) must equal focusRank - 1 (${focusRank - 1})`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});
