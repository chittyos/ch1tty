/**
 * ER: Drift guard — cast explain field names for verbosity: 'low' and 'medium'.
 *
 * DW (dw-cast-explain-fieldnames-drift.test.ts) and zzzz freeze field names
 * and counts for verbosity: 'full' only. The 'low' (8-field) and 'medium'
 * (15-field) subsets are unfrozen and can quietly regress — a rename or
 * addition in either verbosity tier would pass all existing guards.
 *
 * CLAUDE.md § buildCastExplanation metric freeze applies here:
 * if a test fails with an UNEXPECTED name, a rename or new field was added
 * — REJECT per the metric freeze; if it fails with a MISSING name, a field
 * was intentionally removed — update the frozen set below only after
 * confirming the removal intent.
 *
 * ── verbosity: 'low', no focus, multi-candidate (8 fields) ───────────────────
 *   candidateCount, method, rationale, runnerUpScore, runnerUpTool,
 *   topCandidates, winnerScore, winnerServer
 *
 * ── verbosity: 'medium', no focus, multi-candidate (15 fields) ───────────────
 *   candidateCount, candidateScoreMean, candidateScoreSpread,
 *   candidateScoreStdDev, medianCandidateScore, method, rationale,
 *   runnerUpCategory, runnerUpScore, runnerUpServer, runnerUpTool,
 *   topCandidates, winnerCategory, winnerScore, winnerServer
 *
 * ── no_match (0 candidates) — both verbosities (4 fields) ────────────────────
 *   candidateCount, method, rationale, topCandidates
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

const LOW_NO_FOCUS_MULTI: readonly string[] = [
  'candidateCount',
  'method',
  'rationale',
  'runnerUpScore',
  'runnerUpTool',
  'topCandidates',
  'winnerScore',
  'winnerServer',
];

const MEDIUM_NO_FOCUS_MULTI: readonly string[] = [
  'candidateCount',
  'candidateScoreMean',
  'candidateScoreSpread',
  'candidateScoreStdDev',
  'medianCandidateScore',
  'method',
  'rationale',
  'runnerUpCategory',
  'runnerUpScore',
  'runnerUpServer',
  'runnerUpTool',
  'topCandidates',
  'winnerCategory',
  'winnerScore',
  'winnerServer',
];

const NO_MATCH_FIELDS: readonly string[] = [
  'candidateCount',
  'method',
  'rationale',
  'topCandidates',
];

// ── Fixture setup ─────────────────────────────────────────────────────────────

const DLQ = join(tmpdir(), `ch1tty-er-${Date.now()}.jsonl`);

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

// ── Suite 1: verbosity:'low' ──────────────────────────────────────────────────

describe('ER — explain verbosity:low field names (no focus)', () => {
  test('verbosity:low multi-candidate — exact frozen field set (8 names)', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'low',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
      assert.ok(body['explanation'] !== undefined, 'explanation must be present when explain:true');
      const actual = Object.keys(body['explanation'] as object).sort();
      const expected = [...LOW_NO_FOCUS_MULTI].sort();
      assert.deepEqual(
        actual,
        expected,
        `verbosity:low field names drifted.\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('verbosity:low no_match — exact frozen field set (4 names)', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'zzzzzzzzz_no_match_er_test_xyz_9999',
        explain: true,
        verbosity: 'low',
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
        `verbosity:low no_match field names drifted.\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 2: verbosity:'medium' ───────────────────────────────────────────────

describe('ER — explain verbosity:medium field names (no focus)', () => {
  test('verbosity:medium multi-candidate — exact frozen field set (15 names)', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'medium',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
      assert.ok(body['explanation'] !== undefined, 'explanation must be present when explain:true');
      const actual = Object.keys(body['explanation'] as object).sort();
      const expected = [...MEDIUM_NO_FOCUS_MULTI].sort();
      assert.deepEqual(
        actual,
        expected,
        `verbosity:medium field names drifted.\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('verbosity:medium no_match — exact frozen field set (4 names)', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'zzzzzzzzz_no_match_er_test_xyz_9999',
        explain: true,
        verbosity: 'medium',
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
        `verbosity:medium no_match field names drifted.\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});
