/**
 * FP: Freeze VALUE TYPES for multi-candidate verbosity:low and verbosity:medium
 * cast explain output.
 *
 * FH (fh-cast-explain-verbosity-key-set-drift-guard.test.ts) freezes the exact
 * KEY SETS at verbosity:low and verbosity:medium. EZ freezes types for the
 * SINGLE-CANDIDATE case, where runner-up fields are absent. This test freezes
 * types for the MULTI-CANDIDATE case, where runner-up fields ARE present and
 * candidateCount >= 2 must hold.
 *
 * FH-3b covers 4 distribution stats at verbosity:medium (candidateScoreSpread,
 * candidateScoreMean, candidateScoreStdDev, medianCandidateScore). FP covers
 * the remaining 11 non-stat keys at verbosity:medium and all 8 keys at
 * verbosity:low, ensuring runner-up types are frozen.
 *
 * Suites:
 *   FP-1  verbosity:low, no focus (8 keys) — all value types
 *   FP-2  verbosity:low, focus:code (12 keys) — 4 additional focus key types
 *   FP-3  verbosity:medium, no focus (15 keys) — 11 non-distribution key types
 *   FP-4  verbosity:medium, focus:code (27 keys) — 15 base key types
 *
 * Uses FixtureBackend (neon+stripe+tasks) which guarantees multi-candidate
 * output (3 servers × ~5 tools each → candidateCount >= 2 for any intent).
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only change)
 *   - buildCastExplanation metric freeze: no new fields added; freezes types
 *     of existing fields only.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { FocusProfiles } from '../src/focus.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

class NullRoutingCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

const CONFIGS: ServerConfig[] = [
  { id: 'neon',   name: 'Neon',   type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',       lazy: true },
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp',       lazy: true },
  { id: 'tasks',  name: 'Tasks',  type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://tasks.chitty.cc/mcp',  lazy: true },
];

const FOCUS_PROFILES: FocusProfiles = {
  profiles: { code: { categories: [], servers: ['neon'], boost: 0.5 } },
};

function makeAgg(withFocus: boolean): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon',   FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  backend.defineServer('tasks',  FIXTURE_SERVERS.tasks);
  const opts: NonNullable<ConstructorParameters<typeof Aggregator>[1]> = {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: join(tmpdir(), `ch1tty-fp-${Date.now()}.jsonl`),
    coordinator: new NullRoutingCoordinator({}, { enabled: false }),
  };
  if (withFocus) {
    opts.focusProfiles = FOCUS_PROFILES;
    opts.focus = 'code';
  }
  return new Aggregator(CONFIGS, opts);
}

async function castExplain(
  agg: Aggregator,
  verbosity: 'low' | 'medium',
  intent = 'list database projects',
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent, explain: true, verbosity });
  assert.equal(result.isError, undefined, `cast must not error at verbosity:${verbosity}`);
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.ok(body.explanation !== undefined, 'explanation must be present');
  return body.explanation as Record<string, unknown>;
}

// ── Suite FP-1: verbosity:low, no focus — all 8 key types ───────────────────

describe('FP-1: verbosity:low no-focus multi-candidate value types', () => {
  test('candidateCount is integer >= 2', async () => {
    const agg = makeAgg(false);
    try {
      const ex = await castExplain(agg, 'low');
      assert.equal(typeof ex.candidateCount, 'number', 'candidateCount must be number');
      assert.ok(Number.isInteger(ex.candidateCount), 'candidateCount must be integer');
      assert.ok((ex.candidateCount as number) >= 2, 'must have >= 2 candidates (multi-candidate fixture)');
    } finally { await agg.shutdown(); }
  });

  test('method and rationale are non-empty strings', async () => {
    const agg = makeAgg(false);
    try {
      const ex = await castExplain(agg, 'low');
      assert.equal(typeof ex.method, 'string', 'method must be string');
      assert.ok((ex.method as string).length > 0, 'method must be non-empty');
      assert.equal(typeof ex.rationale, 'string', 'rationale must be string');
      assert.ok((ex.rationale as string).length > 0, 'rationale must be non-empty');
    } finally { await agg.shutdown(); }
  });

  test('winnerScore is finite number, runnerUpScore is finite number, winner > runnerUp', async () => {
    const agg = makeAgg(false);
    try {
      const ex = await castExplain(agg, 'low');
      assert.equal(typeof ex.winnerScore, 'number', 'winnerScore must be number');
      assert.ok(Number.isFinite(ex.winnerScore as number), 'winnerScore must be finite');
      assert.ok((ex.winnerScore as number) > 0, 'winnerScore must be > 0');
      assert.equal(typeof ex.runnerUpScore, 'number', 'runnerUpScore must be number (present in multi-candidate)');
      assert.ok(Number.isFinite(ex.runnerUpScore as number), 'runnerUpScore must be finite');
      assert.ok((ex.winnerScore as number) >= (ex.runnerUpScore as number), 'winner must score >= runner-up');
    } finally { await agg.shutdown(); }
  });

  test('winnerServer and runnerUpTool are non-empty strings', async () => {
    const agg = makeAgg(false);
    try {
      const ex = await castExplain(agg, 'low');
      assert.equal(typeof ex.winnerServer, 'string', 'winnerServer must be string');
      assert.ok((ex.winnerServer as string).length > 0, 'winnerServer must be non-empty');
      assert.equal(typeof ex.runnerUpTool, 'string', 'runnerUpTool must be string (present in multi-candidate)');
      assert.ok((ex.runnerUpTool as string).length > 0, 'runnerUpTool must be non-empty');
      assert.ok((ex.runnerUpTool as string).includes('/'), 'runnerUpTool must be namespaced (serverId/toolName)');
    } finally { await agg.shutdown(); }
  });

  test('topCandidates is non-empty Array with length >= 2', async () => {
    const agg = makeAgg(false);
    try {
      const ex = await castExplain(agg, 'low');
      assert.ok(Array.isArray(ex.topCandidates), 'topCandidates must be Array');
      assert.ok((ex.topCandidates as unknown[]).length >= 2, 'topCandidates must have >= 2 items (multi-candidate)');
    } finally { await agg.shutdown(); }
  });
});

// ── Suite FP-2: verbosity:low, focus:code — 4 additional focus key types ────

describe('FP-2: verbosity:low focus:code multi-candidate — focus field types', () => {
  test('focus is string === active profile name', async () => {
    const agg = makeAgg(true);
    try {
      const ex = await castExplain(agg, 'low');
      assert.equal(typeof ex.focus, 'string', 'focus must be string');
      assert.equal(ex.focus, 'code', 'focus must equal the active profile name');
    } finally { await agg.shutdown(); }
  });

  test('focusBoost is finite number >= 0', async () => {
    const agg = makeAgg(true);
    try {
      const ex = await castExplain(agg, 'low');
      assert.equal(typeof ex.focusBoost, 'number', 'focusBoost must be number');
      assert.ok(Number.isFinite(ex.focusBoost as number), 'focusBoost must be finite');
      assert.ok((ex.focusBoost as number) >= 0, 'focusBoost must be >= 0');
    } finally { await agg.shutdown(); }
  });

  test('focusDecisive is boolean', async () => {
    const agg = makeAgg(true);
    try {
      const ex = await castExplain(agg, 'low');
      assert.equal(typeof ex.focusDecisive, 'boolean', 'focusDecisive must be boolean');
    } finally { await agg.shutdown(); }
  });

  test('winnerInFocus is boolean', async () => {
    const agg = makeAgg(true);
    try {
      const ex = await castExplain(agg, 'low');
      assert.equal(typeof ex.winnerInFocus, 'boolean', 'winnerInFocus must be boolean');
    } finally { await agg.shutdown(); }
  });
});

// ── Suite FP-3: verbosity:medium, no focus — 11 non-stat key types ──────────
// (FH-3b covers the 4 distribution stats; this covers the remaining 11)

describe('FP-3: verbosity:medium no-focus multi-candidate — non-stat key types', () => {
  test('candidateCount is integer >= 2', async () => {
    const agg = makeAgg(false);
    try {
      const ex = await castExplain(agg, 'medium');
      assert.equal(typeof ex.candidateCount, 'number', 'candidateCount must be number');
      assert.ok(Number.isInteger(ex.candidateCount), 'candidateCount must be integer');
      assert.ok((ex.candidateCount as number) >= 2, 'must have >= 2 candidates');
    } finally { await agg.shutdown(); }
  });

  test('method and rationale are non-empty strings', async () => {
    const agg = makeAgg(false);
    try {
      const ex = await castExplain(agg, 'medium');
      assert.equal(typeof ex.method, 'string', 'method must be string');
      assert.ok((ex.method as string).length > 0, 'method must be non-empty');
      assert.equal(typeof ex.rationale, 'string', 'rationale must be string');
      assert.ok((ex.rationale as string).length > 0, 'rationale must be non-empty');
    } finally { await agg.shutdown(); }
  });

  test('winnerScore and runnerUpScore are finite numbers, winner >= runner-up', async () => {
    const agg = makeAgg(false);
    try {
      const ex = await castExplain(agg, 'medium');
      assert.equal(typeof ex.winnerScore, 'number', 'winnerScore must be number');
      assert.ok(Number.isFinite(ex.winnerScore as number), 'winnerScore must be finite');
      assert.equal(typeof ex.runnerUpScore, 'number', 'runnerUpScore must be number');
      assert.ok(Number.isFinite(ex.runnerUpScore as number), 'runnerUpScore must be finite');
      assert.ok((ex.winnerScore as number) >= (ex.runnerUpScore as number), 'winner score >= runner-up score');
    } finally { await agg.shutdown(); }
  });

  test('winnerServer, winnerCategory, runnerUpServer, runnerUpTool, runnerUpCategory are non-empty strings', async () => {
    const agg = makeAgg(false);
    try {
      const ex = await castExplain(agg, 'medium');
      for (const key of ['winnerServer', 'winnerCategory', 'runnerUpServer', 'runnerUpTool', 'runnerUpCategory'] as const) {
        assert.equal(typeof ex[key], 'string', `${key} must be string`);
        assert.ok((ex[key] as string).length > 0, `${key} must be non-empty`);
      }
      assert.ok((ex.runnerUpTool as string).includes('/'), 'runnerUpTool must be namespaced');
    } finally { await agg.shutdown(); }
  });

  test('topCandidates is Array with length >= 2', async () => {
    const agg = makeAgg(false);
    try {
      const ex = await castExplain(agg, 'medium');
      assert.ok(Array.isArray(ex.topCandidates), 'topCandidates must be Array');
      assert.ok((ex.topCandidates as unknown[]).length >= 2, 'topCandidates must have >= 2 items');
    } finally { await agg.shutdown(); }
  });
});

// ── Suite FP-4: verbosity:medium, focus:code — 15 base key types ─────────────
// (FH-4b covers 12 focus-specific types; this covers the 15 shared base key types)

describe('FP-4: verbosity:medium focus:code multi-candidate — base key types', () => {
  test('candidateCount is integer >= 2', async () => {
    const agg = makeAgg(true);
    try {
      const ex = await castExplain(agg, 'medium');
      assert.equal(typeof ex.candidateCount, 'number', 'candidateCount must be number');
      assert.ok(Number.isInteger(ex.candidateCount), 'candidateCount must be integer');
      assert.ok((ex.candidateCount as number) >= 2, 'must have >= 2 candidates');
    } finally { await agg.shutdown(); }
  });

  test('method and rationale are non-empty strings', async () => {
    const agg = makeAgg(true);
    try {
      const ex = await castExplain(agg, 'medium');
      assert.equal(typeof ex.method, 'string', 'method must be string');
      assert.ok((ex.method as string).length > 0, 'method must be non-empty');
      assert.equal(typeof ex.rationale, 'string', 'rationale must be string');
      assert.ok((ex.rationale as string).length > 0, 'rationale must be non-empty');
    } finally { await agg.shutdown(); }
  });

  test('winnerScore and runnerUpScore are finite numbers', async () => {
    const agg = makeAgg(true);
    try {
      const ex = await castExplain(agg, 'medium');
      assert.equal(typeof ex.winnerScore, 'number', 'winnerScore must be number');
      assert.ok(Number.isFinite(ex.winnerScore as number), 'winnerScore must be finite');
      assert.equal(typeof ex.runnerUpScore, 'number', 'runnerUpScore must be number');
      assert.ok(Number.isFinite(ex.runnerUpScore as number), 'runnerUpScore must be finite');
      assert.ok((ex.winnerScore as number) >= (ex.runnerUpScore as number), 'winner score >= runner-up score');
    } finally { await agg.shutdown(); }
  });

  test('winnerServer, winnerCategory, runnerUpServer, runnerUpTool, runnerUpCategory are non-empty strings', async () => {
    const agg = makeAgg(true);
    try {
      const ex = await castExplain(agg, 'medium');
      for (const key of ['winnerServer', 'winnerCategory', 'runnerUpServer', 'runnerUpTool', 'runnerUpCategory'] as const) {
        assert.equal(typeof ex[key], 'string', `${key} must be string`);
        assert.ok((ex[key] as string).length > 0, `${key} must be non-empty`);
      }
      assert.ok((ex.runnerUpTool as string).includes('/'), 'runnerUpTool must be namespaced');
    } finally { await agg.shutdown(); }
  });

  test('topCandidates is Array with length >= 2', async () => {
    const agg = makeAgg(true);
    try {
      const ex = await castExplain(agg, 'medium');
      assert.ok(Array.isArray(ex.topCandidates), 'topCandidates must be Array');
      assert.ok((ex.topCandidates as unknown[]).length >= 2, 'topCandidates must have >= 2 items');
    } finally { await agg.shutdown(); }
  });

  test('distribution stats are finite numbers (FH-3b crosscheck for focus path)', async () => {
    const agg = makeAgg(true);
    try {
      const ex = await castExplain(agg, 'medium');
      for (const key of ['candidateScoreSpread', 'candidateScoreMean', 'candidateScoreStdDev', 'medianCandidateScore'] as const) {
        assert.equal(typeof ex[key], 'number', `${key} must be number`);
        assert.ok(Number.isFinite(ex[key] as number), `${key} must be finite`);
      }
    } finally { await agg.shutdown(); }
  });
});
