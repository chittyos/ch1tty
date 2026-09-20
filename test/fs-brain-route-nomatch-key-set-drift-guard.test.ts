/**
 * FS: Drift guard — cast explain exact key set on brain-routed no_match responses.
 *
 * Extends FR (fallback-routed no_match key sets) to cover the brain route path.
 * When the coordinator returns a non-empty RoutedTool[] whose candidates are
 * subsequently filtered out by the score > 0 guard, cast still produces no_match
 * but with castRoute === 'brain', so buildCastExplanation receives brainMs and
 * emits it as a 5th key (no-focus, or low/medium verbosity with focus active) or
 * an 8th key (verbosity:full with focus active).
 *
 * Key sets frozen 2026-09-20 (BrainZeroConfidenceCoordinator + neon+stripe+tasks FixtureBackend):
 *
 *   brain no_match, verbosity:low,    no focus   → 5 keys: brainMs + 4 base
 *   brain no_match, verbosity:medium, no focus   → 5 keys  (same)
 *   brain no_match, verbosity:full,   no focus   → 5 keys  (same)
 *   brain no_match, verbosity:low,    focus:code → 5 keys  (focus fields absent at low verbosity)
 *   brain no_match, verbosity:medium, focus:code → 5 keys  (focus fields absent at medium verbosity)
 *   brain no_match, verbosity:full,   focus:code → 8 keys  (adds focus, focusBoost, winnerInFocus)
 *
 * Mechanism: BrainZeroConfidenceCoordinator returns a non-empty RoutedTool[] with
 * confidence === 0 for every entry. The aggregator sets castRoute = 'brain' because
 * routed.length > 0, but scoredTools becomes empty after the t.score > 0 filter, so
 * the response is no_match while brainMs is still forwarded to buildCastExplanation.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only change)
 *   - buildCastExplanation metric freeze: no new fields added; freezes existing set
 *
 * If a suite fails with unexpected keys: a new field was added to no_match —
 *   REJECT per CLAUDE.md § buildCastExplanation metric freeze.
 * If it fails with missing keys: a field was renamed or removed —
 *   update the frozen set only after confirming the intent.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { FocusProfiles } from '../src/focus.js';
import type { RoutedTool, ToolCandidate } from '../src/ollama-brain.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

/**
 * Returns a non-empty RoutedTool[] with confidence=0 for the first candidate.
 * The aggregator sets castRoute='brain' (routed.length>0) but filters scoredTools
 * to empty (t.score>0 fails), yielding no_match with brainMs in the explanation.
 */
