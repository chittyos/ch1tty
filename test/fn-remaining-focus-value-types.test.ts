/**
 * FN: Drift guard — cast explain value types for 7 remaining focus-only fields
 * at verbosity:'full'.
 *
 * EW (ew-cast-explain-focus-value-types-full.test.ts) freezes value types for
 * 24 of the 31 focus-only verbosity:full fields. FN freezes the remaining 7:
 *
 *   focusBias              → number ≥ 0; can exceed 1 (= focusBoost / focusMargin)
 *   focusConfidence        → number ∈ [0,1] (= Math.min(1, focusBias))
 *   focusMarginRatio       → number ∈ [0,1] (= focusMargin / winnerScore)
 *   rawFocusMarginRatio    → number, finite (can be negative if focus reversed ranking)
 *   runnerUpFocusBoostRatio → number ∈ [0,1] (= runnerUpFocusBoost / runnerUpScore)
 *   outOfFocusMeanScore    → number ≥ 0 (arithmetic mean of out-of-focus candidate scores)
 *   outOfFocusBottomScore  → number ≥ 0 (minimum of out-of-focus candidate scores)
 *
 * Fixture: 3 backends — neon (category:code, in-focus), stripe + tasks (out-of-focus)
 * with focus:code. This guarantees:
 *   - ≥ 2 candidates so runner-up and margin fields appear
 *   - out-of-focus candidates (stripe, tasks) so outOfFocusMeanScore and
 *     outOfFocusBottomScore appear
 *   - focusMargin > 0 with "list database projects" intent so focusBias /
 *     focusConfidence appear
 *
 * Reversal fixture (FN-2d, FN-3c): intent "pay invoice amount" (3 terms).
 * neon tool name "execute_payment", description "pay invoice" → 2/3 raw 0.67.
 * stripe tool name "charge", description "pay invoice amount fees" → 3/3 raw 1.0.
 * Tool names are chosen to avoid substring collisions with intent terms.
 * With boost 0.5 (additive): neon final 1.17, stripe final 1.0. Neon wins by
 * focus even though its raw score was lower.
 *   winnerScoreBase = 0.67, runnerUpScoreBase = 1.0
 *   rawFocusMarginRatio ≈ (0.67 - 1.0) / 0.67 ≈ −0.49  (negative)
 *   focusBias = 0.5 / 0.17 ≈ 2.94 > 1
 *   focusConfidence = Math.min(1, 2.94) = 1  (clamped)
 *
 * CLAUDE.md § buildCastExplanation metric freeze: no new fields added; value
 * types of existing fields only.
 *
 * Frozen 2026-09-20.
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
  return join(tmpdir(), `ch1tty-fn-${Date.now()}-${++dlqSeq}.jsonl`);
}

/**
 * Inline focus profiles keep the suite hermetic: CH1TTY_FOCUS_PROFILES env
 * var cannot override the 'code' profile definition at runtime.
 * neon is in-focus (category 'code'); stripe and tasks are out-of-focus.
 */
const FOCUS_PROFILES = {
  profiles: {
    code: { categories: ['code'] as string[], servers: ['neon'] as string[], boost: 0.5 },
  },
};

const CONFIGS: ServerConfig[] = [
  { id: 'neon',   name: 'Neon',   type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',      lazy: true },
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp',      lazy: true },
  { id: 'tasks',  name: 'Tasks',  type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://tasks.chitty.cc/mcp', lazy: true },
];

/** Standard 3-backend fixture: neon in-focus, stripe + tasks out-of-focus. */
function makeAggregator(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon',   FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  backend.defineServer('tasks',  FIXTURE_SERVERS.tasks);
  return new Aggregator(CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    focusProfiles: FOCUS_PROFILES,
  });
}

/**
 * Distinct out-of-focus score fixture for FN-1c ordering guard.
 *
 * Intent "list database projects" (3 terms: list, database, projects):
 *   neon/list_projects  "list all Neon database projects"  → 3/3 = 1.00 + 0.5 boost = 1.50
 *   ecosA/list_txn      "list database transactions"       → 2/3 = 0.67  (higher OOF)
 *   ecosB/list_pmts     "list payment items"               → 1/3 = 0.33  (lower OOF)
 *
 * OOF scores [0.67, 0.33] are distinct: bottom < mean < top is meaningful.
 */
function makeDistinctOOFAggregator(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [{ name: 'list_projects', description: 'list all Neon database projects', inputSchema: { type: 'object', properties: {} }, response: { content: [{ type: 'text', text: '[]' }] } }],
  });
  backend.defineServer('ecosA', {
    tools: [{ name: 'list_txn', description: 'list database transactions', inputSchema: { type: 'object', properties: {} }, response: { content: [{ type: 'text', text: '[]' }] } }],
  });
  backend.defineServer('ecosB', {
    tools: [{ name: 'list_pmts', description: 'list payment items', inputSchema: { type: 'object', properties: {} }, response: { content: [{ type: 'text', text: '[]' }] } }],
  });
  const configs: ServerConfig[] = [
    { id: 'neon',  name: 'Neon',  type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',         lazy: true },
    { id: 'ecosA', name: 'EcosA', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://ecos-a.example.com/mcp', lazy: true },
    { id: 'ecosB', name: 'EcosB', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://ecos-b.example.com/mcp', lazy: true },
  ];
  return new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    focusProfiles: FOCUS_PROFILES,
  });
}

