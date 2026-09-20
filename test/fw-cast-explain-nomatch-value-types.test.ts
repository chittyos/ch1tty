/**
 * FW drift guard: freeze cast explain VALUE TYPES for no_match responses.
 *
 * FR/FS freeze the EXACT KEY SETS for no_match explain. FW is the complementary
 * value-type guard: every field present in the no_match explanation is validated
 * against its expected type and constraint.
 *
 * Coverage matrix (route × focus):
 *   FW-1  fallback (NullRoutingCoordinator), no focus
 *   FW-2  fallback (NullRoutingCoordinator), focus:code
 *   FW-3  brain-route (BrainZeroConfidenceCoordinator), no focus
 *   FW-4  brain-route (BrainZeroConfidenceCoordinator), focus:code
 *
 * Frozen types (2026-09-20):
 *   method         → string, 'keyword' | 'brain'
 *   candidateCount → number === 0 (no candidates for no_match)
 *   topCandidates  → array, length === 0 (empty when candidateCount === 0)
 *   rationale      → non-empty string
 *   brainMs        → finite number >= 0 (brain route only)
 *   focus          → string equal to the active profile name (focus+full verbosity only)
 *   focusBoost     → finite number > 0 (focus+full verbosity only)
 *   winnerInFocus  → boolean === false (focus+full verbosity only; no winner when count===0)
 *
 * Verbosity choice: FW-1/FW-3 use verbosity:full (superset of fields at low/medium).
 * FW-2/FW-4 use verbosity:full to capture focus fields (only present at full verbosity
 * for the no_match path). FR/FS already confirm the key sets hold at low/medium.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only)
 *   - buildCastExplanation metric freeze: no new fields; validates the existing set only
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

// ── Coordinator stubs ─────────────────────────────────────────────────────────

class NullRoutingCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

/** Returns a non-empty RoutedTool[] with confidence=0 — brain route with empty scoredTools → no_match */
class BrainZeroConfidenceCoordinator extends SessionCoordinator {
  override async routeIntent(
    _query: string,
    candidates: ToolCandidate[],
  ): Promise<RoutedTool[] | null> {
    if (candidates.length === 0) return null;
    return [{ tool: candidates[0], confidence: 0, reason: 'zero-confidence-fw-guard' }];
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const NO_MATCH_INTENT = 'zzzzzz_fw_guard_definitely_no_match_xxxxxxxxx_12345';

const CONFIGS: ServerConfig[] = [
  { id: 'neon',   name: 'Neon',   type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',         lazy: true },
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp',         lazy: true },
  { id: 'tasks',  name: 'Tasks',  type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://tasks.chitty.cc/mcp',    lazy: true },
];

const FOCUS_PROFILES: FocusProfiles = {
  profiles: { code: { categories: [], servers: ['neon'], boost: 0.5 } },
};

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-fw-${Date.now()}-${++dlqSeq}.jsonl`);
}

function makeAgg(coordinator: SessionCoordinator, withFocus: boolean): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon',   FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  backend.defineServer('tasks',  FIXTURE_SERVERS.tasks);
  const opts: Record<string, unknown> = {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    coordinator,
  };
  if (withFocus) {
    opts.focusProfiles = FOCUS_PROFILES;
    opts.focus = 'code';
  }
  return new Aggregator(CONFIGS, opts as Parameters<typeof Aggregator.prototype.callTool>[1]);
}

function parseExplanation(result: { isError?: boolean; content: Array<{ text?: unknown }> }): Record<string, unknown> {
  assert.equal(result.isError, undefined, 'cast must not error');
  const text = (result.content[0] as { text?: unknown }).text;
  assert.equal(typeof text, 'string', 'content[0].text must be a string');
  const body = JSON.parse(text as string) as Record<string, unknown>;
  assert.equal(body.cast, 'no_match', 'cast must be no_match');
  assert.ok(body.explanation !== null && typeof body.explanation === 'object', 'explanation must be object');
  return body.explanation as Record<string, unknown>;
}

// ── Suite FW-1: fallback, no focus ───────────────────────────────────────────

describe('FW-1: fallback no_match value types — method, candidateCount, topCandidates, rationale', () => {
  test('method=keyword, candidateCount===0, topCandidates=[], rationale is non-empty string', async () => {
    const coord = new NullRoutingCoordinator({}, { enabled: false });
    const agg = makeAgg(coord, false);
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: NO_MATCH_INTENT,
        explain: true,
        verbosity: 'full',
      });
      const ex = parseExplanation(result);
      assert.equal(ex.method, 'keyword', 'method must be "keyword" for fallback route');
      assert.equal(typeof ex.candidateCount, 'number', 'candidateCount must be a number');
      assert.equal(ex.candidateCount, 0, 'candidateCount must be 0 for no_match');
      assert.ok(Array.isArray(ex.topCandidates), 'topCandidates must be an array');
      assert.equal((ex.topCandidates as unknown[]).length, 0, 'topCandidates must be empty for no_match');
      assert.equal(typeof ex.rationale, 'string', 'rationale must be a string');
      assert.ok((ex.rationale as string).length > 0, 'rationale must be non-empty');
      // Focus fields must be absent
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'brainMs'), 'brainMs must be absent for fallback route');
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'focus'), 'focus must be absent without focus profile');
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'focusBoost'), 'focusBoost must be absent without focus profile');
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'winnerInFocus'), 'winnerInFocus must be absent without focus profile');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite FW-2: fallback, focus:code ─────────────────────────────────────────

describe('FW-2: fallback no_match focus:code value types — base fields + focus, focusBoost, winnerInFocus', () => {
  test('method=keyword, candidateCount===0, focus=code, focusBoost>0, winnerInFocus===false', async () => {
    const coord = new NullRoutingCoordinator({}, { enabled: false });
    const agg = makeAgg(coord, true);
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: NO_MATCH_INTENT,
        explain: true,
        verbosity: 'full',
      });
      const ex = parseExplanation(result);
      // Base fields
      assert.equal(ex.method, 'keyword', 'method must be "keyword" for fallback route');
      assert.equal(ex.candidateCount, 0, 'candidateCount must be 0 for no_match');
      assert.ok(Array.isArray(ex.topCandidates), 'topCandidates must be an array');
      assert.equal((ex.topCandidates as unknown[]).length, 0, 'topCandidates must be empty');
      assert.equal(typeof ex.rationale, 'string', 'rationale must be a string');
      assert.ok((ex.rationale as string).length > 0, 'rationale must be non-empty');
      // Focus fields (present at full verbosity)
      assert.equal(typeof ex.focus, 'string', 'focus must be a string');
      assert.equal(ex.focus, 'code', 'focus must be the active profile name');
      assert.equal(typeof ex.focusBoost, 'number', 'focusBoost must be a number');
      assert.ok(Number.isFinite(ex.focusBoost as number), 'focusBoost must be finite');
      assert.ok((ex.focusBoost as number) > 0, 'focusBoost must be > 0');
      assert.equal(typeof ex.winnerInFocus, 'boolean', 'winnerInFocus must be a boolean');
      assert.equal(ex.winnerInFocus, false, 'winnerInFocus must be false (no winner when candidateCount===0)');
      // brainMs must be absent (fallback route)
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'brainMs'), 'brainMs must be absent for fallback route');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite FW-3: brain route, no focus ────────────────────────────────────────

describe('FW-3: brain no_match value types — method=brain, brainMs>=0, base fields', () => {
  test('method=brain, brainMs is finite number >= 0, candidateCount===0, rationale is string', async () => {
    const coord = new BrainZeroConfidenceCoordinator({}, { enabled: false });
    const agg = makeAgg(coord, false);
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: NO_MATCH_INTENT,
        explain: true,
        verbosity: 'full',
      });
      const ex = parseExplanation(result);
      assert.equal(ex.method, 'brain', 'method must be "brain" for brain route');
      assert.equal(typeof ex.brainMs, 'number', 'brainMs must be a number');
      assert.ok(Number.isFinite(ex.brainMs as number), 'brainMs must be finite');
      assert.ok((ex.brainMs as number) >= 0, 'brainMs must be >= 0');
      assert.equal(ex.candidateCount, 0, 'candidateCount must be 0 for no_match');
      assert.ok(Array.isArray(ex.topCandidates), 'topCandidates must be an array');
      assert.equal((ex.topCandidates as unknown[]).length, 0, 'topCandidates must be empty');
      assert.equal(typeof ex.rationale, 'string', 'rationale must be a string');
      assert.ok((ex.rationale as string).length > 0, 'rationale must be non-empty');
      // Focus fields absent (no focus profile)
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'focus'), 'focus must be absent without focus profile');
      assert.ok(!Object.prototype.hasOwnProperty.call(ex, 'focusBoost'), 'focusBoost must be absent without focus profile');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite FW-4: brain route, focus:code ──────────────────────────────────────

describe('FW-4: brain no_match focus:code value types — brainMs + focus fields', () => {
  test('method=brain, brainMs>=0, focus=code, focusBoost>0, winnerInFocus===false', async () => {
    const coord = new BrainZeroConfidenceCoordinator({}, { enabled: false });
    const agg = makeAgg(coord, true);
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: NO_MATCH_INTENT,
        explain: true,
        verbosity: 'full',
      });
      const ex = parseExplanation(result);
      // Brain route marker
      assert.equal(ex.method, 'brain', 'method must be "brain" for brain route');
      assert.equal(typeof ex.brainMs, 'number', 'brainMs must be a number');
      assert.ok(Number.isFinite(ex.brainMs as number), 'brainMs must be finite');
      assert.ok((ex.brainMs as number) >= 0, 'brainMs must be >= 0');
      // Base fields
      assert.equal(ex.candidateCount, 0, 'candidateCount must be 0 for no_match');
      assert.ok(Array.isArray(ex.topCandidates), 'topCandidates must be an array');
      assert.equal((ex.topCandidates as unknown[]).length, 0, 'topCandidates must be empty');
      assert.equal(typeof ex.rationale, 'string', 'rationale must be a string');
      assert.ok((ex.rationale as string).length > 0, 'rationale must be non-empty');
      // Focus fields (present at full verbosity)
      assert.equal(typeof ex.focus, 'string', 'focus must be a string');
      assert.equal(ex.focus, 'code', 'focus must be the active profile name');
      assert.equal(typeof ex.focusBoost, 'number', 'focusBoost must be a number');
      assert.ok(Number.isFinite(ex.focusBoost as number), 'focusBoost must be finite');
      assert.ok((ex.focusBoost as number) > 0, 'focusBoost must be > 0');
      assert.equal(typeof ex.winnerInFocus, 'boolean', 'winnerInFocus must be a boolean');
      assert.equal(ex.winnerInFocus, false, 'winnerInFocus must be false when candidateCount===0');
    } finally {
      await agg.shutdown();
    }
  });
});