class BrainZeroConfidenceCoordinator extends SessionCoordinator {
  override async routeIntent(
    _query: string,
    candidates: ToolCandidate[],
  ): Promise<RoutedTool[] | null> {
    if (candidates.length === 0) return null;
    return [{ tool: candidates[0], confidence: 0, reason: 'zero-confidence-fs-guard' }];
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

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-fs-${Date.now()}-${++dlqSeq}.jsonl`);
}

function makeAgg(withFocus: boolean): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon',   FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  backend.defineServer('tasks',  FIXTURE_SERVERS.tasks);
  const opts: NonNullable<ConstructorParameters<typeof Aggregator>[1]> = {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    coordinator: new BrainZeroConfidenceCoordinator({}, { enabled: false }),
  };
  if (withFocus) {
    opts.focusProfiles = FOCUS_PROFILES;
    opts.focus = 'code';
  }
  return new Aggregator(CONFIGS, opts);
}

const NO_MATCH_INTENT = 'zzzzzz_fs_guard_definitely_no_match_brain_xxxxxxxxx_12345';

/** 5-key set for brain-routed no_match (all verbosities; or low/medium with focus). */
const BRAIN_BASE_NO_MATCH_KEYS = ['brainMs', 'candidateCount', 'method', 'rationale', 'topCandidates'];

/** 8-key set for brain-routed no_match at verbosity:full with focus:code active. */
const BRAIN_FULL_FOCUS_NO_MATCH_KEYS = [
  'brainMs',
  'candidateCount',
  'focus',
  'focusBoost',
  'method',
  'rationale',
  'topCandidates',
  'winnerInFocus',
];

async function getExplainKeys(
  agg: Aggregator,
  verbosity: 'low' | 'medium' | 'full',
  focus?: string,
): Promise<string[]> {
  const args: Record<string, unknown> = { intent: NO_MATCH_INTENT, explain: true, verbosity };
  if (focus) args['focus'] = focus;
  const result = await agg.callTool('ch1tty/cast', args);
  assert.equal(result.isError, undefined, `cast must not error (v:${verbosity} f:${focus ?? 'none'})`);
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body['cast'], 'no_match', `must be no_match (v:${verbosity} f:${focus ?? 'none'})`);
  assert.ok(body['explanation'] !== undefined, 'explanation must be present');
  return Object.keys(body['explanation'] as object).sort();
}

// ── Suite FS-1: verbosity:low, no focus ─────────────────────────────────────

describe('FS-1: brain-route verbosity:low no-focus no_match — exact 5-key set', () => {
  test('explain key set is exactly 5 keys (brainMs added vs FR 4-key fallback set)', async () => {
    const agg = makeAgg(false);
    try {
      const keys = await getExplainKeys(agg, 'low');
      assert.deepEqual(
        keys,
        [...BRAIN_BASE_NO_MATCH_KEYS].sort(),
        `brain-route verbosity:low no-focus no_match must have 5 keys: ${JSON.stringify(BRAIN_BASE_NO_MATCH_KEYS)}`,
      );
    } finally { await agg.shutdown(); }
  });
});

// ── Suite FS-2: verbosity:medium, no focus ───────────────────────────────────

describe('FS-2: brain-route verbosity:medium no-focus no_match — exact 5-key set', () => {
  test('explain key set is exactly 5 keys', async () => {
    const agg = makeAgg(false);
    try {
      const keys = await getExplainKeys(agg, 'medium');
      assert.deepEqual(
        keys,
        [...BRAIN_BASE_NO_MATCH_KEYS].sort(),
        `brain-route verbosity:medium no-focus no_match must have 5 keys: ${JSON.stringify(BRAIN_BASE_NO_MATCH_KEYS)}`,
      );
    } finally { await agg.shutdown(); }
  });
});

// ── Suite FS-3: verbosity:full, no focus ─────────────────────────────────────

describe('FS-3: brain-route verbosity:full no-focus no_match — exact 5-key set', () => {
  test('explain key set is exactly 5 keys', async () => {
    const agg = makeAgg(false);
    try {
      const keys = await getExplainKeys(agg, 'full');
      assert.deepEqual(
        keys,
        [...BRAIN_BASE_NO_MATCH_KEYS].sort(),
        `brain-route verbosity:full no-focus no_match must have 5 keys: ${JSON.stringify(BRAIN_BASE_NO_MATCH_KEYS)}`,
      );
    } finally { await agg.shutdown(); }
  });

  test('brainMs is a non-negative number', async () => {
    const agg = makeAgg(false);
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: NO_MATCH_INTENT, explain: true, verbosity: 'full',
      });
      const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
      const exp = body['explanation'] as Record<string, unknown>;
      assert.equal(typeof exp['brainMs'], 'number', 'brainMs must be a number');
      assert.ok((exp['brainMs'] as number) >= 0, 'brainMs must be >= 0');
      assert.equal(exp['method'], 'brain', 'method must be "brain" on brain-routed path');
    } finally { await agg.shutdown(); }
  });
});

// ── Suite FS-4: verbosity:low, focus:code ────────────────────────────────────
// Focus fields must be ABSENT at low verbosity even when focus is active (same as FR-4).

describe('FS-4: brain-route verbosity:low focus:code no_match — same 5-key set (focus fields absent)', () => {
  test('explain key set is exactly 5 keys (focus context not emitted at low verbosity)', async () => {
    const agg = makeAgg(true);
    try {
      const keys = await getExplainKeys(agg, 'low', 'code');
      assert.deepEqual(
        keys,
        [...BRAIN_BASE_NO_MATCH_KEYS].sort(),
        'brain-route verbosity:low focus:code no_match must have 5 keys (focus absent at low verbosity)',
      );
    } finally { await agg.shutdown(); }
  });
});

// ── Suite FS-5: verbosity:medium, focus:code ─────────────────────────────────

describe('FS-5: brain-route verbosity:medium focus:code no_match — same 5-key set (focus fields absent)', () => {
  test('explain key set is exactly 5 keys (focus context not emitted at medium verbosity)', async () => {
    const agg = makeAgg(true);
    try {
      const keys = await getExplainKeys(agg, 'medium', 'code');
      assert.deepEqual(
        keys,
        [...BRAIN_BASE_NO_MATCH_KEYS].sort(),
        'brain-route verbosity:medium focus:code no_match must have 5 keys (focus absent at medium verbosity)',
      );
    } finally { await agg.shutdown(); }
  });
});

// ── Suite FS-6: verbosity:full, focus:code ───────────────────────────────────
// At full verbosity the aggregator emits focus context even on no_match:
//   focus        → active profile name ('code')
//   focusBoost   → configured boost value (> 0)
//   winnerInFocus → false (no winner to be in focus)
// Plus brainMs (brain-routed path), totalling 8 keys.

describe('FS-6: brain-route verbosity:full focus:code no_match — exact 8-key set', () => {
  test('explain key set is exactly 8 keys (3 focus-context keys + brainMs)', async () => {
    const agg = makeAgg(true);
    try {
      const keys = await getExplainKeys(agg, 'full', 'code');
      assert.deepEqual(
        keys,
        [...BRAIN_FULL_FOCUS_NO_MATCH_KEYS].sort(),
        `brain-route verbosity:full focus:code no_match must have 8 keys: ${JSON.stringify(BRAIN_FULL_FOCUS_NO_MATCH_KEYS)}`,
      );
    } finally { await agg.shutdown(); }
  });

  test('focus is profile name, focusBoost is number > 0, winnerInFocus is false, brainMs is number >= 0', async () => {
    const agg = makeAgg(true);
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: NO_MATCH_INTENT, explain: true, verbosity: 'full', focus: 'code',
      });
      const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
      const exp = body['explanation'] as Record<string, unknown>;
      assert.equal(exp['focus'], 'code', 'focus must equal active profile name');
      assert.equal(typeof exp['focusBoost'], 'number', 'focusBoost must be a number');
      assert.ok((exp['focusBoost'] as number) > 0, 'focusBoost must be > 0');
      assert.equal(exp['winnerInFocus'], false, 'winnerInFocus must be false (no winner on no_match)');
      assert.equal(typeof exp['brainMs'], 'number', 'brainMs must be a number');
      assert.ok((exp['brainMs'] as number) >= 0, 'brainMs must be >= 0');
      assert.equal(exp['method'], 'brain', 'method must be "brain" on brain-routed path');
    } finally { await agg.shutdown(); }
  });
});
