/**
 * FX drift guard: freeze brain-route RESOLVED explain VALUE TYPES at verbosity:full.
 *
 * FT freezes the exact KEY SETS for brain-routed resolved responses across all
 * verbosities. FT-1b validates brainMs type + method at verbosity:low only.
 * FM/FN validate field types at verbosity:full but only for the fallback route.
 * FX closes the remaining gap: value-type and constraint assertions for brain-route
 * resolved responses at verbosity:full.
 *
 * Coverage:
 *   FX-1  verbosity:full, no focus, uniform confidence (BrainMultiPositiveCoordinator)
 *          — brainMs finite >= 0, method='brain', candidateCount > 0,
 *            core numeric fields finite and in expected ranges
 *   FX-2  verbosity:full, focus:code, uniform confidence
 *          — same + focus context fields typed and constrained
 *   FX-3  verbosity:full, no focus, varied confidence (BrainVariedConfidenceCoordinator)
 *          — brainMs finite >= 0, z-score/kurtosis/skewness fields finite
 *   FX-4  verbosity:full, focus:code, varied confidence
 *          — focusBias ∈ [0,∞), focusConfidence ∈ [0,1], all focus fields finite
 *
 * Frozen 2026-09-20.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only)
 *   - buildCastExplanation metric freeze: no new fields added; validates existing set only
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { FocusProfiles } from '../src/focus.js';
import type { RoutedTool, ToolCandidate } from '../src/ollama-brain.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

/** All candidates at confidence=1 — uniform scores, fewer stat fields. */
class BrainMultiPositiveCoordinator extends SessionCoordinator {
  constructor() { super({}, { enabled: false }); }
  override async routeIntent(_q: string, candidates: ToolCandidate[]): Promise<RoutedTool[] | null> {
    if (candidates.length === 0) return null;
    return candidates.map((c) => ({ tool: c, confidence: 1, reason: 'fx-uniform' }));
  }
}

/** Varied confidence (1.0/0.5/0.1) — score dispersion, all stat fields present. */
class BrainVariedConfidenceCoordinator extends SessionCoordinator {
  constructor() { super({}, { enabled: false }); }
  override async routeIntent(_q: string, candidates: ToolCandidate[]): Promise<RoutedTool[] | null> {
    if (candidates.length === 0) return null;
    const confidences = [1.0, 0.5, 0.1];
    return candidates.map((c, i) => ({
      tool: c,
      confidence: confidences[Math.min(i, confidences.length - 1)] ?? 0.1,
      reason: 'fx-varied',
    }));
  }
}

const CONFIGS: ServerConfig[] = [
  { id: 'neon',   name: 'Neon',   type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',      lazy: true },
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp',      lazy: true },
  { id: 'tasks',  name: 'Tasks',  type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://tasks.chitty.cc/mcp', lazy: true },
];

const FOCUS_PROFILES: FocusProfiles = {
  profiles: { code: { categories: [], servers: ['neon'], boost: 0.5 } },
};

let _seq = 0;
function makeAgg(withFocus: boolean, coordinator: SessionCoordinator): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon',   FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  backend.defineServer('tasks',  FIXTURE_SERVERS.tasks);
  const opts: Record<string, unknown> = {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: join(tmpdir(), `ch1tty-fx-${Date.now()}-${++_seq}.jsonl`),
    coordinator,
  };
  if (withFocus) {
    opts.focusProfiles = FOCUS_PROFILES;
    opts.focus = 'code';
  }
  return new Aggregator(CONFIGS, opts as Parameters<typeof Aggregator.prototype.callTool>[1]);
}

async function getExplain(agg: Aggregator): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list database projects',
    explain: true,
    verbosity: 'full',
  });
  assert.equal(result.isError, undefined, 'cast must not error');
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.ok(body.explanation !== undefined, 'explanation must be present');
  return body.explanation as Record<string, unknown>;
}

// ── FX-1: verbosity:full, no focus, uniform confidence ───────────────────────

