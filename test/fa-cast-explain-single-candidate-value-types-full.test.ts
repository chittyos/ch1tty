/**
 * FA: Drift guard — cast explain VALUE TYPES for verbosity:'full', single-candidate.
 *
 * EZ (ez-cast-explain-single-candidate-value-types-low-medium.test.ts) freezes
 * value types for single-candidate at verbosity:'low' and verbosity:'medium'.
 * FA extends that to verbosity:'full', which emits a different field set from
 * low/medium. A type change on any full-only scalar (e.g. scoreDominanceIndex
 * from number → undefined, or topCandidatesMeanScore from number → string)
 * would pass EZ silently because EZ never calls with verbosity:'full'.
 *
 * Fixture: one server ('solo', category 'code') with one tool ('list_projects').
 * With a single tool in the registry, candidateCount is always 1 and every
 * multi-candidate field (runnerUp*, distribution stats, topCandidates*Variance,
 * etc.) must be absent regardless of verbosity.
 *
 * CLAUDE.md § buildCastExplanation metric freeze applies here:
 * if a test fails with an unexpected type, a field's type was changed —
 * REJECT per the metric freeze; update only after confirming intent.
 *
 * ── full-verbosity scalars, single-candidate (no focus) ──────────────────────
 *   method               → string (non-empty)
 *   candidateCount       → integer === 1
 *   winnerScore          → number (finite > 0)
 *   winnerServer         → string (non-empty)
 *   winnerCategory       → string (non-empty)
 *   topCandidatesMeanScore → number (finite > 0, === winnerScore for 1 candidate)
 *   scoreDominanceIndex  → number === 1.0 (winner holds all score mass)
 *   topCandidates        → Array of length 1
 *   rationale            → string (non-empty)
 *
 * ── multi-candidate fields — absent for single-candidate ─────────────────────
 *   runnerUpScore / runnerUpTool / runnerUpServer / runnerUpCategory
 *   candidateScoreSpread / candidateScoreMean / lowestCandidateScore
 *   candidateScoreVariance / candidateScoreStdDev / medianCandidateScore
 *   topCandidatesScoreVariance / topCandidatesScoreStdDev
 *   candidateScoreHerfindahlIndex / effectiveN / topHeavinessRatio
 *
 * ── focus field types, single in-focus candidate ─────────────────────────────
 *   focus              → string (non-empty, profile name)
 *   focusBoost         → number (finite ≥ 0)
 *   winnerInFocus      → boolean === true
 *   winnerFocusBoost   → number === focusBoost
 *   winnerScoreBase    → number (finite ≥ 0)
 *   candidatesInFocusCount    → integer === 1
 *   outOfFocusCandidatesCount → integer === 0
 *   inFocusFraction    → number === 1.0
 *   focusRank          → integer === 1
 *   focusRankDelta     → integer === 0
 *   focusRankPercentile → number === 1.0
 *   inFocusTopScore / inFocusMeanScore / inFocusBottomScore → number === winnerScore
 *   winnerFocusBoostRatio → number ∈ [0, 1]
 *
 * ── runner-up focus fields — absent for single-candidate ─────────────────────
 *   focusDecisive / focusMargin / focusMarginRatio
 *   runnerUpInFocus / runnerUpFocusBoost / runnerUpScoreBase
 *   rawFocusMargin / focusNetBoostDelta / focusBias / focusConfidence
 *   topOutOfFocusScore / outOfFocusWinnerGap / outOfFocusMeanScore / outOfFocusBottomScore
 *
 * Frozen 2026-09-19.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { RoutedTool, ToolCandidate } from '../src/ollama-brain.js';
import type { ServerConfig } from '../src/types.js';

// Keyword-only stub — never invokes OllamaBrain, keeps tests hermetic under
// CH1TTY_USE_OLLAMA_BRAIN=1.
class StubCoordinator extends SessionCoordinator {
  constructor() {
    super({}, { enabled: false });
  }
  override async routeIntent(_query: string, _candidates: ToolCandidate[]): Promise<RoutedTool[] | null> {
    return null;
  }
}

// ── Fixture setup ─────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-fa-${Date.now()}-${++dlqSeq}.jsonl`);
}

const FOCUS_PROFILES = {
  profiles: {
    code: { categories: ['code'] as string[], servers: [] as string[], boost: 0.5 },
  },
};

/** Single-server, single-tool fixture — guarantees candidateCount === 1. */
function makeSoloAggregator(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('solo', {
    tools: [
      {
        name: 'list_projects',
        description: 'List all Neon database projects in the account',
        inputSchema: { type: 'object', properties: {} },
        response: {
          content: [{ type: 'text', text: '[]' }],
          isError: undefined,
        },
      },
    ],
  });
  const configs: ServerConfig[] = [
    {
      id: 'solo',
      name: 'Solo',
      type: 'remote',
      access: 'readwrite',
      category: 'code',
      endpoint: 'https://solo.example.com/mcp',
      lazy: true,
    },
  ];
  return new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    coordinator: new StubCoordinator(),
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

// ── Suite FA-1: core scalar value types at full verbosity, no focus ────────────

describe('FA-1 — core scalar value types at verbosity:full, single-candidate, no focus', () => {
  test('method, candidateCount, winnerScore, winnerServer, winnerCategory, topCandidatesMeanScore, scoreDominanceIndex, topCandidates have correct types', async () => {
    const agg = makeSoloAggregator();
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

      // method: non-empty string
      assert.equal(typeof exp['method'], 'string', 'method must be a string');
      assert.ok((exp['method'] as string).length > 0, 'method must be non-empty');

      // candidateCount: exactly 1
      assert.equal(typeof exp['candidateCount'], 'number', 'candidateCount must be a number');
      assert.ok(Number.isInteger(exp['candidateCount'] as number), 'candidateCount must be an integer');
      assert.equal(exp['candidateCount'], 1, 'candidateCount must be exactly 1 for single-candidate');

      // winnerScore: finite number > 0
      assert.equal(typeof exp['winnerScore'], 'number', 'winnerScore must be a number');
      assert.ok(Number.isFinite(exp['winnerScore'] as number), 'winnerScore must be finite');
      assert.ok((exp['winnerScore'] as number) > 0, 'winnerScore must be > 0');

      // winnerServer: non-empty string
      assert.equal(typeof exp['winnerServer'], 'string', 'winnerServer must be a string');
      assert.ok((exp['winnerServer'] as string).length > 0, 'winnerServer must be non-empty');

      // winnerCategory: non-empty string
      assert.equal(typeof exp['winnerCategory'], 'string', 'winnerCategory must be a string');
      assert.ok((exp['winnerCategory'] as string).length > 0, 'winnerCategory must be non-empty');

      // topCandidatesMeanScore: finite number > 0; equals winnerScore for single-candidate
      assert.equal(typeof exp['topCandidatesMeanScore'], 'number', 'topCandidatesMeanScore must be a number');
      assert.ok(Number.isFinite(exp['topCandidatesMeanScore'] as number), 'topCandidatesMeanScore must be finite');
      assert.ok((exp['topCandidatesMeanScore'] as number) > 0, 'topCandidatesMeanScore must be > 0');
      assert.equal(exp['topCandidatesMeanScore'], exp['winnerScore'], 'topCandidatesMeanScore must equal winnerScore for single-candidate');

      // scoreDominanceIndex: exactly 1.0 (winner holds all score mass)
      assert.equal(typeof exp['scoreDominanceIndex'], 'number', 'scoreDominanceIndex must be a number');
      assert.equal(exp['scoreDominanceIndex'], 1, 'scoreDominanceIndex must be 1.0 for single-candidate');

      // topCandidates: array of length 1
      assert.ok(Array.isArray(exp['topCandidates']), 'topCandidates must be an array');
      assert.equal((exp['topCandidates'] as unknown[]).length, 1, 'topCandidates.length must be 1');

      // rationale: non-empty string
      assert.equal(typeof exp['rationale'], 'string', 'rationale must be a string');
      assert.ok((exp['rationale'] as string).length > 0, 'rationale must be non-empty');
    } finally {
      await agg.shutdown?.();
    }
  });
});

