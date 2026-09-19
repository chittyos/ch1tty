/**
 * EX: Drift guard — cast explain exact field names for single-candidate
 * (no runner-up) at verbosity:'low' and verbosity:'medium'.
 *
 * ER (er-cast-explain-verbosity-low-medium-fieldnames.test.ts) freezes field
 * names for multi-candidate (≥2 tools). EX freezes the qualitatively different
 * field sets that appear when there is exactly ONE candidate (no runner-up):
 *   - runner-up fields are absent (runnerUpScore, runnerUpTool, …)
 *   - spread/stddev/median are absent (require scoredTools.length ≥ 2)
 *   - focus decisiveness fields are absent (focusDecisive, focusMargin,
 *     focusConfidence — all conditioned on topCandidates.length > 1)
 *   - unfocusedWinner is absent (focus cannot change the winner when there
 *     is only one candidate)
 *
 * A regression that emits runnerUpScore when candidateCount===1, or emits
 * focusDecisive when there is no runner-up, would pass ER and ES silently.
 *
 * CLAUDE.md § buildCastExplanation metric freeze applies here.
 * If a test fails with an UNEXPECTED name, a new field was added —
 * REJECT per the metric freeze; update only after confirming intent.
 * If it fails with a MISSING name, a field was intentionally removed —
 * update the frozen set only after confirming the removal.
 *
 * ── verbosity:'low', no focus, single-candidate (6 fields) ──────────────────
 *   candidateCount, method, rationale, topCandidates, winnerScore, winnerServer
 *
 * ── verbosity:'medium', no focus, single-candidate (7 fields) ───────────────
 *   candidateCount, method, rationale, topCandidates, winnerCategory,
 *   winnerScore, winnerServer
 *
 * ── verbosity:'low', focus:code, single-candidate, winner in-focus (9 fields)
 *   candidateCount, focus, focusBoost, method, rationale, topCandidates,
 *   winnerInFocus, winnerScore, winnerServer
 *
 * ── verbosity:'medium', focus:code, single-candidate, winner in-focus (16 fields)
 *   candidateCount, candidatesInFocusCount, focus, focusBoost, focusRank,
 *   focusRankDelta, inFocusFraction, method, rationale, topCandidates,
 *   winnerCategory, winnerFocusBoost, winnerInFocus, winnerScore,
 *   winnerScoreBase, winnerServer
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

const LOW_NO_FOCUS_SINGLE: readonly string[] = [
  'candidateCount',
  'method',
  'rationale',
  'topCandidates',
  'winnerScore',
  'winnerServer',
];

const MEDIUM_NO_FOCUS_SINGLE: readonly string[] = [
  'candidateCount',
  'method',
  'rationale',
  'topCandidates',
  'winnerCategory',
  'winnerScore',
  'winnerServer',
];

const LOW_FOCUS_SINGLE: readonly string[] = [
  'candidateCount',
  'focus',
  'focusBoost',
  'method',
  'rationale',
  'topCandidates',
  'winnerInFocus',
  'winnerScore',
  'winnerServer',
];

const MEDIUM_FOCUS_SINGLE: readonly string[] = [
  'candidateCount',
  'candidatesInFocusCount',
  'focus',
  'focusBoost',
  'focusRank',
  'focusRankDelta',
  'inFocusFraction',
  'method',
  'rationale',
  'topCandidates',
  'winnerCategory',
  'winnerFocusBoost',
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
  return join(tmpdir(), `ch1tty-ex-${Date.now()}-${++dlqSeq}.jsonl`);
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

// ── Suite 1: verbosity:'low', no focus ───────────────────────────────────────

describe('EX — verbosity:low, no focus, single-candidate field names', () => {
  test('exact frozen field set: 6 names (no runner-up fields)', async () => {
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
      assert.ok(body['explanation'] !== undefined, 'explanation must be present when explain:true');
      const ex = getExplanation(body);
      assert.equal((ex['candidateCount'] as number), 1, 'single-candidate fixture must yield candidateCount===1');
      const actual = Object.keys(ex).sort();
      const expected = [...LOW_NO_FOCUS_SINGLE].sort();
      assert.deepEqual(
        actual,
        expected,
        `verbosity:low single-candidate field names drifted.\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 2: verbosity:'medium', no focus ────────────────────────────────────

describe('EX — verbosity:medium, no focus, single-candidate field names', () => {
  test('exact frozen field set: 7 names (no runner-up, no spread/stddev/median)', async () => {
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
      assert.ok(body['explanation'] !== undefined, 'explanation must be present when explain:true');
      const ex = getExplanation(body);
      assert.equal((ex['candidateCount'] as number), 1, 'single-candidate fixture must yield candidateCount===1');
      const actual = Object.keys(ex).sort();
      const expected = [...MEDIUM_NO_FOCUS_SINGLE].sort();
      assert.deepEqual(
        actual,
        expected,
        `verbosity:medium single-candidate field names drifted.\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 3: verbosity:'low', focus:code ─────────────────────────────────────

describe('EX — verbosity:low, focus:code, single-candidate field names', () => {
  test('exact frozen field set: 9 names (no focusDecisive — absent without runner-up)', async () => {
    const agg = makeAggregator();
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
      assert.ok(body['explanation'] !== undefined, 'explanation must be present when explain:true');
      const ex = getExplanation(body);
      assert.equal((ex['candidateCount'] as number), 1, 'single-candidate fixture must yield candidateCount===1');
      assert.equal(typeof ex['winnerInFocus'], 'boolean', 'winnerInFocus must be boolean');
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'focusDecisive'), 'focusDecisive must be absent for single-candidate');
      const actual = Object.keys(ex).sort();
      const expected = [...LOW_FOCUS_SINGLE].sort();
      assert.deepEqual(
        actual,
        expected,
        `verbosity:low focus:code single-candidate field names drifted.\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 4: verbosity:'medium', focus:code ──────────────────────────────────

describe('EX — verbosity:medium, focus:code, single-candidate field names', () => {
  test('exact frozen field set: 16 names (no focusDecisive/focusMargin/focusConfidence/unfocusedWinner)', async () => {
    const agg = makeAggregator();
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
      assert.ok(body['explanation'] !== undefined, 'explanation must be present when explain:true');
      const ex = getExplanation(body);
      assert.equal((ex['candidateCount'] as number), 1, 'single-candidate fixture must yield candidateCount===1');

      // Verify absent fields that require runner-up (topCandidates.length > 1)
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'focusDecisive'), 'focusDecisive must be absent for single-candidate');
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'focusMargin'), 'focusMargin must be absent for single-candidate');
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'focusConfidence'), 'focusConfidence must be absent for single-candidate');
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'unfocusedWinner'), 'unfocusedWinner must be absent when only one candidate');

      // Verify absent distribution stats (require scoredTools.length ≥ 2)
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'candidateScoreSpread'), 'candidateScoreSpread must be absent for single-candidate');
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'candidateScoreMean'), 'candidateScoreMean must be absent for single-candidate');

      const actual = Object.keys(ex).sort();
      const expected = [...MEDIUM_FOCUS_SINGLE].sort();
      assert.deepEqual(
        actual,
        expected,
        `verbosity:medium focus:code single-candidate field names drifted.\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});
