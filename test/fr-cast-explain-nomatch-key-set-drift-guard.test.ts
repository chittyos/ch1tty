/**
 * FR: Drift guard — cast explain exact key set on no_match responses.
 *
 * EU (eu-cast-explain-value-types-low-medium.test.ts) freezes the VALUE TYPES
 * of the 4 fields present at no_match for verbosity:low/medium. EV freezes
 * value types at verbosity:full. Neither test freezes the EXACT KEY SET via
 * deepEqual — a field addition would increase the count (caught by ZZZZ only
 * for full verbosity, not for no_match specifically) while a name swap (remove
 * one expected field, add a new one, net count unchanged) would pass silently.
 *
 * Key sets frozen 2026-09-20 (probed with neon+stripe+tasks FixtureBackend,
 * NullRoutingCoordinator, intent = garbage string that matches no tools):
 *
 *   no_match, verbosity:low,    no focus → 4 keys
 *   no_match, verbosity:medium, no focus → 4 keys  (same)
 *   no_match, verbosity:full,   no focus → 4 keys  (same)
 *   no_match, verbosity:low,    focus:code → 4 keys (focus fields absent)
 *   no_match, verbosity:medium, focus:code → 4 keys (focus fields absent)
 *   no_match, verbosity:full,   focus:code → 7 keys (adds focus, focusBoost, winnerInFocus)
 *
 * The verbosity:full + focus asymmetry is intentional: the aggregator emits
 * the active focus name and its boost value even when no tool matched, so
 * callers can distinguish "focus was active but found nothing" from "no focus
 * active at all". winnerInFocus is false (no winner to be in focus).
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only change)
 *   - buildCastExplanation metric freeze: no new fields; freezes existing set
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
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// NullRoutingCoordinator prevents OllamaBrain routing so garbage intents
// always produce no_match deterministically.
class NullRoutingCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
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
  return join(tmpdir(), `ch1tty-fr-${Date.now()}-${++dlqSeq}.jsonl`);
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
    coordinator: new NullRoutingCoordinator({}, { enabled: false }),
  };
  if (withFocus) {
    opts.focusProfiles = FOCUS_PROFILES;
    opts.focus = 'code';
  }
  return new Aggregator(CONFIGS, opts);
}

const NO_MATCH_INTENT = 'zzzzzz_fr_guard_definitely_no_match_xxxxxxxxx_12345';

/** 4-key set common to all no_match responses (no focus, or low/medium verbosity with focus). */
const BASE_NO_MATCH_KEYS = ['candidateCount', 'method', 'rationale', 'topCandidates'];