test('FX-1: brain-route verbosity:full no-focus — brainMs, method, candidateCount, core numeric types', async () => {
  const agg = makeAgg(false, new BrainMultiPositiveCoordinator());
  try {
    const exp = await getExplain(agg);
    assert.equal(typeof exp.brainMs, 'number', 'brainMs must be a number');
    assert.ok(Number.isFinite(exp.brainMs as number), 'brainMs must be finite');
    assert.ok((exp.brainMs as number) >= 0, 'brainMs must be >= 0');
    assert.equal(exp.method, 'brain', 'method must be "brain" on brain route');
    assert.equal(typeof exp.candidateCount, 'number', 'candidateCount must be a number');
    assert.ok((exp.candidateCount as number) > 0, 'candidateCount must be > 0 (resolved)');
    assert.equal(typeof exp.winnerScore, 'number', 'winnerScore must be a number');
    assert.ok(Number.isFinite(exp.winnerScore as number), 'winnerScore must be finite');
    assert.ok((exp.winnerScore as number) > 0, 'winnerScore must be > 0 (resolved)');
    assert.equal(typeof exp.winnerServer, 'string', 'winnerServer must be a string');
    assert.ok((exp.winnerServer as string).length > 0, 'winnerServer must be non-empty');
    assert.ok(Array.isArray(exp.topCandidates), 'topCandidates must be an array');
    assert.ok((exp.topCandidates as unknown[]).length > 0, 'topCandidates must be non-empty (resolved)');
    for (const k of ['candidateScoreMean', 'candidateScoreSpread', 'candidateScoreStdDev',
      'medianCandidateScore', 'winnerScoreRatio', 'scoreDominanceIndex']) {
      assert.equal(typeof exp[k], 'number', `${k} must be a number`);
      assert.ok(Number.isFinite(exp[k] as number), `${k} must be finite`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── FX-2: verbosity:full, focus:code, uniform confidence ─────────────────────

test('FX-2: brain-route verbosity:full focus:code uniform — brainMs, focus context types', async () => {
  const agg = makeAgg(true, new BrainMultiPositiveCoordinator());
  try {
    const exp = await getExplain(agg);
    assert.equal(typeof exp.brainMs, 'number', 'brainMs must be a number');
    assert.ok(Number.isFinite(exp.brainMs as number), 'brainMs must be finite');
    assert.ok((exp.brainMs as number) >= 0, 'brainMs must be >= 0');
    assert.equal(exp.method, 'brain', 'method must be "brain" on brain route');
    assert.equal(exp.focus, 'code', 'focus must be active profile name');
    assert.equal(typeof exp.focusBoost, 'number', 'focusBoost must be a number');
    assert.ok(Number.isFinite(exp.focusBoost as number), 'focusBoost must be finite');
    assert.ok((exp.focusBoost as number) > 0, 'focusBoost must be > 0');
    assert.equal(typeof exp.winnerInFocus, 'boolean', 'winnerInFocus must be a boolean');
    assert.equal(typeof exp.focusDecisive, 'boolean', 'focusDecisive must be a boolean');
    assert.equal(typeof exp.winnerFocusBoost, 'number', 'winnerFocusBoost must be a number');
    assert.ok(Number.isFinite(exp.winnerFocusBoost as number), 'winnerFocusBoost must be finite');
    assert.equal(typeof exp.winnerScoreBase, 'number', 'winnerScoreBase must be a number');
    assert.ok(Number.isFinite(exp.winnerScoreBase as number), 'winnerScoreBase must be finite');
    for (const k of ['focusMargin', 'focusRank', 'focusRankDelta', 'inFocusFraction',
      'candidatesInFocusCount', 'focusRankPercentile']) {
      assert.equal(typeof exp[k], 'number', `${k} must be a number`);
      assert.ok(Number.isFinite(exp[k] as number), `${k} must be finite`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── FX-3: verbosity:full, no focus, varied confidence ────────────────────────

test('FX-3: brain-route verbosity:full no-focus varied — brainMs finite, z-score/kurtosis/skewness fields finite', async () => {
  const agg = makeAgg(false, new BrainVariedConfidenceCoordinator());
  try {
    const exp = await getExplain(agg);
    assert.equal(typeof exp.brainMs, 'number', 'brainMs must be a number (varied confidence)');
    assert.ok(Number.isFinite(exp.brainMs as number), 'brainMs must be finite');
    assert.ok((exp.brainMs as number) >= 0, 'brainMs must be >= 0');
    assert.equal(exp.method, 'brain', 'method must be "brain"');
    for (const k of ['candidateScoreKurtosis', 'candidateScoreSkewness',
      'runnerUpScoreZScore', 'winnerScoreZScore', 'zScoreGap',
      'winnerRunnerUpGapToSpreadRatio', 'runnerUpLowestGapToSpreadRatio']) {
      if (exp[k] !== undefined) {
        assert.equal(typeof exp[k], 'number', `${k} must be a number when present`);
        assert.ok(Number.isFinite(exp[k] as number), `${k} must be finite when present`);
      }
    }
    assert.ok((exp.candidateCount as number) > 0, 'candidateCount must be > 0 (resolved)');
  } finally {
    await agg.shutdown();
  }
});

// ── FX-4: verbosity:full, focus:code, varied confidence ──────────────────────

test('FX-4: brain-route verbosity:full focus:code varied — focusBias, focusConfidence, all focus fields finite', async () => {
  const agg = makeAgg(true, new BrainVariedConfidenceCoordinator());
  try {
    const exp = await getExplain(agg);
    assert.equal(typeof exp.brainMs, 'number', 'brainMs must be a number');
    assert.ok(Number.isFinite(exp.brainMs as number), 'brainMs must be finite');
    assert.equal(exp.method, 'brain', 'method must be "brain"');
    assert.equal(exp.focus, 'code', 'focus must be active profile name');
    if (exp.focusBias !== undefined) {
      assert.equal(typeof exp.focusBias, 'number', 'focusBias must be a number when present');
      assert.ok(Number.isFinite(exp.focusBias as number), 'focusBias must be finite');
      assert.ok((exp.focusBias as number) >= 0, 'focusBias must be >= 0');
    }
    if (exp.focusConfidence !== undefined) {
      assert.equal(typeof exp.focusConfidence, 'number', 'focusConfidence must be a number when present');
      assert.ok(Number.isFinite(exp.focusConfidence as number), 'focusConfidence must be finite');
      assert.ok((exp.focusConfidence as number) >= 0, 'focusConfidence must be >= 0');
      assert.ok((exp.focusConfidence as number) <= 1, 'focusConfidence must be <= 1');
    }
    for (const k of ['focusMarginRatio', 'rawFocusMargin', 'rawFocusMarginRatio',
      'focusNetBoostDelta', 'winnerFocusBoostRatio']) {
      if (exp[k] !== undefined) {
        assert.equal(typeof exp[k], 'number', `${k} must be a number when present`);
        assert.ok(Number.isFinite(exp[k] as number), `${k} must be finite when present`);
      }
    }
    assert.equal(typeof exp.winnerInFocus, 'boolean', 'winnerInFocus must be a boolean');
    assert.equal(typeof exp.winnerFocusBoost, 'number', 'winnerFocusBoost must be a number');
    assert.ok(Number.isFinite(exp.winnerFocusBoost as number), 'winnerFocusBoost must be finite');
  } finally {
    await agg.shutdown();
  }
});
