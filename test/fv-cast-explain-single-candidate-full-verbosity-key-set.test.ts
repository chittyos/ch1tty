/**
 * FV: Drift guard — cast explain exact key set at verbosity:full, single-candidate.
 *
 * EX freezes key sets at verbosity:low and verbosity:medium for single-candidate.
 * FU freezes the verbosity:full key set for multi-candidate (fallback route).
 * FV closes the last gap: verbosity:full for single-candidate (1 tool in registry).
 *
 * Single-candidate means exactly ONE tool matches the intent (solo fixture with
 * one server, one tool). This causes the following fields to be ABSENT vs the
 * multi-candidate verbosity:full set:
 *   - runner-up fields (runnerUpScore, runnerUpTool) — no runner-up exists
 *   - distribution stats (candidateScoreSpread, candidateScoreStdDev, etc.) —
 *     require ≥ 2 scoredTools
 *   - focus decisiveness fields at focus:code (focusDecisive, focusMargin,
 *     focusConfidence, focusBias, focusNetBoostDelta, rawFocusMargim/Ratio,
 *     runnerUpFocusBoost/Ratio) — conditioned on topCandidates.length > 1
 *
 * A regression that emits distribution stats or runner-up fields for a single
 * candidate would pass EX (low/medium only) and FU (multi-candidate) silently.
 * FV catches it via deepEqual on the sorted key array.
 *
 * CLAUDE.md § buildCastExplanation metric freeze applies.
 * Unexpected key in actual → new field was added — REJECT per freeze.
 * Missing key in actual → field removed — confirm intent, then update.
 *
 * Frozen key sets (2026-09-20, probed with solo FixtureBackend):
 *
 * ── verbosity:full, no focus, single-candidate (9 keys) ─────────────────────
 *   candidateCount, method, rationale, scoreDominanceIndex, topCandidates,
 *   topCandidatesMeanScore, winnerCategory, winnerScore, winnerServer
 *
 * ── verbosity:full, focus:code, single-candidate (24 keys) ──────────────────
 *   candidateCount, candidatesInFocusCount, focus, focusBoost, focusRank,
 *   focusRankDelta, focusRankPercentile, inFocusBottomScore, inFocusFraction,
 *   inFocusMeanScore, inFocusTopScore, method, outOfFocusCandidatesCount,
 *   rationale, scoreDominanceIndex, topCandidates, topCandidatesMeanScore,
 *   winnerCategory, winnerFocusBoost, winnerFocusBoostRatio, winnerInFocus,
 *   winnerScore, winnerScoreBase, winnerServer
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// ── Frozen key sets ───────────────────────────────────────────────────────────

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

// ── Fixture helpers ───────────────────────────────────────────────────────────

const CONFIGS: ServerConfig[] = [
  { id: 'solo', name: 'Solo DB', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://solo.example.com/mcp', lazy: true },
];

const FOCUS_PROFILES = {
  profiles: {
    code: { categories: ['code'] as string[], boost: 0.5 },
  },
};

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-fv-${Date.now()}-${++dlqSeq}.jsonl`);
}

function makeAgg(withFocus: boolean): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('solo', {
    tools: [{
      name: 'list_projects',
      description: 'List all Neon database projects in the account',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: '[]' }] },
    }],
  });
  const opts: Record<string, unknown> = {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  };
  if (withFocus) {
    opts.focusProfiles = FOCUS_PROFILES;
    opts.focus = 'code';
  }
  return new Aggregator(CONFIGS, opts as Parameters<typeof Aggregator.prototype.callTool>[1]);
}

function parseExplanation(result: { isError?: boolean; content: Array<{ type?: string; text?: unknown }> }): Record<string, unknown> {
  assert.equal(result.isError, undefined, 'cast must not error');
  const first = result.content[0] as { text?: unknown };
  if (typeof first?.text !== 'string') throw new Error('No text content');
  const body = JSON.parse(first.text) as Record<string, unknown>;
  assert.ok(body.explanation !== undefined, 'explanation must be present when explain:true');
  assert.ok(typeof body.explanation === 'object' && body.explanation !== null);
  return body.explanation as Record<string, unknown>;
}

// ── Suite FV-1: verbosity:full, no focus ─────────────────────────────────────

describe('FV — verbosity:full, no focus, single-candidate key set', () => {
  test('FV-1a: exact 9-key set — no runner-up or distribution stats', async () => {
    const agg = makeAgg(false);
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list neon database projects',
        explain: true,
        verbosity: 'full',
        dryRun: true,
      });
      const ex = parseExplanation(result);
      assert.equal(ex.candidateCount, 1, 'single-candidate fixture must yield candidateCount===1');
      const actual = Object.keys(ex).sort();
      const expected = [...FULL_NO_FOCUS_SINGLE].sort();
      assert.deepEqual(
        actual,
        expected,
        `verbosity:full no-focus single-candidate key set drifted.\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('FV-1b: runner-up fields absent (no runnerUpScore, runnerUpTool)', async () => {
    const agg = makeAgg(false);
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list neon database projects',
        explain: true,
        verbosity: 'full',
        dryRun: true,
      });
      const ex = parseExplanation(result);
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'runnerUpScore'), 'runnerUpScore must be absent for single-candidate');
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'runnerUpTool'), 'runnerUpTool must be absent for single-candidate');
    } finally {
      await agg.shutdown();
    }
  });

  test('FV-1c: distribution stats absent (no candidateScoreSpread, stdDev)', async () => {
    const agg = makeAgg(false);
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list neon database projects',
        explain: true,
        verbosity: 'full',
        dryRun: true,
      });
      const ex = parseExplanation(result);
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'candidateScoreSpread'), 'candidateScoreSpread must be absent for single-candidate');
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'candidateScoreStdDev'), 'candidateScoreStdDev must be absent for single-candidate');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite FV-2: verbosity:full, focus:code ───────────────────────────────────

describe('FV — verbosity:full, focus:code, single-candidate key set', () => {
  test('FV-2a: exact 24-key set — focus fields present, decisiveness fields absent', async () => {
    const agg = makeAgg(true);
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list neon database projects',
        explain: true,
        verbosity: 'full',
        focus: 'code',
        dryRun: true,
      });
      const ex = parseExplanation(result);
      assert.equal(ex.candidateCount, 1, 'single-candidate fixture must yield candidateCount===1');
      const actual = Object.keys(ex).sort();
      const expected = [...FULL_FOCUS_SINGLE].sort();
      assert.deepEqual(
        actual,
        expected,
        `verbosity:full focus:code single-candidate key set drifted.\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('FV-2b: focus context fields present (focus, focusBoost, winnerInFocus)', async () => {
    const agg = makeAgg(true);
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list neon database projects',
        explain: true,
        verbosity: 'full',
        focus: 'code',
        dryRun: true,
      });
      const ex = parseExplanation(result);
      assert.equal(ex.focus, 'code', 'focus must equal the active focus profile');
      assert.equal(typeof ex.focusBoost, 'number', 'focusBoost must be a number');
      assert.equal(typeof ex.winnerInFocus, 'boolean', 'winnerInFocus must be boolean');
    } finally {
      await agg.shutdown();
    }
  });

  test('FV-2c: runner-up focus fields absent (no focusDecisive, focusMargin, focusConfidence)', async () => {
    const agg = makeAgg(true);
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list neon database projects',
        explain: true,
        verbosity: 'full',
        focus: 'code',
        dryRun: true,
      });
      const ex = parseExplanation(result);
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'focusDecisive'), 'focusDecisive must be absent for single-candidate');
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'focusMargin'), 'focusMargin must be absent for single-candidate');
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'focusConfidence'), 'focusConfidence must be absent for single-candidate');
    } finally {
      await agg.shutdown();
    }
  });
});