// ── Suite FA-1b: multi-candidate stats absent for single-candidate ─────────────

describe('FA-1b — multi-candidate fields absent at verbosity:full, single-candidate', () => {
  test('runnerUp* and distribution stats are absent', async () => {
    const agg = makeSoloAggregator();
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

      // Runner-up fields — absent when topCandidates.length === 1
      assert.equal(exp['runnerUpScore'], undefined, 'runnerUpScore must be absent');
      assert.equal(exp['runnerUpTool'], undefined, 'runnerUpTool must be absent');
      assert.equal(exp['runnerUpServer'], undefined, 'runnerUpServer must be absent');
      assert.equal(exp['runnerUpCategory'], undefined, 'runnerUpCategory must be absent');

      // Distribution fields — absent when scoredTools.length < 2
      assert.equal(exp['candidateScoreSpread'], undefined, 'candidateScoreSpread must be absent');
      assert.equal(exp['candidateScoreMean'], undefined, 'candidateScoreMean must be absent');
      assert.equal(exp['lowestCandidateScore'], undefined, 'lowestCandidateScore must be absent');
      assert.equal(exp['candidateScoreVariance'], undefined, 'candidateScoreVariance must be absent');
      assert.equal(exp['candidateScoreStdDev'], undefined, 'candidateScoreStdDev must be absent');
      assert.equal(exp['medianCandidateScore'], undefined, 'medianCandidateScore must be absent');

      // Concentration + entropy fields — absent when scoredTools.length < 2
      assert.equal(exp['candidateScoreHerfindahlIndex'], undefined, 'candidateScoreHerfindahlIndex must be absent');
      assert.equal(exp['effectiveN'], undefined, 'effectiveN must be absent');
      assert.equal(exp['topHeavinessRatio'], undefined, 'topHeavinessRatio must be absent');
      assert.equal(exp['candidateScoreEntropy'], undefined, 'candidateScoreEntropy must be absent');
      assert.equal(exp['nonZeroCandidateFraction'], undefined, 'nonZeroCandidateFraction must be absent');

      // topCandidates* stats — absent when topCandidates.length < 2
      assert.equal(exp['topCandidatesScoreVariance'], undefined, 'topCandidatesScoreVariance must be absent');
      assert.equal(exp['topCandidatesScoreStdDev'], undefined, 'topCandidatesScoreStdDev must be absent');
      assert.equal(exp['topCandidatesGiniCoefficient'], undefined, 'topCandidatesGiniCoefficient must be absent');
      assert.equal(exp['topCandidatesScoreSkewness'], undefined, 'topCandidatesScoreSkewness must be absent');
      assert.equal(exp['topCandidatesKurtosis'], undefined, 'topCandidatesKurtosis must be absent');
    } finally {
      await agg.shutdown?.();
    }
  });
});

