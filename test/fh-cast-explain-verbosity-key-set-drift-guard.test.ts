/**
 * FH drift guard: freeze cast explain exact key sets at verbosity:low and verbosity:medium.
 *
 * Complements zzzz (which freezes the TOTAL field COUNT at verbosity:full).
 * This test freezes the EXACT top-level key set at low and medium verbosity via
 * deepEqual, so a rename or accidental addition fails regardless of total count.
 *
 * Key sets are deterministic with FixtureBackend (neon+stripe+tasks, 3 servers,
 * intent "list database projects" → multi-candidate every run).
 *
 * Suites:
 *   FH-1  verbosity:low,    no focus     → 8-key set
 *   FH-2  verbosity:low,    focus:code   → 12-key set
 *   FH-3  verbosity:medium, no focus     → 15-key set
 *   FH-4  verbosity:medium, focus:code   → 27-key set
 *
 * CLAUDE.md compliance:
 *   - 5-tool surface: unchanged (test-only)
 *   - buildCastExplanation metric freeze: no new fields added; freezes existing set
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { FocusProfiles } from '../src/focus.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

class NullRoutingCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

const CONFIGS: ServerConfig[] = [
  { id: 'neon',   name: 'Neon',   type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',         lazy: true },
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp',         lazy: true },
  { id: 'tasks',  name: 'Tasks',  type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://tasks.chitty.cc/mcp',    lazy: true },
];

const FOCUS_PROFILES: FocusProfiles = {
  profiles: { code: { categories: [], servers: ['neon'], boost: 0.5 } },
};

function makeAgg(withFocus: boolean): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon',   FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  backend.defineServer('tasks',  FIXTURE_SERVERS.tasks);
  const opts: Record<string, unknown> = {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: join(tmpdir(), `ch1tty-fh-${Date.now()}.jsonl`),
    coordinator: new NullRoutingCoordinator(),
  };
  if (withFocus) {
    opts.focusProfiles = FOCUS_PROFILES;
    opts.focus = 'code';
  }
  return new Aggregator(CONFIGS, opts as Parameters<typeof Aggregator.prototype.callTool>[1]);
}

// ── Suite FH-1: verbosity:low, no focus ──────────────────────────────────────

test('FH-1a: verbosity:low no-focus — explain key set is exactly 8 keys', async () => {
  const agg = makeAgg(false);
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list database projects',
      explain: true,
      verbosity: 'low',
    });
    assert.equal(result.isError, undefined, 'cast must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.ok(body.explanation !== undefined, 'explanation must be present');
    const keys = Object.keys(body.explanation as object).sort();
    assert.deepEqual(keys, [
      'candidateCount',
      'method',
      'rationale',
      'runnerUpScore',
      'runnerUpTool',
      'topCandidates',
      'winnerScore',
      'winnerServer',
    ], 'verbosity:low no-focus exact key set must equal the frozen 8-key list');
  } finally {
    await agg.shutdown();
  }
});

test('FH-1b: verbosity:low no-focus — no focus fields leak into explain', async () => {
  const agg = makeAgg(false);
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list database projects',
      explain: true,
      verbosity: 'low',
    });
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    const explain = body.explanation as Record<string, unknown>;
    const focusKeys = Object.keys(explain).filter((k) =>
      k.startsWith('focus') || k === 'winnerInFocus' || k === 'inFocusFraction',
    );
    assert.deepEqual(focusKeys, [], 'no focus-related keys in verbosity:low no-focus explain');
  } finally {
    await agg.shutdown();
  }
});

// ── Suite FH-2: verbosity:low, focus:code ────────────────────────────────────

test('FH-2a: verbosity:low focus:code — explain key set is exactly 12 keys', async () => {
  const agg = makeAgg(true);
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list database projects',
      explain: true,
      verbosity: 'low',
    });
    assert.equal(result.isError, undefined, 'cast must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.ok(body.explanation !== undefined, 'explanation must be present');
    const keys = Object.keys(body.explanation as object).sort();
    assert.deepEqual(keys, [
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
    ], 'verbosity:low focus:code exact key set must equal the frozen 12-key list');
  } finally {
    await agg.shutdown();
  }
});

test('FH-2b: verbosity:low focus:code — no medium/full-only fields present', async () => {
  const agg = makeAgg(true);
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list database projects',
      explain: true,
      verbosity: 'low',
    });
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    const explain = body.explanation as Record<string, unknown>;
    // These are medium/full-only — must be absent at verbosity:low
    for (const k of ['winnerCategory', 'winnerFocusBoost', 'winnerScoreBase', 'candidatesInFocusCount',
      'inFocusFraction', 'candidateScoreSpread', 'candidateScoreMean', 'focusRank',
      'focusMargin', 'focusConfidence', 'runnerUpCategory', 'runnerUpServer']) {
      assert.equal(explain[k], undefined, `${k} must be absent at verbosity:low`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── Suite FH-3: verbosity:medium, no focus ───────────────────────────────────

test('FH-3a: verbosity:medium no-focus — explain key set is exactly 15 keys', async () => {
  const agg = makeAgg(false);
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list database projects',
      explain: true,
      verbosity: 'medium',
    });
    assert.equal(result.isError, undefined, 'cast must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.ok(body.explanation !== undefined, 'explanation must be present');
    const keys = Object.keys(body.explanation as object).sort();
    assert.deepEqual(keys, [
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
    ], 'verbosity:medium no-focus exact key set must equal the frozen 15-key list');
  } finally {
    await agg.shutdown();
  }
});

test('FH-3b: verbosity:medium no-focus — distribution stats are numbers', async () => {
  const agg = makeAgg(false);
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list database projects',
      explain: true,
      verbosity: 'medium',
    });
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    const explain = body.explanation as Record<string, unknown>;
    for (const k of ['candidateScoreSpread', 'candidateScoreMean', 'candidateScoreStdDev', 'medianCandidateScore']) {
      assert.equal(typeof explain[k], 'number', `${k} must be a number at verbosity:medium`);
      assert.ok(Number.isFinite(explain[k] as number), `${k} must be finite`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── Suite FH-4: verbosity:medium, focus:code ─────────────────────────────────

test('FH-4a: verbosity:medium focus:code — explain key set is exactly 27 keys', async () => {
  const agg = makeAgg(true);
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list database projects',
      explain: true,
      verbosity: 'medium',
    });
    assert.equal(result.isError, undefined, 'cast must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.ok(body.explanation !== undefined, 'explanation must be present');
    const keys = Object.keys(body.explanation as object).sort();
    assert.deepEqual(keys, [
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
    ], 'verbosity:medium focus:code exact key set must equal the frozen 27-key list');
  } finally {
    await agg.shutdown();
  }
});

test('FH-4b: verbosity:medium focus:code — focus analysis fields are correct types', async () => {
  const agg = makeAgg(true);
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list database projects',
      explain: true,
      verbosity: 'medium',
    });
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    const explain = body.explanation as Record<string, unknown>;
    assert.equal(typeof explain.focus, 'string', 'focus must be a string');
    assert.equal(explain.focus, 'code', 'focus must be the active profile name');
    assert.equal(typeof explain.focusBoost, 'number', 'focusBoost must be a number');
    assert.equal(typeof explain.winnerInFocus, 'boolean', 'winnerInFocus must be a boolean');
    assert.equal(typeof explain.winnerFocusBoost, 'number', 'winnerFocusBoost must be a number');
    assert.equal(typeof explain.winnerScoreBase, 'number', 'winnerScoreBase must be a number');
    assert.equal(typeof explain.candidatesInFocusCount, 'number', 'candidatesInFocusCount must be a number');
    assert.ok(Number.isFinite(explain.inFocusFraction as number), 'inFocusFraction must be finite');
    assert.equal(typeof explain.focusRank, 'number', 'focusRank must be a number');
    assert.equal(typeof explain.focusRankDelta, 'number', 'focusRankDelta must be a number');
    assert.equal(typeof explain.focusDecisive, 'boolean', 'focusDecisive must be a boolean');
    assert.equal(typeof explain.focusMargin, 'number', 'focusMargin must be a number');
    assert.equal(typeof explain.focusConfidence, 'number', 'focusConfidence must be a number');
  } finally {
    await agg.shutdown();
  }
});