/** 7-key set for verbosity:full + focus:code no_match (adds 3 focus-context keys). */
const FULL_FOCUS_NO_MATCH_KEYS = [
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

// ── Suite FR-1: verbosity:low, no focus ──────────────────────────────────────

describe('FR-1: verbosity:low no-focus no_match — exact 4-key set', () => {
  test('explain key set is exactly 4 keys', async () => {
    const agg = makeAgg(false);
    try {
      const keys = await getExplainKeys(agg, 'low');
      assert.deepEqual(
        keys,
        [...BASE_NO_MATCH_KEYS].sort(),
        `verbosity:low no-focus no_match explain key set must equal ${JSON.stringify(BASE_NO_MATCH_KEYS)}`,
      );
    } finally { await agg.shutdown(); }
  });
});

// ── Suite FR-2: verbosity:medium, no focus ───────────────────────────────────

describe('FR-2: verbosity:medium no-focus no_match — exact 4-key set', () => {
  test('explain key set is exactly 4 keys', async () => {
    const agg = makeAgg(false);
    try {
      const keys = await getExplainKeys(agg, 'medium');
      assert.deepEqual(
        keys,
        [...BASE_NO_MATCH_KEYS].sort(),
        `verbosity:medium no-focus no_match explain key set must equal ${JSON.stringify(BASE_NO_MATCH_KEYS)}`,
      );
    } finally { await agg.shutdown(); }
  });
});

// ── Suite FR-3: verbosity:full, no focus ─────────────────────────────────────

describe('FR-3: verbosity:full no-focus no_match — exact 4-key set', () => {
  test('explain key set is exactly 4 keys', async () => {
    const agg = makeAgg(false);
    try {
      const keys = await getExplainKeys(agg, 'full');
      assert.deepEqual(
        keys,
        [...BASE_NO_MATCH_KEYS].sort(),
        `verbosity:full no-focus no_match explain key set must equal ${JSON.stringify(BASE_NO_MATCH_KEYS)}`,
      );
    } finally { await agg.shutdown(); }
  });
});

// ── Suite FR-4: verbosity:low, focus:code ────────────────────────────────────
// Focus fields must be ABSENT at low verbosity even when focus is active.

describe('FR-4: verbosity:low focus:code no_match — same 4-key set (focus fields absent)', () => {
  test('explain key set is exactly 4 keys (focus context not emitted at low verbosity)', async () => {
    const agg = makeAgg(true);
    try {
      const keys = await getExplainKeys(agg, 'low', 'code');
      assert.deepEqual(
        keys,
        [...BASE_NO_MATCH_KEYS].sort(),
        'verbosity:low focus:code no_match must have same 4 keys as no-focus case (focus fields absent at low verbosity)',
      );
    } finally { await agg.shutdown(); }
  });
});

// ── Suite FR-5: verbosity:medium, focus:code ─────────────────────────────────

describe('FR-5: verbosity:medium focus:code no_match — same 4-key set (focus fields absent)', () => {
  test('explain key set is exactly 4 keys (focus context not emitted at medium verbosity)', async () => {
    const agg = makeAgg(true);
    try {
      const keys = await getExplainKeys(agg, 'medium', 'code');
      assert.deepEqual(
        keys,
        [...BASE_NO_MATCH_KEYS].sort(),
        'verbosity:medium focus:code no_match must have same 4 keys as no-focus case (focus fields absent at medium verbosity)',
      );
    } finally { await agg.shutdown(); }
  });
});

// ── Suite FR-6: verbosity:full, focus:code ───────────────────────────────────
// The aggregator emits focus context at full verbosity even on no_match:
//   focus      → active profile name ('code')
//   focusBoost → configured boost value (> 0)
//   winnerInFocus → false (no winner to be in focus)
// This lets callers distinguish "focus active but no match" from "no focus active".

describe('FR-6: verbosity:full focus:code no_match — exact 7-key set', () => {
  test('explain key set is exactly 7 keys (3 focus-context keys present)', async () => {
    const agg = makeAgg(true);
    try {
      const keys = await getExplainKeys(agg, 'full', 'code');
      assert.deepEqual(
        keys,
        [...FULL_FOCUS_NO_MATCH_KEYS].sort(),
        `verbosity:full focus:code no_match explain key set must equal ${JSON.stringify(FULL_FOCUS_NO_MATCH_KEYS)}`,
      );
    } finally { await agg.shutdown(); }
  });

  test('focus is the active profile name, focusBoost is number > 0, winnerInFocus is false', async () => {
    const agg = makeAgg(true);
    try {
      const agg2 = makeAgg(true);
      await agg.shutdown();
      const keys = await getExplainKeys(agg2, 'full', 'code');
      assert.ok(keys.includes('focus'), 'focus key must be present');
      assert.ok(keys.includes('focusBoost'), 'focusBoost key must be present');
      assert.ok(keys.includes('winnerInFocus'), 'winnerInFocus key must be present');

      // Also validate the values of the 3 focus-context fields.
      const result2 = await agg2.callTool('ch1tty/cast', {
        intent: NO_MATCH_INTENT, explain: true, verbosity: 'full', focus: 'code',
      });
      const body2 = JSON.parse((result2.content[0] as { text: string }).text) as Record<string, unknown>;
      const exp2 = body2['explanation'] as Record<string, unknown>;
      assert.equal(exp2['focus'], 'code', 'focus must equal active profile name');
      assert.equal(typeof exp2['focusBoost'], 'number', 'focusBoost must be number');
      assert.ok((exp2['focusBoost'] as number) > 0, 'focusBoost must be > 0 (configured boost)');
      assert.equal(exp2['winnerInFocus'], false, 'winnerInFocus must be false (no winner on no_match)');
      await agg2.shutdown();
    } finally {
      // agg already shut down above; this is a no-op guard.
      try { await agg.shutdown(); } catch {}
    }
  });
});
