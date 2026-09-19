/**
 * EZ: Drift guard — cast explain VALUE TYPES for verbosity:'low' and verbosity:'medium',
 * single-candidate.
 *
 * EU (eu-cast-explain-value-types-low-medium.test.ts) freezes value types for
 * low/medium verbosity with a multi-candidate fixture. EZ covers the
 * single-candidate branch: with candidateCount === 1, runner-up and distribution
 * fields that require ≥ 2 candidates must be absent, and the fields that are
 * present must still have the correct types.
 *
 * FA (fa-cast-explain-single-candidate-value-types-full.test.ts) is the companion
 * for verbosity:'full' with a single-candidate fixture.
 *
 * CLAUDE.md § buildCastExplanation metric freeze applies here:
 * if a test fails with an unexpected type, a field's type was changed —
 * REJECT per the metric freeze; update only after confirming intent.
 *
 * ── verbosity:'low', single-candidate (present fields) ───────────────────────
 *   method          → string (non-empty)
 *   candidateCount  → integer === 1
 *   winnerScore     → number (finite, > 0)
 *   winnerServer    → string (non-empty)
 *   topCandidates   → Array of length 1
 *   rationale       → string (non-empty)
 *
 * ── verbosity:'low', single-candidate (absent fields) ────────────────────────
 *   runnerUpScore   — absent (requires topCandidates.length > 1)
 *   runnerUpTool    — absent (requires topCandidates.length > 1)
 *
 * ── verbosity:'medium', single-candidate (additional present field) ───────────
 *   winnerCategory  → string (non-empty)
 *
 * ── verbosity:'medium', single-candidate (absent multi-candidate fields) ──────
 *   runnerUpScore / runnerUpTool / runnerUpCategory / runnerUpServer
 *   candidateScoreSpread / candidateScoreMean / candidateScoreStdDev
 *   medianCandidateScore
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

// ── Fixture setup ─────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-ez-${Date.now()}-${++dlqSeq}.jsonl`);
}

// Keyword-only stub — never invokes OllamaBrain, keeps tests hermetic under
// CH1TTY_USE_OLLAMA_BRAIN=1.
class StubCoordinator extends SessionCoordinator {
  constructor() {
    super({ enabled: false }, { enabled: false });
  }
  override async routeIntent(_query: string, _candidates: ToolCandidate[]): Promise<RoutedTool[] | null> {
    return null;
  }
}

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

// ── Suite EZ-1: verbosity:'low', single-candidate ─────────────────────────────

describe('EZ-1 — explain field value types at verbosity:low, single-candidate', () => {
  test('present scalar fields have correct types and candidateCount === 1', async () => {
    const agg = makeSoloAggregator();
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

      // method: non-empty string
      assert.equal(typeof exp['method'], 'string', 'method must be a string');
      assert.ok((exp['method'] as string).length > 0, 'method must be non-empty');

      // candidateCount: integer === 1 (single-candidate fixture)
      assert.equal(typeof exp['candidateCount'], 'number', 'candidateCount must be a number');
      assert.ok(Number.isInteger(exp['candidateCount'] as number), 'candidateCount must be an integer');
      assert.equal(exp['candidateCount'], 1, 'candidateCount must be 1 for single-candidate fixture');

      // winnerScore: finite number > 0
      assert.equal(typeof exp['winnerScore'], 'number', 'winnerScore must be a number');
      assert.ok(Number.isFinite(exp['winnerScore'] as number), 'winnerScore must be finite');
      assert.ok((exp['winnerScore'] as number) > 0, 'winnerScore must be > 0');

      // winnerServer: non-empty string
      assert.equal(typeof exp['winnerServer'], 'string', 'winnerServer must be a string');
      assert.ok((exp['winnerServer'] as string).length > 0, 'winnerServer must be non-empty');

      // topCandidates: array of exactly length 1
      assert.ok(Array.isArray(exp['topCandidates']), 'topCandidates must be an array');
      assert.equal((exp['topCandidates'] as unknown[]).length, 1, 'topCandidates must have length 1');

      // rationale: non-empty string
      assert.equal(typeof exp['rationale'], 'string', 'rationale must be a string');
      assert.ok((exp['rationale'] as string).length > 0, 'rationale must be non-empty');
    } finally {
      await agg.shutdown();
    }
  });

  test('runner-up fields absent for single-candidate at verbosity:low', async () => {
    const agg = makeSoloAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'low',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const exp = getExplanation(parseBody(result));

      assert.equal(exp['runnerUpScore'], undefined, 'runnerUpScore must be absent for single-candidate');
      assert.equal(exp['runnerUpTool'], undefined, 'runnerUpTool must be absent for single-candidate');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite EZ-2: verbosity:'medium', single-candidate ──────────────────────────

describe('EZ-2 — explain field value types at verbosity:medium, single-candidate', () => {
  test('winnerCategory present and has correct type at verbosity:medium', async () => {
    const agg = makeSoloAggregator();
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

      // Low-verbosity fields still present — spot-check
      assert.equal(typeof exp['winnerScore'], 'number', 'winnerScore must be a number');
      assert.equal(typeof exp['method'], 'string', 'method must be a string');
      assert.equal(exp['candidateCount'], 1, 'candidateCount must be 1');

      // winnerCategory: medium-verbosity addition, non-empty string
      assert.equal(typeof exp['winnerCategory'], 'string', 'winnerCategory must be a string');
      assert.ok((exp['winnerCategory'] as string).length > 0, 'winnerCategory must be non-empty');
    } finally {
      await agg.shutdown();
    }
  });

  test('multi-candidate distribution and runner-up fields absent at verbosity:medium, single-candidate', async () => {
    const agg = makeSoloAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'medium',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const exp = getExplanation(parseBody(result));

      // Runner-up fields — require topCandidates.length > 1
      assert.equal(exp['runnerUpScore'], undefined, 'runnerUpScore must be absent');
      assert.equal(exp['runnerUpTool'], undefined, 'runnerUpTool must be absent');
      assert.equal(exp['runnerUpCategory'], undefined, 'runnerUpCategory must be absent');
      assert.equal(exp['runnerUpServer'], undefined, 'runnerUpServer must be absent');

      // Distribution stats — require scoredTools.length >= 2
      assert.equal(exp['candidateScoreSpread'], undefined, 'candidateScoreSpread must be absent');
      assert.equal(exp['candidateScoreMean'], undefined, 'candidateScoreMean must be absent');
      assert.equal(exp['candidateScoreStdDev'], undefined, 'candidateScoreStdDev must be absent');
      assert.equal(exp['medianCandidateScore'], undefined, 'medianCandidateScore must be absent');
    } finally {
      await agg.shutdown();
    }
  });
});
