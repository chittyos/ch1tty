/**
 * EV: Drift guard — cast explain field VALUE TYPES for verbosity:'full'.
 *
 * EU (eu-cast-explain-value-types-low-medium.test.ts) freezes value types for
 * verbosity:'low' and verbosity:'medium'. EV extends that coverage to
 * verbosity:'full', which emits 56 fields (no focus) vs 8/15 for low/medium.
 * A type regression on any full-verbosity-exclusive field (e.g. converting a
 * number to string, or returning undefined instead of a number) would pass EU
 * silently because EU never calls with verbosity:'full'.
 *
 * CLAUDE.md § buildCastExplanation metric freeze applies here.
 * If a test fails with an unexpected type, a field's type was changed —
 * REJECT per the metric freeze; update only after confirming intent.
 *
 * ── core scalars (always present when best !== undefined) ────────────────────
 *   method               → string (non-empty)
 *   candidateCount       → integer ≥ 1
 *   rationale            → string (non-empty)
 *   winnerScore          → number (finite > 0)
 *   winnerServer         → string (non-empty)
 *   winnerCategory       → string (non-empty)
 *   topCandidatesMeanScore → number (finite ≥ 0)
 *   scoreDominanceIndex  → number (finite ∈ (0, 1])
 *
 * ── runner-up + distribution (present when ≥ 2 candidates) ──────────────────
 *   runnerUpScore        → number (finite ≥ 0)
 *   runnerUpTool         → string (namespaced, contains '/')
 *   runnerUpServer       → string (non-empty)
 *   runnerUpCategory     → string (non-empty)
 *   candidateScoreSpread → number (finite ≥ 0)
 *   lowestCandidateScore → number (finite ≥ 0)
 *   candidateScoreMean   → number (finite ≥ 0)
 *
 * ── full-only numeric fields (conditional, present in 3-backend fixture) ─────
 *   candidateScoreVariance → number (finite ≥ 0)
 *   candidateScoreStdDev   → number (finite ≥ 0)
 *   candidateGiniCoefficient → number (finite ∈ [0, 1])
 *   topCandidatesScoreVariance → number (finite ≥ 0)
 *   effectiveN             → number (finite > 0)
 *
 * ── no_match (full verbosity) ────────────────────────────────────────────────
 *   candidateCount → number (=== 0)
 *   method         → string (non-empty)
 *   rationale      → string (non-empty)
 *   topCandidates  → Array (length === 0)
 *
 * Frozen 2026-09-19.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// ── Fixture setup ─────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-ev-${Date.now()}-${++dlqSeq}.jsonl`);
}

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
    ledgerDlqPath: dlq(),
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

// ── Suite 1: core scalar value types at verbosity:full ────────────────────────

describe('EV — core scalar value types at verbosity:full (multi-candidate)', () => {
  test('method, candidateCount, rationale, winnerScore, winnerServer, winnerCategory have correct types', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
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

      // candidateCount: integer ≥ 1
      assert.equal(typeof exp['candidateCount'], 'number', 'candidateCount must be a number');
      assert.ok(Number.isInteger(exp['candidateCount'] as number), 'candidateCount must be an integer');
      assert.ok((exp['candidateCount'] as number) >= 1, 'candidateCount must be ≥ 1 for multi-candidate');

      // rationale: non-empty string
      assert.equal(typeof exp['rationale'], 'string', 'rationale must be a string');
      assert.ok((exp['rationale'] as string).length > 0, 'rationale must be non-empty');

      // winnerScore: finite > 0
      assert.equal(typeof exp['winnerScore'], 'number', 'winnerScore must be a number');
      assert.ok(Number.isFinite(exp['winnerScore'] as number), 'winnerScore must be finite');
      assert.ok((exp['winnerScore'] as number) > 0, 'winnerScore must be > 0');

      // winnerServer: non-empty string
      assert.equal(typeof exp['winnerServer'], 'string', 'winnerServer must be a string');
      assert.ok((exp['winnerServer'] as string).length > 0, 'winnerServer must be non-empty');

      // winnerCategory: non-empty string
      assert.equal(typeof exp['winnerCategory'], 'string', 'winnerCategory must be a string');
      assert.ok((exp['winnerCategory'] as string).length > 0, 'winnerCategory must be non-empty');
    } finally {
      await agg.shutdown();
    }
  });

  test('topCandidatesMeanScore and scoreDominanceIndex have correct types', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'full',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = parseBody(result);
      const exp = getExplanation(body);

      // topCandidatesMeanScore: finite ≥ 0 (mean of topCandidates scores)
      assert.equal(typeof exp['topCandidatesMeanScore'], 'number', 'topCandidatesMeanScore must be a number');
      assert.ok(Number.isFinite(exp['topCandidatesMeanScore'] as number), 'topCandidatesMeanScore must be finite');
      assert.ok((exp['topCandidatesMeanScore'] as number) >= 0, 'topCandidatesMeanScore must be ≥ 0');

      // scoreDominanceIndex: finite in (0, 1] (winnerScore / total)
      assert.equal(typeof exp['scoreDominanceIndex'], 'number', 'scoreDominanceIndex must be a number');
      assert.ok(Number.isFinite(exp['scoreDominanceIndex'] as number), 'scoreDominanceIndex must be finite');
      assert.ok((exp['scoreDominanceIndex'] as number) > 0, 'scoreDominanceIndex must be > 0');
      assert.ok((exp['scoreDominanceIndex'] as number) <= 1, 'scoreDominanceIndex must be ≤ 1');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 2: runner-up + distribution types at verbosity:full ─────────────────

describe('EV — runner-up and distribution value types at verbosity:full', () => {
  test('runner-up fields have correct types', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'full',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = parseBody(result);
      const exp = getExplanation(body);

      // runnerUpScore: finite ≥ 0
      assert.equal(typeof exp['runnerUpScore'], 'number', 'runnerUpScore must be a number');
      assert.ok(Number.isFinite(exp['runnerUpScore'] as number), 'runnerUpScore must be finite');
      assert.ok((exp['runnerUpScore'] as number) >= 0, 'runnerUpScore must be ≥ 0');

      // runnerUpTool: namespaced string (contains '/')
      assert.equal(typeof exp['runnerUpTool'], 'string', 'runnerUpTool must be a string');
      assert.ok((exp['runnerUpTool'] as string).includes('/'), "runnerUpTool must be namespaced (contain '/')");

      // runnerUpServer: non-empty string
      assert.equal(typeof exp['runnerUpServer'], 'string', 'runnerUpServer must be a string');
      assert.ok((exp['runnerUpServer'] as string).length > 0, 'runnerUpServer must be non-empty');

      // runnerUpCategory: non-empty string
      assert.equal(typeof exp['runnerUpCategory'], 'string', 'runnerUpCategory must be a string');
      assert.ok((exp['runnerUpCategory'] as string).length > 0, 'runnerUpCategory must be non-empty');

      // candidateScoreSpread: finite ≥ 0
      assert.equal(typeof exp['candidateScoreSpread'], 'number', 'candidateScoreSpread must be a number');
      assert.ok(Number.isFinite(exp['candidateScoreSpread'] as number), 'candidateScoreSpread must be finite');
      assert.ok((exp['candidateScoreSpread'] as number) >= 0, 'candidateScoreSpread must be ≥ 0');

      // lowestCandidateScore: finite ≥ 0
      assert.equal(typeof exp['lowestCandidateScore'], 'number', 'lowestCandidateScore must be a number');
      assert.ok(Number.isFinite(exp['lowestCandidateScore'] as number), 'lowestCandidateScore must be finite');
      assert.ok((exp['lowestCandidateScore'] as number) >= 0, 'lowestCandidateScore must be ≥ 0');

      // candidateScoreMean: finite ≥ 0
      assert.equal(typeof exp['candidateScoreMean'], 'number', 'candidateScoreMean must be a number');
      assert.ok(Number.isFinite(exp['candidateScoreMean'] as number), 'candidateScoreMean must be finite');
      assert.ok((exp['candidateScoreMean'] as number) >= 0, 'candidateScoreMean must be ≥ 0');
    } finally {
      await agg.shutdown();
    }
  });

  test('ordering invariants: winnerScore ≥ runnerUpScore ≥ lowestCandidateScore', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'full',
        dryRun: true,
      });
      assert.equal(result.isError, undefined);
      const body = parseBody(result);
      const exp = getExplanation(body);
      const winner = exp['winnerScore'] as number;
      const runnerUp = exp['runnerUpScore'] as number;
      const lowest = exp['lowestCandidateScore'] as number;
      assert.ok(winner >= runnerUp, `winnerScore (${winner}) must be ≥ runnerUpScore (${runnerUp})`);
      assert.ok(runnerUp >= lowest, `runnerUpScore (${runnerUp}) must be ≥ lowestCandidateScore (${lowest})`);
      // spread = winnerScore - lowestCandidateScore (by definition in buildCastExplanation)
      const spread = exp['candidateScoreSpread'] as number;
      assert.ok(
        Math.abs(spread - (winner - lowest)) < 1e-10,
        `candidateScoreSpread (${spread}) must equal winnerScore - lowestCandidateScore (${winner - lowest})`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 3: full-only numeric fields ─────────────────────────────────────────

describe('EV — full-verbosity-exclusive numeric field value types', () => {
  test('candidateScoreVariance, candidateScoreStdDev, candidateGiniCoefficient, topCandidatesScoreVariance, effectiveN have correct types', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'full',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = parseBody(result);
      const exp = getExplanation(body);

      // candidateScoreVariance: finite ≥ 0
      assert.equal(typeof exp['candidateScoreVariance'], 'number', 'candidateScoreVariance must be a number');
      assert.ok(Number.isFinite(exp['candidateScoreVariance'] as number), 'candidateScoreVariance must be finite');
      assert.ok((exp['candidateScoreVariance'] as number) >= 0, 'candidateScoreVariance must be ≥ 0');

      // candidateScoreStdDev: finite ≥ 0 and = sqrt(variance)
      assert.equal(typeof exp['candidateScoreStdDev'], 'number', 'candidateScoreStdDev must be a number');
      assert.ok(Number.isFinite(exp['candidateScoreStdDev'] as number), 'candidateScoreStdDev must be finite');
      assert.ok((exp['candidateScoreStdDev'] as number) >= 0, 'candidateScoreStdDev must be ≥ 0');
      const variance = exp['candidateScoreVariance'] as number;
      const stddev = exp['candidateScoreStdDev'] as number;
      assert.ok(
        Math.abs(stddev - Math.sqrt(variance)) < 1e-10,
        `candidateScoreStdDev (${stddev}) must equal sqrt(candidateScoreVariance (${variance}))`,
      );

      // candidateGiniCoefficient: finite ∈ [0, 1]
      assert.equal(typeof exp['candidateGiniCoefficient'], 'number', 'candidateGiniCoefficient must be a number');
      assert.ok(Number.isFinite(exp['candidateGiniCoefficient'] as number), 'candidateGiniCoefficient must be finite');
      assert.ok((exp['candidateGiniCoefficient'] as number) >= 0, 'candidateGiniCoefficient must be ≥ 0');
      assert.ok((exp['candidateGiniCoefficient'] as number) <= 1, 'candidateGiniCoefficient must be ≤ 1');

      // topCandidatesScoreVariance: finite ≥ 0
      assert.equal(typeof exp['topCandidatesScoreVariance'], 'number', 'topCandidatesScoreVariance must be a number');
      assert.ok(Number.isFinite(exp['topCandidatesScoreVariance'] as number), 'topCandidatesScoreVariance must be finite');
      assert.ok((exp['topCandidatesScoreVariance'] as number) >= 0, 'topCandidatesScoreVariance must be ≥ 0');

      // effectiveN: finite > 0 (1 / herfindahlIndex)
      assert.equal(typeof exp['effectiveN'], 'number', 'effectiveN must be a number');
      assert.ok(Number.isFinite(exp['effectiveN'] as number), 'effectiveN must be finite');
      assert.ok((exp['effectiveN'] as number) > 0, 'effectiveN must be > 0');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 4: no_match value types at verbosity:full ───────────────────────────

describe('EV — explain field value types on no_match (verbosity:full)', () => {
  test('no_match verbosity:full — candidateCount===0, method/rationale strings, topCandidates empty', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'zzzzzzzzz_no_match_ev_test_xyz_9999',
        explain: true,
        verbosity: 'full',
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = parseBody(result);
      assert.equal(body['cast'], 'no_match', 'must be no_match');
      const exp = getExplanation(body);

      // candidateCount: number === 0
      assert.equal(typeof exp['candidateCount'], 'number', 'candidateCount must be a number');
      assert.equal(exp['candidateCount'], 0, 'candidateCount must be 0 on no_match');

      // method: non-empty string
      assert.equal(typeof exp['method'], 'string', 'method must be a string');
      assert.ok((exp['method'] as string).length > 0, 'method must be non-empty');

      // rationale: non-empty string
      assert.equal(typeof exp['rationale'], 'string', 'rationale must be a string');
      assert.ok((exp['rationale'] as string).length > 0, 'rationale must be non-empty');

      // topCandidates: empty array
      assert.ok(Array.isArray(exp['topCandidates']), 'topCandidates must be an array');
      assert.equal((exp['topCandidates'] as unknown[]).length, 0, 'topCandidates must be [] on no_match');
    } finally {
      await agg.shutdown();
    }
  });
});