// ── Suite FA-2: focus field types at full verbosity, single in-focus candidate ──

describe('FA-2 — focus field value types at verbosity:full, single in-focus candidate', () => {
  test('focus, focusBoost, winnerInFocus, winnerFocusBoost, winnerScoreBase, in-focus counts, focusRank, inFocusScore group have correct types', async () => {
    const agg = makeSoloAggregator();
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

      // focus: non-empty string === 'code'
      assert.equal(typeof exp['focus'], 'string', 'focus must be a string');
      assert.equal(exp['focus'], 'code', 'focus must equal the active profile name');

      // focusBoost: finite number ≥ 0
      assert.equal(typeof exp['focusBoost'], 'number', 'focusBoost must be a number');
      assert.ok(Number.isFinite(exp['focusBoost'] as number), 'focusBoost must be finite');
      assert.ok((exp['focusBoost'] as number) >= 0, 'focusBoost must be ≥ 0');

      // winnerInFocus: boolean === true (solo server is in the 'code' category)
      assert.equal(typeof exp['winnerInFocus'], 'boolean', 'winnerInFocus must be a boolean');
      assert.equal(exp['winnerInFocus'], true, 'winnerInFocus must be true for in-focus winner');

      // winnerFocusBoost: number === focusBoost
      assert.equal(typeof exp['winnerFocusBoost'], 'number', 'winnerFocusBoost must be a number');
      assert.equal(exp['winnerFocusBoost'], exp['focusBoost'], 'winnerFocusBoost must equal focusBoost when winner is in-focus');

      // winnerScoreBase: finite number ≥ 0
      assert.equal(typeof exp['winnerScoreBase'], 'number', 'winnerScoreBase must be a number');
      assert.ok(Number.isFinite(exp['winnerScoreBase'] as number), 'winnerScoreBase must be finite');
      assert.ok((exp['winnerScoreBase'] as number) >= 0, 'winnerScoreBase must be ≥ 0');

      // candidatesInFocusCount: integer === 1 (the single candidate is in-focus)
      assert.equal(typeof exp['candidatesInFocusCount'], 'number', 'candidatesInFocusCount must be a number');
      assert.ok(Number.isInteger(exp['candidatesInFocusCount'] as number), 'candidatesInFocusCount must be an integer');
      assert.equal(exp['candidatesInFocusCount'], 1, 'candidatesInFocusCount must be 1');

      // outOfFocusCandidatesCount: integer === 0 (no out-of-focus candidates)
      assert.equal(typeof exp['outOfFocusCandidatesCount'], 'number', 'outOfFocusCandidatesCount must be a number');
      assert.ok(Number.isInteger(exp['outOfFocusCandidatesCount'] as number), 'outOfFocusCandidatesCount must be an integer');
      assert.equal(exp['outOfFocusCandidatesCount'], 0, 'outOfFocusCandidatesCount must be 0');

      // inFocusFraction: number === 1.0 (all candidates in-focus)
      assert.equal(typeof exp['inFocusFraction'], 'number', 'inFocusFraction must be a number');
      assert.equal(exp['inFocusFraction'], 1.0, 'inFocusFraction must be 1.0 for single in-focus candidate');

      // focusRank: integer === 1 (only candidate)
      assert.equal(typeof exp['focusRank'], 'number', 'focusRank must be a number');
      assert.ok(Number.isInteger(exp['focusRank'] as number), 'focusRank must be an integer');
      assert.equal(exp['focusRank'], 1, 'focusRank must be 1 for single candidate');

      // focusRankDelta: integer === 0
      assert.equal(typeof exp['focusRankDelta'], 'number', 'focusRankDelta must be a number');
      assert.ok(Number.isInteger(exp['focusRankDelta'] as number), 'focusRankDelta must be an integer');
      assert.equal(exp['focusRankDelta'], 0, 'focusRankDelta must be 0 (rank unchanged)');

      // focusRankPercentile: number === 1.0 (1/1)
      assert.equal(typeof exp['focusRankPercentile'], 'number', 'focusRankPercentile must be a number');
      assert.equal(exp['focusRankPercentile'], 1.0, 'focusRankPercentile must be 1.0 for single candidate');

      // inFocusTopScore / inFocusMeanScore / inFocusBottomScore: all equal winnerScore
      assert.equal(typeof exp['inFocusTopScore'], 'number', 'inFocusTopScore must be a number');
      assert.ok(Number.isFinite(exp['inFocusTopScore'] as number), 'inFocusTopScore must be finite');
      assert.equal(typeof exp['inFocusMeanScore'], 'number', 'inFocusMeanScore must be a number');
      assert.ok(Number.isFinite(exp['inFocusMeanScore'] as number), 'inFocusMeanScore must be finite');
      assert.equal(typeof exp['inFocusBottomScore'], 'number', 'inFocusBottomScore must be a number');
      assert.ok(Number.isFinite(exp['inFocusBottomScore'] as number), 'inFocusBottomScore must be finite');

      // winnerFocusBoostRatio: number ∈ [0, 1]
      assert.equal(typeof exp['winnerFocusBoostRatio'], 'number', 'winnerFocusBoostRatio must be a number');
      assert.ok((exp['winnerFocusBoostRatio'] as number) >= 0, 'winnerFocusBoostRatio must be ≥ 0');
      assert.ok((exp['winnerFocusBoostRatio'] as number) <= 1, 'winnerFocusBoostRatio must be ≤ 1');
    } finally {
      await agg.shutdown?.();
    }
  });
});

