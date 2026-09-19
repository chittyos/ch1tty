/**
 * EY: Drift guard — cast explain exact field names for single-candidate
 * (no runner-up) at verbosity:'full'.
 *
 * EX (ex-cast-explain-single-candidate-fieldnames.test.ts) freezes field names
 * for single-candidate at verbosity:'low' and verbosity:'medium'. EY extends
 * that coverage to verbosity:'full', which emits a qualitatively different
 * (larger) field set: full verbosity adds scoreDominanceIndex,
 * topCandidatesMeanScore, and (when focus is active) a richer focus sub-object
 * (outOfFocusCandidatesCount, focusRankPercentile, inFocusTopScore/Mean/Bottom,
 * winnerFocusBoostRatio) compared to medium verbosity.
 *
 * The invariants that DO NOT change from EX:
 *   - runner-up fields remain absent (topCandidates.length > 1 required)
 *   - distribution fields remain absent (scoredTools.length ≥ 2 required):
 *     candidateScoreSpread, candidateGiniCoefficient, candidateScoreVariance,
 *     candidateScoreStdDev, effectiveN, topCandidatesScoreVariance, etc.
 *   - focus-decisiveness fields remain absent (topCandidates.length > 1 required):
 *     focusDecisive, focusMargin, focusConfidence, runnerUpInFocus
 *   - unfocusedWinner remains absent (only one candidate; focus cannot change winner)
 *
 * CLAUDE.md § buildCastExplanation metric freeze applies here.
 * If a test fails with an UNEXPECTED name, a new field was added —
 * REJECT per the metric freeze; update only after confirming intent.
 * If it fails with a MISSING name, a field was intentionally removed —
 * update the frozen set only after confirming the removal.
 *
 * ── verbosity:'full', no focus, single-candidate (9 fields) ─────────────────
 *   candidateCount, method, rationale, scoreDominanceIndex, topCandidates,
 *   topCandidatesMeanScore, winnerCategory, winnerScore, winnerServer
 *
 * ── verbosity:'full', focus:code, single-candidate, winner in-focus (24 fields)
 *   candidateCount, candidatesInFocusCount, focus, focusBoost, focusRank,
 *   focusRankDelta, focusRankPercentile, inFocusBottomScore, inFocusMeanScore,
 *   inFocusTopScore, inFocusFraction, method, outOfFocusCandidatesCount,
 *   rationale, scoreDominanceIndex, topCandidates, topCandidatesMeanScore,
 *   winnerCategory, winnerFocusBoost, winnerFocusBoostRatio, winnerInFocus,
 *   winnerScore, winnerScoreBase, winnerServer
 *
 * Frozen 2026-09-19.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// ── Frozen field name sets ────────────────────────────────────────────────────

const FULL_NO_FOCUS_SINGLE: readonly string[] = [
  'candidateCount',
  'method',
  'rationale',
  'scoreDominanceIndex',
  'topCandidates',
  'topCandidatesMeanScore',
  'winnerCategory',
  'winnerScore',
  'winnerServer',
];

const FULL_FOCUS_SINGLE: readonly string[] = [
  'candidateCount',
  'candidatesInFocusCount',
  'focus',
  'focusBoost',
  'focusRank',
  'focusRankDelta',
  'focusRankPercentile',
  'inFocusBottomScore',
  'inFocusFraction',
  'inFocusMeanScore',
  'inFocusTopScore',
  'method',
  'outOfFocusCandidatesCount',
  'rationale',
  'scoreDominanceIndex',
  'topCandidates',
  'topCandidatesMeanScore',
  'winnerCategory',
  'winnerFocusBoost',
  'winnerFocusBoostRatio',
  'winnerInFocus',
  'winnerScore',
  'winnerScoreBase',
  'winnerServer',
];

// ── Fixture setup ─────────────────────────────────────────────────────────────
// Single server + single tool guarantees exactly 1 candidate when the query
// matches. The solo/list_projects description overlaps strongly with the
// 'list neon database projects' intent (keywords: list, neon, database, projects).

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-ey-${Date.now()}-${++dlqSeq}.jsonl`);
}

const FOCUS_PROFILES = {
  profiles: {
    code: { categories: ['code'] as string[], boost: 0.5 },
  },
};

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

// ── Suite 1: verbosity:'full', no focus ──────────────────────────────────────

describe('EY — verbosity:full, no focus, single-candidate field names', () => {
  test('exact frozen field set: 9 names (no runner-up, no distribution fields)', async () => {
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
      assert.ok(body['explanation'] !== undefined, 'explanation must be present when explain:true');
      const ex = getExplanation(body);
      assert.equal((ex['candidateCount'] as number), 1, 'single-candidate fixture must yield candidateCount===1');

      // Verify absent multi-candidate fields
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'runnerUpScore'), 'runnerUpScore must be absent for single-candidate');
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'runnerUpTool'), 'runnerUpTool must be absent for single-candidate');
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'candidateScoreSpread'), 'candidateScoreSpread must be absent for single-candidate');
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'candidateGiniCoefficient'), 'candidateGiniCoefficient must be absent (< 2 candidates)');
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'candidateScoreVariance'), 'candidateScoreVariance must be absent (< 2 candidates)');
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'effectiveN'), 'effectiveN must be absent (< 2 candidates)');
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'topCandidatesScoreVariance'), 'topCandidatesScoreVariance must be absent (< 2 topCandidates)');

      // Verify scoreDominanceIndex and topCandidatesMeanScore are present (full-verbosity-only)
      assert.equal(typeof ex['scoreDominanceIndex'], 'number', 'scoreDominanceIndex must be a number at verbosity:full');
      assert.ok(Number.isFinite(ex['scoreDominanceIndex'] as number), 'scoreDominanceIndex must be finite');
      assert.ok((ex['scoreDominanceIndex'] as number) > 0, 'scoreDominanceIndex must be > 0');
      assert.ok((ex['scoreDominanceIndex'] as number) <= 1, 'scoreDominanceIndex must be ≤ 1 (single candidate = 1.0)');
      assert.equal(typeof ex['topCandidatesMeanScore'], 'number', 'topCandidatesMeanScore must be a number at verbosity:full');

      const actual = Object.keys(ex).sort();
      const expected = [...FULL_NO_FOCUS_SINGLE].sort();
      assert.deepEqual(
        actual,
        expected,
        `verbosity:full single-candidate no-focus field names drifted.\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 2: verbosity:'full', focus:code ─────────────────────────────────────

describe('EY — verbosity:full, focus:code, single-candidate field names', () => {
  test('exact frozen field set: 24 names (no focusDecisive/focusMargin/unfocusedWinner/runner-up)', async () => {
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
      assert.ok(body['explanation'] !== undefined, 'explanation must be present when explain:true');
      const ex = getExplanation(body);
      assert.equal((ex['candidateCount'] as number), 1, 'single-candidate fixture must yield candidateCount===1');

      // Verify focus-decisiveness fields are absent (require topCandidates.length > 1)
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'focusDecisive'), 'focusDecisive must be absent for single-candidate');
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'focusMargin'), 'focusMargin must be absent for single-candidate');
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'focusConfidence'), 'focusConfidence must be absent for single-candidate');
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'runnerUpInFocus'), 'runnerUpInFocus must be absent for single-candidate');

      // unfocusedWinner is absent: only one candidate, focus cannot change winner
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'unfocusedWinner'), 'unfocusedWinner must be absent (only 1 candidate)');

      // out-of-focus aggregate fields are absent (solo tool is in-focus)
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'topOutOfFocusScore'), 'topOutOfFocusScore must be absent (no out-of-focus candidates)');
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'outOfFocusMeanScore'), 'outOfFocusMeanScore must be absent (no out-of-focus candidates)');
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'outOfFocusBottomScore'), 'outOfFocusBottomScore must be absent (no out-of-focus candidates)');

      // Verify full-verbosity-exclusive focus fields are present
      assert.equal(typeof ex['focusRankPercentile'], 'number', 'focusRankPercentile must be a number (full-verbosity-only)');
      assert.equal(ex['focusRankPercentile'], 1, 'single candidate has focusRankPercentile === 1 (rank 1 of 1)');
      assert.equal(typeof ex['inFocusTopScore'], 'number', 'inFocusTopScore must be a number (full-verbosity-only)');
      assert.equal(typeof ex['inFocusMeanScore'], 'number', 'inFocusMeanScore must be a number (full-verbosity-only)');
      assert.equal(typeof ex['inFocusBottomScore'], 'number', 'inFocusBottomScore must be a number (full-verbosity-only)');
      assert.equal(typeof ex['winnerFocusBoostRatio'], 'number', 'winnerFocusBoostRatio must be a number (full-verbosity-only)');
      assert.equal((ex['outOfFocusCandidatesCount'] as number), 0, 'outOfFocusCandidatesCount must be 0 (sole tool is in-focus)');

      const actual = Object.keys(ex).sort();
      const expected = [...FULL_FOCUS_SINGLE].sort();
      assert.deepEqual(
        actual,
        expected,
        `verbosity:full focus:code single-candidate field names drifted.\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});
