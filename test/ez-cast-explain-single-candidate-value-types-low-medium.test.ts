/**
 * EZ: Drift guard — cast explain field VALUE TYPES for verbosity:'low' and
 * verbosity:'medium', single-candidate (exactly one tool in registry).
 *
 * EX (ex-cast-explain-single-candidate-explain-fieldnames.test.ts) froze the
 * field NAMES for single-candidate at low/medium verbosity. EZ freezes the
 * VALUE TYPES of those same fields. A change in type (e.g. winnerScore from
 * number → string, or candidateCount from number → undefined) would pass EX's
 * name-only guards silently.
 *
 * EU/EV freeze value types for multi-candidate. The single-candidate shape
 * differs materially:
 *   - candidateCount === 1 (exact equality, not ≥ 1)
 *   - topCandidates.length === 1 (exact, not just non-empty)
 *   - runner-up fields (runnerUpScore, runnerUpTool, runnerUpCategory,
 *     runnerUpServer) are absent — EZ asserts they are absent
 *   - statistical fields requiring ≥2 samples (candidateScoreMean,
 *     candidateScoreSpread, candidateScoreStdDev, medianCandidateScore)
 *     are absent — EZ asserts they are absent
 *   - focusDecisive, focusMargin, focusConfidence are absent (require
 *     topCandidates.length > 1) — EZ asserts they are absent
 *   - candidatesInFocusCount === 1, inFocusFraction === 1.0,
 *     focusRank === 1, focusRankDelta === 0 (single-in-focus invariants)
 *
 * CLAUDE.md § buildCastExplanation metric freeze applies here.
 * If a test fails with an unexpected type, a field's type was changed —
 * REJECT per the metric freeze; update only after confirming intent.
 *
 * ── verbosity:'low', no focus, single-candidate (6 fields) ──────────────────
 *   candidateCount  → number === 1
 *   method          → string (non-empty)
 *   rationale       → string (non-empty)
 *   topCandidates   → Array length === 1
 *   winnerScore     → number (finite, > 0)
 *   winnerServer    → string (non-empty)
 *
 * ── verbosity:'medium', no focus, single-candidate (1 extra field) ───────────
 *   winnerCategory  → string (non-empty)
 *
 * ── verbosity:'low', focus:code, single-candidate (3 extra fields) ──────────
 *   focus           → string === 'code'
 *   focusBoost      → number (finite, ≥ 0)
 *   winnerInFocus   → boolean === true
 *
 * ── verbosity:'medium', focus:code, single-candidate (6 extra fields) ───────
 *   candidatesInFocusCount → number (integer === 1)
 *   focusRank              → number (integer === 1)
 *   focusRankDelta         → number (integer === 0)
 *   inFocusFraction        → number (finite === 1.0)
 *   winnerFocusBoost       → number (finite, ≥ 0)
 *   winnerScoreBase        → number (finite, ≥ 0)
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

// ── Fixture: single server with one tool ──────────────────────────────────────

const SOLO_SERVER_DEF = {
  tools: [
    {
      name: 'list_projects',
      description: 'List all Neon database projects in the account',
      inputSchema: { type: 'object', properties: {} } as Record<string, unknown>,
      response: {
        content: [{ type: 'text' as const, text: JSON.stringify([
          { id: 'proj-abc123', name: 'ch1tty-prod', region: 'us-east-2' },
        ]) }],
      },
    },
  ],
};

const FOCUS_PROFILES = {
  profiles: {
    code: { categories: ['code'] as string[], servers: ['solo'] as string[], boost: 0.5 },
  },
};

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-ez-${Date.now()}-${++dlqSeq}.jsonl`);
}

function makeAggregator(withFocus = false): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('solo', SOLO_SERVER_DEF);
  const configs: ServerConfig[] = [
    { id: 'solo', name: 'Solo', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://solo.test/mcp', lazy: true },
  ];
  return new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    ...(withFocus ? { focusProfiles: FOCUS_PROFILES } : {}),
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

// ── Suite 1: verbosity:'low', no focus ────────────────────────────────────────

describe('EZ — single-candidate value types at verbosity:low (no focus)', () => {
  test('EZ-1: all low-verbosity scalar fields have correct types (candidateCount===1)', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list neon database projects',
        explain: true,
        verbosity: 'low',
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

      // topCandidates: array of exactly length 1
      assert.ok(Array.isArray(exp['topCandidates']), 'topCandidates must be an array');
      assert.equal((exp['topCandidates'] as unknown[]).length, 1, 'topCandidates must have exactly 1 entry for single-candidate');

      // winnerScore: finite number > 0
      assert.equal(typeof exp['winnerScore'], 'number', 'winnerScore must be a number');
      assert.ok(Number.isFinite(exp['winnerScore'] as number), 'winnerScore must be finite');
      assert.ok((exp['winnerScore'] as number) > 0, 'winnerScore must be > 0');

      // winnerServer: non-empty string
      assert.equal(typeof exp['winnerServer'], 'string', 'winnerServer must be a string');
      assert.ok((exp['winnerServer'] as string).length > 0, 'winnerServer must be non-empty');
    } finally {
      await agg.shutdown();
    }
  });

  test('EZ-1b: runner-up and statistical fields absent at verbosity:low (single-candidate)', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list neon database projects',
        explain: true,
        verbosity: 'low',
        dryRun: true,
      });
      assert.equal(result.isError, undefined);
      const body = parseBody(result);
      const exp = getExplanation(body);

      // runner-up fields must be absent (require candidateCount > 1)
      assert.equal(exp['runnerUpScore'], undefined, 'runnerUpScore must be absent for single-candidate');
      assert.equal(exp['runnerUpTool'], undefined, 'runnerUpTool must be absent for single-candidate');

      // statistical fields must be absent (require ≥2 samples)
      assert.equal(exp['candidateScoreMean'], undefined, 'candidateScoreMean must be absent for single-candidate');
      assert.equal(exp['candidateScoreSpread'], undefined, 'candidateScoreSpread must be absent for single-candidate');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 2: verbosity:'medium', no focus ─────────────────────────────────────

describe('EZ — single-candidate value types at verbosity:medium (no focus)', () => {
  test('EZ-2: winnerCategory is a non-empty string at verbosity:medium (single-candidate)', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list neon database projects',
        explain: true,
        verbosity: 'medium',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = parseBody(result);
      const exp = getExplanation(body);

      // winnerCategory: non-empty string (medium-verbosity addition)
      assert.equal(typeof exp['winnerCategory'], 'string', 'winnerCategory must be a string');
      assert.ok((exp['winnerCategory'] as string).length > 0, 'winnerCategory must be non-empty');

      // candidateCount still === 1
      assert.equal(exp['candidateCount'], 1, 'candidateCount must be exactly 1');

      // topCandidates still length 1
      assert.equal((exp['topCandidates'] as unknown[]).length, 1, 'topCandidates must have exactly 1 entry');

      // medium-only statistical fields absent for single-candidate
      assert.equal(exp['candidateScoreMean'], undefined, 'candidateScoreMean must be absent for single-candidate');
      assert.equal(exp['candidateScoreSpread'], undefined, 'candidateScoreSpread must be absent for single-candidate');
      assert.equal(exp['candidateScoreStdDev'], undefined, 'candidateScoreStdDev must be absent for single-candidate');
      assert.equal(exp['medianCandidateScore'], undefined, 'medianCandidateScore must be absent for single-candidate');
      assert.equal(exp['runnerUpCategory'], undefined, 'runnerUpCategory must be absent for single-candidate');
      assert.equal(exp['runnerUpServer'], undefined, 'runnerUpServer must be absent for single-candidate');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 3: verbosity:'low', focus:code ─────────────────────────────────────

describe('EZ — single-candidate value types at verbosity:low (focus:code active)', () => {
  test('EZ-3: focus-specific field types correct at verbosity:low (single-candidate)', async () => {
    const agg = makeAggregator(true);
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list neon database projects',
        explain: true,
        verbosity: 'low',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = parseBody(result);
      const exp = getExplanation(body);

      // focus: string === 'code'
      assert.equal(typeof exp['focus'], 'string', 'focus must be a string');
      assert.equal(exp['focus'], 'code', "focus must equal 'code'");

      // focusBoost: finite number ≥ 0
      assert.equal(typeof exp['focusBoost'], 'number', 'focusBoost must be a number');
      assert.ok(Number.isFinite(exp['focusBoost'] as number), 'focusBoost must be finite');
      assert.ok((exp['focusBoost'] as number) >= 0, 'focusBoost must be ≥ 0');

      // winnerInFocus: boolean === true (single tool is in focus)
      assert.equal(typeof exp['winnerInFocus'], 'boolean', 'winnerInFocus must be a boolean');
      assert.equal(exp['winnerInFocus'], true, 'winnerInFocus must be true (sole tool is in focus)');

      // candidateCount: still exactly 1
      assert.equal(exp['candidateCount'], 1, 'candidateCount must be exactly 1');

      // focusDecisive absent (requires > 1 candidate)
      assert.equal(exp['focusDecisive'], undefined, 'focusDecisive must be absent for single-candidate');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 4: verbosity:'medium', focus:code ───────────────────────────────────

describe('EZ — single-candidate value types at verbosity:medium (focus:code active)', () => {
  test('EZ-4: additional medium+focus field types and single-candidate invariants', async () => {
    const agg = makeAggregator(true);
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list neon database projects',
        explain: true,
        verbosity: 'medium',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = parseBody(result);
      const exp = getExplanation(body);

      // candidatesInFocusCount: integer === 1 (the only tool is in focus)
      assert.equal(typeof exp['candidatesInFocusCount'], 'number', 'candidatesInFocusCount must be a number');
      assert.ok(Number.isInteger(exp['candidatesInFocusCount'] as number), 'candidatesInFocusCount must be an integer');
      assert.equal(exp['candidatesInFocusCount'], 1, 'candidatesInFocusCount must be 1 (sole tool is in-focus)');

      // focusRank: integer === 1 (only candidate; always rank 1)
      assert.equal(typeof exp['focusRank'], 'number', 'focusRank must be a number');
      assert.ok(Number.isInteger(exp['focusRank'] as number), 'focusRank must be an integer');
      assert.equal(exp['focusRank'], 1, 'focusRank must be 1 for single-candidate');

      // focusRankDelta: integer === 0 (rank was 1 before and after focus; no change)
      assert.equal(typeof exp['focusRankDelta'], 'number', 'focusRankDelta must be a number');
      assert.ok(Number.isInteger(exp['focusRankDelta'] as number), 'focusRankDelta must be an integer');
      assert.equal(exp['focusRankDelta'], 0, 'focusRankDelta must be 0 for single-candidate (rank unchanged)');

      // inFocusFraction: finite number, must equal 1.0 (1 in-focus / 1 total)
      assert.equal(typeof exp['inFocusFraction'], 'number', 'inFocusFraction must be a number');
      assert.ok(Number.isFinite(exp['inFocusFraction'] as number), 'inFocusFraction must be finite');
      assert.equal(exp['inFocusFraction'], 1, 'inFocusFraction must be 1.0 (all candidates are in-focus)');

      // winnerFocusBoost: finite number ≥ 0
      assert.equal(typeof exp['winnerFocusBoost'], 'number', 'winnerFocusBoost must be a number');
      assert.ok(Number.isFinite(exp['winnerFocusBoost'] as number), 'winnerFocusBoost must be finite');
      assert.ok((exp['winnerFocusBoost'] as number) >= 0, 'winnerFocusBoost must be ≥ 0');

      // winnerScoreBase: finite number ≥ 0
      assert.equal(typeof exp['winnerScoreBase'], 'number', 'winnerScoreBase must be a number');
      assert.ok(Number.isFinite(exp['winnerScoreBase'] as number), 'winnerScoreBase must be finite');
      assert.ok((exp['winnerScoreBase'] as number) >= 0, 'winnerScoreBase must be ≥ 0');

      // score decomposition: winnerScoreBase + winnerFocusBoost === winnerScore
      const base = exp['winnerScoreBase'] as number;
      const boost = exp['winnerFocusBoost'] as number;
      const total = exp['winnerScore'] as number;
      assert.ok(
        Math.abs(base + boost - total) < 1e-10,
        `winnerScoreBase (${base}) + winnerFocusBoost (${boost}) must equal winnerScore (${total})`,
      );

      // focusMargin and focusConfidence absent (require > 1 candidate)
      assert.equal(exp['focusMargin'], undefined, 'focusMargin must be absent for single-candidate');
      assert.equal(exp['focusConfidence'], undefined, 'focusConfidence must be absent for single-candidate');
      assert.equal(exp['focusDecisive'], undefined, 'focusDecisive must be absent for single-candidate');

      // unfocusedWinner absent (cannot change winner with single candidate)
      assert.equal(exp['unfocusedWinner'], undefined, 'unfocusedWinner must be absent for single-candidate');
    } finally {
      await agg.shutdown();
    }
  });

  test('EZ-4b: focusRankDelta identity (focusRank - 1) holds for single-candidate', async () => {
    const agg = makeAggregator(true);
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list neon database projects',
        explain: true,
        verbosity: 'medium',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined);
      const body = parseBody(result);
      const exp = getExplanation(body);
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