// ── Suite FA-2b: runner-up focus fields absent for single-candidate ──────────

describe('FA-2b — runner-up focus fields absent at verbosity:full, single-candidate', () => {
  test('focusDecisive, focusMargin, runnerUpFocus*, rawFocusMargin, out-of-focus group all absent', async () => {
    const agg = makeSoloAggregator();
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

      // Runner-up conditional focus fields — absent when topCandidates.length === 1
      assert.equal(exp['focusDecisive'], undefined, 'focusDecisive must be absent');
      assert.equal(exp['focusMargin'], undefined, 'focusMargin must be absent');
      assert.equal(exp['focusMarginRatio'], undefined, 'focusMarginRatio must be absent');
      assert.equal(exp['focusBias'], undefined, 'focusBias must be absent');
      assert.equal(exp['focusConfidence'], undefined, 'focusConfidence must be absent');
      assert.equal(exp['runnerUpInFocus'], undefined, 'runnerUpInFocus must be absent');
      assert.equal(exp['runnerUpFocusBoost'], undefined, 'runnerUpFocusBoost must be absent');
      assert.equal(exp['runnerUpScoreBase'], undefined, 'runnerUpScoreBase must be absent');
      assert.equal(exp['rawFocusMargin'], undefined, 'rawFocusMargin must be absent');
      assert.equal(exp['rawFocusMarginRatio'], undefined, 'rawFocusMarginRatio must be absent');
      assert.equal(exp['focusNetBoostDelta'], undefined, 'focusNetBoostDelta must be absent');
      assert.equal(exp['runnerUpFocusBoostRatio'], undefined, 'runnerUpFocusBoostRatio must be absent');

      // Out-of-focus group — absent when all candidates are in-focus
      assert.equal(exp['topOutOfFocusScore'], undefined, 'topOutOfFocusScore must be absent');
      assert.equal(exp['outOfFocusWinnerGap'], undefined, 'outOfFocusWinnerGap must be absent');
      assert.equal(exp['outOfFocusMeanScore'], undefined, 'outOfFocusMeanScore must be absent');
      assert.equal(exp['outOfFocusBottomScore'], undefined, 'outOfFocusBottomScore must be absent');

      // unfocusedWinner — absent when focus didn't change the top result
      assert.equal(exp['unfocusedWinner'], undefined, 'unfocusedWinner must be absent');

      // inFocusWinnerGap — absent when winnerInFocus is true
      assert.equal(exp['inFocusWinnerGap'], undefined, 'inFocusWinnerGap must be absent');
    } finally {
      await agg.shutdown?.();
    }
  });
});

