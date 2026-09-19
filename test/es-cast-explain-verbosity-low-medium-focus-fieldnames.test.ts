/**
 * ES: Drift guard — cast explain field names for verbosity: 'low' and 'medium'
 * with an active focus profile.
 *
 * ER (er-cast-explain-verbosity-low-medium-fieldnames.test.ts) freezes the
 * 'low' (8-field) and 'medium' (15-field) subsets without focus. When a focus
 * profile is active both verbosities grow: 'low' gains 4 focus fields (12
 * total) and 'medium' gains 12 focus fields (27 total). Those augmented sets
 * are unfrozen and can quietly regress.
 *
 * CLAUDE.md § buildCastExplanation metric freeze applies here:
 * if a test fails with an UNEXPECTED name, a rename or new field was added
 * — REJECT per the metric freeze; if it fails with a MISSING name, a field
 * was intentionally removed — update the frozen set below only after
 * confirming the removal intent.
 *
 * ── verbosity: 'low', focus:code, multi-candidate (12 fields) ────────────────
 *   candidateCount, focus, focusBoost, focusDecisive, method, rationale,
 *   runnerUpScore, runnerUpTool, topCandidates, winnerInFocus, winnerScore,
 *   winnerServer
 *
 * ── verbosity: 'medium', focus:code, multi-candidate (27 fields) ─────────────
 *   candidateCount, candidateScoreMean, candidateScoreSpread,
 *   candidateScoreStdDev, candidatesInFocusCount, focus, focusBoost,
 *   focusConfidence, focusDecisive, focusMargin, focusRank, focusRankDelta,
 *   inFocusFraction, medianCandidateScore, method, rationale, runnerUpCategory,
 *   runnerUpScore, runnerUpServer, runnerUpTool, topCandidates, winnerCategory,
 *   winnerFocusBoost, winnerInFocus, winnerScore, winnerScoreBase, winnerServer
 *
 * ── no_match (0 candidates) — both verbosities + focus (4 fields) ────────────
 *   candidateCount, method, rationale, topCandidates
 *   (focus fields absent on no_match since no winner candidate exists)
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

// ── Frozen field name sets ────────────────────────────────────────────────────

const LOW_FOCUS_MULTI: readonly string[] = [
  'candidateCount',
  'focus',
  'focusBoost',
  'focusDecisive',
  'method',
  'rationale',
  'runnerUpScore',
  'runnerUpTool',
  'topCandidates',
  'winnerInFocus',
  'winnerScore',
  'winnerServer',
];

const MEDIUM_FOCUS_MULTI: readonly string[] = [
  'candidateCount',
  'candidateScoreMean',
  'candidateScoreSpread',
  'candidateScoreStdDev',
  'candidatesInFocusCount',
  'focus',
  'focusBoost',
  'focusConfidence',
  'focusDecisive',
  'focusMargin',
  'focusRank',
  'focusRankDelta',
  'inFocusFraction',
  'medianCandidateScore',
  'method',
  'rationale',
  'runnerUpCategory',
  'runnerUpScore',
  'runnerUpServer',
  'runnerUpTool',
  'topCandidates',
  'winnerCategory',
  'winnerFocusBoost',
  'winnerInFocus',
  'winnerScore',
  'winnerScoreBase',
  'winnerServer',
];

/** no_match — focus fields absent because there is no winner candidate */
const NO_MATCH_FIELDS: readonly string[] = [
  'candidateCount',
  'method',
  'rationale',
  'topCandidates',
];

// ── Fixture setup ─────────────────────────────────────────────────────────────

const DLQ = join(tmpdir(), `ch1tty-es-${Date.now()}.jsonl`);

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

// ── Suite 1: verbosity:'low' + focus:code ────────────────────────────────────

describe('ES — explain verbosity:low field names (focus:code)', () => {
  test('verbosity:low focus:code multi-candidate — exact frozen field set (12 names)', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'low',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
      assert.ok(body['explanation'] !== undefined, 'explanation must be present when explain:true');
      const actual = Object.keys(body['explanation'] as object).sort();
      const expected = [...LOW_FOCUS_MULTI].sort();
      assert.deepEqual(
        actual,
        expected,
        `verbosity:low focus:code field names drifted.\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('verbosity:low focus:code no_match — focus fields absent (4 names)', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'zzzzzzzzz_no_match_es_test_xyz_9999',
        explain: true,
        verbosity: 'low',
        focus: 'code',
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
      assert.equal(body['cast'], 'no_match');
      assert.ok(body['explanation'] !== undefined, 'explanation must be present on no_match when explain:true');
      const actual = Object.keys(body['explanation'] as object).sort();
      const expected = [...NO_MATCH_FIELDS].sort();
      assert.deepEqual(
        actual,
        expected,
        `verbosity:low focus:code no_match field names drifted.\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 2: verbosity:'medium' + focus:code ──────────────────────────────────

describe('ES — explain verbosity:medium field names (focus:code)', () => {
  test('verbosity:medium focus:code multi-candidate — exact frozen field set (27 names)', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'medium',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
      assert.ok(body['explanation'] !== undefined, 'explanation must be present when explain:true');
      const actual = Object.keys(body['explanation'] as object).sort();
      const expected = [...MEDIUM_FOCUS_MULTI].sort();
      assert.deepEqual(
        actual,
        expected,
        `verbosity:medium focus:code field names drifted.\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('verbosity:medium focus:code no_match — focus fields absent (4 names)', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'zzzzzzzzz_no_match_es_test_xyz_9999',
        explain: true,
        verbosity: 'medium',
        focus: 'code',
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
      assert.equal(body['cast'], 'no_match');
      assert.ok(body['explanation'] !== undefined, 'explanation must be present on no_match when explain:true');
      const actual = Object.keys(body['explanation'] as object).sort();
      const expected = [...NO_MATCH_FIELDS].sort();
      assert.deepEqual(
        actual,
        expected,
        `verbosity:medium focus:code no_match field names drifted.\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});
