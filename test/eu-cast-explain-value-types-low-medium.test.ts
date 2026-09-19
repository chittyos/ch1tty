/**
 * EU: Drift guard — cast explain field VALUE TYPES for verbosity:'low' and verbosity:'medium'.
 *
 * ER (er-cast-explain-verbosity-low-medium-fieldnames.test.ts) freezes the
 * field NAMES at both verbosity tiers. EU freezes the VALUE TYPES of those
 * same fields. A change in type (e.g. winnerScore from number → string, or
 * method from string → object) would pass ER's name-only guards silently.
 *
 * CLAUDE.md § buildCastExplanation metric freeze applies here.
 * If a test fails with an unexpected type, a field's type was changed —
 * REJECT per the metric freeze; update only after confirming intent.
 *
 * ── verbosity:'low', no focus, multi-candidate (8 fields) ────────────────────
 *   candidateCount  → number (integer ≥ 1)
 *   method          → string (non-empty)
 *   rationale       → string (non-empty)
 *   runnerUpScore   → number (finite, ≥ 0)
 *   runnerUpTool    → string (non-empty, contains '/')
 *   topCandidates   → Array (non-empty)
 *   winnerScore     → number (finite, > 0)
 *   winnerServer    → string (non-empty)
 *
 * ── verbosity:'medium' additional fields (7 extra) ───────────────────────────
 *   candidateScoreMean   → number (finite, ≥ 0)
 *   candidateScoreSpread → number (finite, ≥ 0)
 *   candidateScoreStdDev → number (finite, ≥ 0)
 *   medianCandidateScore → number (finite, ≥ 0)
 *   runnerUpCategory     → string (non-empty)
 *   runnerUpServer       → string (non-empty)
 *   winnerCategory       → string (non-empty)
 *
 * ── no_match — both verbosities (4 fields) ───────────────────────────────────
 *   candidateCount  → number (=== 0)
 *   method          → string (non-empty)
 *   rationale       → string (non-empty)
 *   topCandidates   → Array (length === 0)
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
  return join(tmpdir(), `ch1tty-eu-${Date.now()}-${++dlqSeq}.jsonl`);
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

// ── Suite 1: verbosity:'low' value types ──────────────────────────────────────

describe('EU — explain field value types at verbosity:low (multi-candidate)', () => {
  test('all low verbosity scalar fields have correct types', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'low',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = parseBody(result);
      const exp = getExplanation(body);

      // candidateCount: integer ≥ 1
      assert.equal(typeof exp['candidateCount'], 'number', 'candidateCount must be a number');
      assert.ok(Number.isInteger(exp['candidateCount'] as number), 'candidateCount must be an integer');
      assert.ok((exp['candidateCount'] as number) >= 1, 'candidateCount must be ≥ 1 for multi-candidate');

      // method: non-empty string
      assert.equal(typeof exp['method'], 'string', 'method must be a string');
      assert.ok((exp['method'] as string).length > 0, 'method must be non-empty');

      // rationale: non-empty string
      assert.equal(typeof exp['rationale'], 'string', 'rationale must be a string');
      assert.ok((exp['rationale'] as string).length > 0, 'rationale must be non-empty');

      // runnerUpScore: finite number ≥ 0
      assert.equal(typeof exp['runnerUpScore'], 'number', 'runnerUpScore must be a number');
      assert.ok(Number.isFinite(exp['runnerUpScore'] as number), 'runnerUpScore must be finite');
      assert.ok((exp['runnerUpScore'] as number) >= 0, 'runnerUpScore must be ≥ 0');

      // runnerUpTool: non-empty string containing '/'
      assert.equal(typeof exp['runnerUpTool'], 'string', 'runnerUpTool must be a string');
      assert.ok((exp['runnerUpTool'] as string).length > 0, 'runnerUpTool must be non-empty');
      assert.ok((exp['runnerUpTool'] as string).includes('/'), "runnerUpTool must be namespaced (contain '/')");

      // topCandidates: non-empty array
      assert.ok(Array.isArray(exp['topCandidates']), 'topCandidates must be an array');
      assert.ok((exp['topCandidates'] as unknown[]).length > 0, 'topCandidates must be non-empty for multi-candidate');

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

  test('winnerScore > runnerUpScore at verbosity:low (winner always has the highest score)', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'low',
        dryRun: true,
      });
      assert.equal(result.isError, undefined);
      const body = parseBody(result);
      const exp = getExplanation(body);
      const winnerScore = exp['winnerScore'] as number;
      const runnerUpScore = exp['runnerUpScore'] as number;
      assert.ok(winnerScore >= runnerUpScore, `winnerScore (${winnerScore}) must be ≥ runnerUpScore (${runnerUpScore})`);
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 2: verbosity:'medium' value types ───────────────────────────────────

describe('EU — explain field value types at verbosity:medium (multi-candidate)', () => {
  test('all medium verbosity additional scalar fields have correct types', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'medium',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = parseBody(result);
      const exp = getExplanation(body);

      // All low-verbosity types also hold (winnerScore, method, etc.) — spot check
      assert.equal(typeof exp['winnerScore'], 'number', 'winnerScore must be a number');
      assert.ok(Number.isFinite(exp['winnerScore'] as number), 'winnerScore must be finite');
      assert.equal(typeof exp['method'], 'string', 'method must be a string');

      // candidateScoreMean: finite ≥ 0
      assert.equal(typeof exp['candidateScoreMean'], 'number', 'candidateScoreMean must be a number');
      assert.ok(Number.isFinite(exp['candidateScoreMean'] as number), 'candidateScoreMean must be finite');
      assert.ok((exp['candidateScoreMean'] as number) >= 0, 'candidateScoreMean must be ≥ 0');

      // candidateScoreSpread: finite ≥ 0
      assert.equal(typeof exp['candidateScoreSpread'], 'number', 'candidateScoreSpread must be a number');
      assert.ok(Number.isFinite(exp['candidateScoreSpread'] as number), 'candidateScoreSpread must be finite');
      assert.ok((exp['candidateScoreSpread'] as number) >= 0, 'candidateScoreSpread must be ≥ 0');

      // candidateScoreStdDev: finite ≥ 0
      assert.equal(typeof exp['candidateScoreStdDev'], 'number', 'candidateScoreStdDev must be a number');
      assert.ok(Number.isFinite(exp['candidateScoreStdDev'] as number), 'candidateScoreStdDev must be finite');
      assert.ok((exp['candidateScoreStdDev'] as number) >= 0, 'candidateScoreStdDev must be ≥ 0');

      // medianCandidateScore: finite ≥ 0
      assert.equal(typeof exp['medianCandidateScore'], 'number', 'medianCandidateScore must be a number');
      assert.ok(Number.isFinite(exp['medianCandidateScore'] as number), 'medianCandidateScore must be finite');
      assert.ok((exp['medianCandidateScore'] as number) >= 0, 'medianCandidateScore must be ≥ 0');

      // runnerUpCategory: non-empty string
      assert.equal(typeof exp['runnerUpCategory'], 'string', 'runnerUpCategory must be a string');
      assert.ok((exp['runnerUpCategory'] as string).length > 0, 'runnerUpCategory must be non-empty');

      // runnerUpServer: non-empty string
      assert.equal(typeof exp['runnerUpServer'], 'string', 'runnerUpServer must be a string');
      assert.ok((exp['runnerUpServer'] as string).length > 0, 'runnerUpServer must be non-empty');

      // winnerCategory: non-empty string
      assert.equal(typeof exp['winnerCategory'], 'string', 'winnerCategory must be a string');
      assert.ok((exp['winnerCategory'] as string).length > 0, 'winnerCategory must be non-empty');
    } finally {
      await agg.shutdown();
    }
  });

  test('score ordering invariant at verbosity:medium: winnerScore ≥ medianCandidateScore', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'medium',
        dryRun: true,
      });
      assert.equal(result.isError, undefined);
      const body = parseBody(result);
      const exp = getExplanation(body);
      const winnerScore = exp['winnerScore'] as number;
      const medianScore = exp['medianCandidateScore'] as number;
      assert.ok(winnerScore >= medianScore, `winnerScore (${winnerScore}) must be ≥ medianCandidateScore (${medianScore})`);
    } finally {
      await agg.shutdown();
    }
  });

  test('candidateScoreSpread ≥ candidateScoreStdDev at verbosity:medium (range ≥ std dev)', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'medium',
        dryRun: true,
      });
      assert.equal(result.isError, undefined);
      const body = parseBody(result);
      const exp = getExplanation(body);
      const spread = exp['candidateScoreSpread'] as number;
      const stddev = exp['candidateScoreStdDev'] as number;
      assert.ok(spread >= stddev - 1e-10, `candidateScoreSpread (${spread}) must be ≥ candidateScoreStdDev (${stddev})`);
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 3: no_match value types ────────────────────────────────────────────

describe('EU — explain field value types on no_match (both verbosities)', () => {
  test('no_match verbosity:low — 4 fields have correct types', async () => {
    const agg = makeAggregator();
    try {
      for (const verbosity of ['low', 'medium'] as const) {
        const result = await agg.callTool('ch1tty/cast', {
          intent: 'zzzzzzzzz_no_match_eu_test_xyz_9999',
          explain: true,
          verbosity,
        });
        assert.equal(result.isError, undefined, `cast should not error (${verbosity})`);
        const body = parseBody(result);
        assert.equal(body['cast'], 'no_match', `must be no_match (${verbosity})`);
        const exp = getExplanation(body);

        // candidateCount: number === 0
        assert.equal(typeof exp['candidateCount'], 'number', `candidateCount must be number (${verbosity})`);
        assert.equal(exp['candidateCount'], 0, `candidateCount must be 0 on no_match (${verbosity})`);

        // method: non-empty string
        assert.equal(typeof exp['method'], 'string', `method must be string (${verbosity})`);
        assert.ok((exp['method'] as string).length > 0, `method must be non-empty (${verbosity})`);

        // rationale: non-empty string
        assert.equal(typeof exp['rationale'], 'string', `rationale must be string (${verbosity})`);
        assert.ok((exp['rationale'] as string).length > 0, `rationale must be non-empty (${verbosity})`);

        // topCandidates: empty array
        assert.ok(Array.isArray(exp['topCandidates']), `topCandidates must be array (${verbosity})`);
        assert.equal((exp['topCandidates'] as unknown[]).length, 0, `topCandidates must be [] on no_match (${verbosity})`);
      }
    } finally {
      await agg.shutdown();
    }
  });
});