// ── Suite FA-2c: identity invariants for single in-focus candidate ─────────────

describe('FA-2c — identity invariants at verbosity:full, single in-focus candidate', () => {
  test('winnerScoreBase + winnerFocusBoost === winnerScore; focusRankDelta === focusRank − 1; inFocusScores === winnerScore', async () => {
    const agg = makeSoloAggregator();
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

      const winnerScore = exp['winnerScore'] as number;
      const winnerScoreBase = exp['winnerScoreBase'] as number;
      const winnerFocusBoost = exp['winnerFocusBoost'] as number;
      const focusRank = exp['focusRank'] as number;
      const focusRankDelta = exp['focusRankDelta'] as number;

      // Score decomposition: winnerScoreBase + winnerFocusBoost === winnerScore
      assert.ok(
        Math.abs((winnerScoreBase + winnerFocusBoost) - winnerScore) < 1e-10,
        `winnerScoreBase (${winnerScoreBase}) + winnerFocusBoost (${winnerFocusBoost}) must equal winnerScore (${winnerScore})`
      );

      // focusRankDelta === focusRank − 1 (rank index offset identity)
      assert.equal(focusRankDelta, focusRank - 1, 'focusRankDelta must equal focusRank − 1');

      // Single in-focus candidate: all three inFocus scores equal winnerScore
      assert.equal(exp['inFocusTopScore'], winnerScore, 'inFocusTopScore must equal winnerScore');
      assert.equal(exp['inFocusMeanScore'], winnerScore, 'inFocusMeanScore must equal winnerScore');
      assert.equal(exp['inFocusBottomScore'], winnerScore, 'inFocusBottomScore must equal winnerScore');
    } finally {
      await agg.shutdown?.();
    }
  });
});