/**
 * Reversal fixture: focus promotes a previously lower-ranked in-focus tool.
 *
 * Intent "pay invoice amount" (3 terms: pay, invoice, amount):
 *   neon/execute_payment  "pay invoice"              → 2/3 = 0.67 + 0.5 boost = 1.17
 *   stripe/charge         "pay invoice amount fees"  → 3/3 = 1.00  (no boost)
 *
 * Tool names are chosen to avoid substring collisions with intent terms so the
 * only match surface is the description. Neon wins post-focus (1.17 > 1.00)
 * even though its raw score was lower (0.67 < 1.00).
 * This gives rawFocusMarginRatio < 0 and focusBias > 1 (clamped to confidence = 1).
 */
function makeReversalAggregator(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [{ name: 'execute_payment', description: 'pay invoice', inputSchema: { type: 'object', properties: {} }, response: { content: [{ type: 'text', text: '[]' }] } }],
  });
  backend.defineServer('stripe', {
    tools: [{ name: 'charge', description: 'pay invoice amount fees', inputSchema: { type: 'object', properties: {} }, response: { content: [{ type: 'text', text: '[]' }] } }],
  });
  const configs: ServerConfig[] = [
    { id: 'neon',   name: 'Neon',   type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp', lazy: true },
    { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
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

// ── Suite 1: out-of-focus score group types and ordering ──────────────────────
//
// outOfFocusMeanScore and outOfFocusBottomScore are present when at least one
// out-of-focus candidate exists (stripe and tasks are out-of-focus in this fixture).
// Together with topOutOfFocusScore (tested in EW), they satisfy the ordering
// invariant: outOfFocusBottomScore ≤ outOfFocusMeanScore ≤ topOutOfFocusScore.

describe('FN-1 — out-of-focus score triple value types at verbosity:full, focus:code', () => {
  test('FN-1a: outOfFocusMeanScore is a finite number ≥ 0', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'full',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = parseBody(result);
      const ex = getExplanation(body);

      assert.ok(ex['outOfFocusCandidatesCount'] as number > 0, 'fixture must have out-of-focus candidates');
      const v = ex['outOfFocusMeanScore'] as number;
      assert.equal(typeof v, 'number', 'outOfFocusMeanScore must be a number');
      assert.ok(Number.isFinite(v), 'outOfFocusMeanScore must be finite');
      assert.ok(v >= 0, `outOfFocusMeanScore must be ≥ 0, got ${v}`);
    } finally {
      await agg.shutdown();
    }
  });

  test('FN-1b: outOfFocusBottomScore is a finite number ≥ 0', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'full',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = parseBody(result);
      const ex = getExplanation(body);

      assert.ok(ex['outOfFocusCandidatesCount'] as number > 0, 'fixture must have out-of-focus candidates');
      const v = ex['outOfFocusBottomScore'] as number;
      assert.equal(typeof v, 'number', 'outOfFocusBottomScore must be a number');
      assert.ok(Number.isFinite(v), 'outOfFocusBottomScore must be finite');
      assert.ok(v >= 0, `outOfFocusBottomScore must be ≥ 0, got ${v}`);
    } finally {
      await agg.shutdown();
    }
  });

  test('FN-1c: outOfFocusBottomScore < outOfFocusMeanScore < topOutOfFocusScore (strict ordering with distinct scores)', async () => {
    // Uses makeDistinctOOFAggregator to guarantee the three OOF scores are distinct
    // (ecosA: 0.67, ecosB: 0.33 for intent "list database projects"), so the
    // ordering guard can detect regressions that populate mean/bottom from the top.
    const agg = makeDistinctOOFAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'full',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = parseBody(result);
      const ex = getExplanation(body);

      const bottom = ex['outOfFocusBottomScore'] as number;
      const mean   = ex['outOfFocusMeanScore']   as number;
      const top    = ex['topOutOfFocusScore']     as number;

      assert.equal(typeof bottom, 'number', 'outOfFocusBottomScore must be a number');
      assert.equal(typeof mean,   'number', 'outOfFocusMeanScore must be a number');
      assert.equal(typeof top,    'number', 'topOutOfFocusScore must be a number');

      // Confirm the fixture produces genuinely distinct OOF scores (guards against
      // all-equal scores making the ordering trivially pass even if mean = top).
      assert.ok(
        bottom < top - 1e-10,
        `OOF scores must be distinct (bottom ${bottom} must be strictly < top ${top}); fixture design error`,
      );

      // Strict ordering: bottom < mean < top
      assert.ok(
        bottom <= mean + 1e-10,
        `outOfFocusBottomScore (${bottom}) must be ≤ outOfFocusMeanScore (${mean})`,
      );
      assert.ok(
        mean <= top + 1e-10,
        `outOfFocusMeanScore (${mean}) must be ≤ topOutOfFocusScore (${top})`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('FN-1d: outOfFocusMeanScore and outOfFocusBottomScore absent when all candidates are in-focus', async () => {
    const backend = new FixtureBackend();
    backend.defineServer('neon', FIXTURE_SERVERS.neon);
    const soloConfig: ServerConfig[] = [
      { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true },
    ];
    const agg = new Aggregator(soloConfig, {
      backendFactory: () => backend,
      embedEnabled: false,
      ledgerDlqPath: dlq(),
      focusProfiles: FOCUS_PROFILES,
    });
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'full',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = parseBody(result);
      const ex = getExplanation(body);

      // Precondition: fixture must produce ≥ 1 candidate, all in-focus.
      // If candidateCount === 0, the absence of OOF scores is trivial (no winner).
      const candidateCount = ex['candidateCount'] as number;
      assert.ok(candidateCount > 0, 'fixture must produce ≥ 1 candidate (solo in-focus neon tool matches the intent)');
      const outOfFocusCount = ex['outOfFocusCandidatesCount'] as number;
      assert.equal(outOfFocusCount, 0, 'fixture must have 0 out-of-focus candidates (solo in-focus server)');

      // When all candidates are in-focus, out-of-focus score group must be absent
      assert.equal(ex['outOfFocusMeanScore'],   undefined, 'outOfFocusMeanScore must be absent when all candidates in-focus');
      assert.equal(ex['outOfFocusBottomScore'], undefined, 'outOfFocusBottomScore must be absent when all candidates in-focus');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 2: margin ratio and boost-fraction types and ranges ─────────────────
//
// focusMarginRatio   = focusMargin / winnerScore ∈ [0, 1]
// rawFocusMarginRatio = (winnerScoreBase - runnerUpScoreBase) / winnerScoreBase
//                      (can be negative when focus reverses ranking)
// runnerUpFocusBoostRatio = runnerUpFocusBoost / runnerUpScore ∈ [0, 1]
//
// All three require ≥ 2 candidates and a positive denominator (division guard).

describe('FN-2 — margin ratio and boost-fraction value types at verbosity:full, focus:code', () => {
  test('FN-2a: focusMarginRatio is a finite number ∈ [0, 1]', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'full',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = parseBody(result);
      const ex = getExplanation(body);

      const v = ex['focusMarginRatio'] as number;
      assert.equal(typeof v, 'number', 'focusMarginRatio must be a number');
      assert.ok(Number.isFinite(v), 'focusMarginRatio must be finite');
      assert.ok(v >= 0, `focusMarginRatio must be ≥ 0, got ${v}`);
      assert.ok(v <= 1, `focusMarginRatio must be ≤ 1, got ${v}`);
    } finally {
      await agg.shutdown();
    }
  });

  test('FN-2b: rawFocusMarginRatio is finite and equals (winnerScoreBase − runnerUpScoreBase) / winnerScoreBase', async () => {
    // Also verifies the formula is not corrupted by abs() or clamping — a correct
    // positive case: winner leads raw so rawFocusMarginRatio > 0.
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'full',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = parseBody(result);
      const ex = getExplanation(body);

      const v           = ex['rawFocusMarginRatio'] as number;
      const winnerBase  = ex['winnerScoreBase']     as number;
      const runnerBase  = ex['runnerUpScoreBase']   as number;
      assert.equal(typeof v,          'number', 'rawFocusMarginRatio must be a number');
      assert.equal(typeof winnerBase, 'number', 'winnerScoreBase must be a number');
      assert.equal(typeof runnerBase, 'number', 'runnerUpScoreBase must be a number');

      assert.ok(Number.isFinite(v), 'rawFocusMarginRatio must be finite');

      // Formula invariant: rawFocusMarginRatio = (winnerBase - runnerBase) / winnerBase
      const expected = (winnerBase - runnerBase) / winnerBase;
      assert.ok(
        Math.abs(v - expected) < 1e-9,
        `rawFocusMarginRatio (${v}) must equal (${winnerBase} - ${runnerBase}) / ${winnerBase} = ${expected}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('FN-2c: runnerUpFocusBoostRatio is a finite number ∈ [0, 1]', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'full',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = parseBody(result);
      const ex = getExplanation(body);

      const v = ex['runnerUpFocusBoostRatio'] as number;
      assert.equal(typeof v, 'number', 'runnerUpFocusBoostRatio must be a number');
      assert.ok(Number.isFinite(v), 'runnerUpFocusBoostRatio must be finite');
      assert.ok(v >= 0, `runnerUpFocusBoostRatio must be ≥ 0, got ${v}`);
      assert.ok(v <= 1, `runnerUpFocusBoostRatio must be ≤ 1, got ${v}`);
    } finally {
      await agg.shutdown();
    }
  });

  test('FN-2d: rawFocusMarginRatio is negative when focus reverses ranking (reversal fixture)', async () => {
    // Reversal fixture: neon raw 0.67 < stripe raw 1.00, but neon wins post-focus
    // (0.67 + 0.5 = 1.17). winnerScoreBase (0.67) < runnerUpScoreBase (1.00)
    // → rawFocusMarginRatio ≈ -0.49. An impl using Math.abs or clamping to 0 fails.
    const agg = makeReversalAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'pay invoice amount',
        explain: true,
        verbosity: 'full',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = parseBody(result);
      const ex = getExplanation(body);

      // Verify reversal preconditions hold in this fixture.
      const winnerBase  = ex['winnerScoreBase']   as number;
      const runnerBase  = ex['runnerUpScoreBase'] as number;
      assert.ok(typeof winnerBase === 'number' && typeof runnerBase === 'number', 'base scores must be numbers');
      assert.ok(
        winnerBase < runnerBase - 1e-10,
        `reversal fixture must have winnerScoreBase (${winnerBase}) < runnerUpScoreBase (${runnerBase})`,
      );

      const v = ex['rawFocusMarginRatio'] as number;
      assert.equal(typeof v, 'number', 'rawFocusMarginRatio must be a number');
      assert.ok(Number.isFinite(v), 'rawFocusMarginRatio must be finite');
      assert.ok(v < 0, `rawFocusMarginRatio must be negative in a reversal (winner raw < runner raw); got ${v}`);
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 3: focus decisiveness fractions types and relationship ──────────────
//
// focusBias      = focusBoost / focusMargin  (≥ 0; can exceed 1 when boost > margin)
// focusConfidence = Math.min(1, focusBias)   (always ∈ [0, 1])
// Both are absent when focusMargin === 0 (tied candidates) or no runner-up.

describe('FN-3 — focus decisiveness fraction value types at verbosity:full, focus:code', () => {
  test('FN-3a: focusBias is a finite number ≥ 0 (can exceed 1 when boost > margin)', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'full',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = parseBody(result);
      const ex = getExplanation(body);

      const v = ex['focusBias'] as number;
      assert.equal(typeof v, 'number', 'focusBias must be a number');
      assert.ok(Number.isFinite(v), 'focusBias must be finite');
      assert.ok(v >= 0, `focusBias must be ≥ 0, got ${v}`);
    } finally {
      await agg.shutdown();
    }
  });

  test('FN-3b: focusConfidence is a finite number ∈ [0, 1]', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'full',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = parseBody(result);
      const ex = getExplanation(body);

      const v = ex['focusConfidence'] as number;
      assert.equal(typeof v, 'number', 'focusConfidence must be a number');
      assert.ok(Number.isFinite(v), 'focusConfidence must be finite');
      assert.ok(v >= 0, `focusConfidence must be ≥ 0, got ${v}`);
      assert.ok(v <= 1, `focusConfidence must be ≤ 1, got ${v}`);
    } finally {
      await agg.shutdown();
    }
  });

  test('FN-3c: focusConfidence clamps to 1 when focusBias > 1 (reversal fixture exercises the Math.min branch)', async () => {
    // Reversal fixture: neon raw 0.67, stripe raw 1.00, boost 0.5 (additive).
    // focusMargin = 1.17 - 1.00 = 0.17; focusBias = 0.5 / 0.17 ≈ 2.94 > 1.
    // focusConfidence = Math.min(1, 2.94) = 1 exactly.
    // An impl that omits the clamp would emit focusConfidence ≈ 2.94 and fail the ≤1 bound.
    const agg = makeReversalAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'pay invoice amount',
        explain: true,
        verbosity: 'full',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = parseBody(result);
      const ex = getExplanation(body);

      const bias       = ex['focusBias']       as number;
      const confidence = ex['focusConfidence'] as number;

      assert.equal(typeof bias,       'number', 'focusBias must be a number');
      assert.equal(typeof confidence, 'number', 'focusConfidence must be a number');

      // Precondition: reversal fixture must give focusBias > 1
      assert.ok(bias > 1, `reversal fixture must yield focusBias > 1; got ${bias}`);

      // Clamp: confidence must be exactly 1 when bias > 1
      assert.equal(confidence, 1, `focusConfidence must be 1 (clamped) when focusBias (${bias}) > 1`);

      // Relationship still holds: confidence === Math.min(1, bias)
      assert.equal(confidence, Math.min(1, bias), `focusConfidence must equal Math.min(1, focusBias) = ${Math.min(1, bias)}`);
    } finally {
      await agg.shutdown();
    }
  });

  test('FN-3d: focusBias and focusConfidence absent when focusMargin is 0 (tied scores)', async () => {
    // Build a fixture where two tools have exactly the same raw score so the
    // post-focus margin is zero: both tools have identical descriptions and the
    // same category (both in-focus or both out-of-focus), meaning focus doesn't
    // differentiate them and focusMargin === 0.
    const backend = new FixtureBackend();
    backend.defineServer('a', {
      tools: [{
        name: 'tool_alpha',
        description: 'list all database records',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '[]' }] },
      }],
    });
    backend.defineServer('b', {
      tools: [{
        name: 'tool_beta',
        description: 'list all database records',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '[]' }] },
      }],
    });
    const tiedConfigs: ServerConfig[] = [
      { id: 'a', name: 'A', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://a.example.com/mcp', lazy: true },
      { id: 'b', name: 'B', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://b.example.com/mcp', lazy: true },
    ];
    const tiedFocusProfiles = {
      profiles: { code: { categories: ['code'] as string[], servers: [] as string[], boost: 0.5 } },
    };
    const agg = new Aggregator(tiedConfigs, {
      backendFactory: () => backend,
      embedEnabled: false,
      ledgerDlqPath: dlq(),
      focusProfiles: tiedFocusProfiles,
    });
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list all database records',
        explain: true,
        verbosity: 'full',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = parseBody(result);
      const ex = getExplanation(body);

      // Precondition: fixture must produce ≥ 2 candidates with focusMargin === 0.
      // If candidateCount < 2, both fields are absent for a different reason (no runner-up).
      const candidateCount = ex['candidateCount'] as number;
      assert.ok(candidateCount >= 2, `tied-score fixture must produce ≥ 2 candidates; got ${candidateCount}`);
      const focusMargin = ex['focusMargin'] as number;
      assert.equal(typeof focusMargin, 'number', 'focusMargin must be a number in the tied fixture');
      assert.ok(Math.abs(focusMargin) < 1e-10, `tied-score fixture must have focusMargin === 0; got ${focusMargin}`);

      // With both tools out-of-focus and identical scores, focusMargin === 0.
      // focusBias and focusConfidence must be absent.
      assert.equal(
        ex['focusBias'],
        undefined,
        'focusBias must be absent when focusMargin === 0',
      );
      assert.equal(
        ex['focusConfidence'],
        undefined,
        'focusConfidence must be absent when focusMargin === 0',
      );
    } finally {
      await agg.shutdown();
    }
  });
});
