/**
 * FN: Drift guard — cast explain value types for 7 remaining focus-only fields
 * at verbosity:'full'.
 *
 * EW (ew-cast-explain-focus-value-types-full.test.ts) freezes value types for
 * 24 of the 31 focus-only verbosity:full fields. FN freezes the remaining 7:
 *
 *   focusBias              → number ≥ 0; can exceed 1 (= winnerFocusBoost / focusMargin)
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

  test('FN-1c: outOfFocusBottomScore ≤ outOfFocusMeanScore ≤ topOutOfFocusScore (ordering invariant)', async () => {
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

      const bottom = ex['outOfFocusBottomScore'] as number;
      const mean   = ex['outOfFocusMeanScore']   as number;
      const top    = ex['topOutOfFocusScore']     as number;

      assert.equal(typeof bottom, 'number', 'outOfFocusBottomScore must be a number');
      assert.equal(typeof mean,   'number', 'outOfFocusMeanScore must be a number');
      assert.equal(typeof top,    'number', 'topOutOfFocusScore must be a number');

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
// rawFocusMarginRatio = rawFocusMargin / winnerScoreBase (can be negative)
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

  test('FN-2b: rawFocusMarginRatio is a finite number (can be negative if focus reversed ranking)', async () => {
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

      const v = ex['rawFocusMarginRatio'] as number;
      assert.equal(typeof v, 'number', 'rawFocusMarginRatio must be a number');
      assert.ok(Number.isFinite(v), 'rawFocusMarginRatio must be finite');
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
});

// ── Suite 3: focus decisiveness fractions types and relationship ──────────────
//
// focusBias      = winnerFocusBoost / focusMargin  (≥ 0; can exceed 1)
// focusConfidence = Math.min(1, focusBias)          (always ∈ [0, 1])
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

  test('FN-3c: focusConfidence === Math.min(1, focusBias) — clamp relationship invariant', async () => {
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

      const bias       = ex['focusBias']       as number;
      const confidence = ex['focusConfidence'] as number;

      assert.equal(typeof bias,       'number', 'focusBias must be a number');
      assert.equal(typeof confidence, 'number', 'focusConfidence must be a number');

      const expected = Math.min(1, bias);
      assert.ok(
        Math.abs(confidence - expected) < 1e-10,
        `focusConfidence (${confidence}) must equal Math.min(1, focusBias) = Math.min(1, ${bias}) = ${expected}`,
      );
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
