/**
 * GGB drift guard: freeze cast explanation focusRank, focusRankDelta, and
 * focusConfidence PRESENCE for verbosity:'medium' when a focus profile is active.
 *
 * Background
 * ----------
 * When explain:true is set on cast with verbosity:'medium' AND a focus profile
 * is active, buildCastExplanation() conditionally emits three fields that GGA
 * did not cover:
 *
 *   1. focusRank / focusRankDelta  (aggregator.ts, verbosity:'medium' block):
 *
 *       if (focusRank !== undefined) {
 *         r.focusRank    = focusRank;
 *         r.focusRankDelta = focusRank - 1;
 *       }
 *
 *      focusRank is computed once before the verbosity branches as:
 *        preFocusSorted.findIndex(t => t.n === best.namespacedName) + 1
 *      (the 1-based position the winner would hold if the focus boost were
 *       stripped). It is undefined only when preFocusSorted is undefined —
 *       which happens only when no focus profile is active. With an active
 *       focus and a winner, focusRank is always defined.
 *
 *   2. focusConfidence  (verbosity:'medium' multi-candidate focus block):
 *
 *       if (topCandidates.length > 1) {
 *         ...
 *         const margin = best.score − topCandidates[1].score;
 *         if (margin !== 0) {
 *           r.focusConfidence = Math.min(1, (winnerInFocus ? focusBoost : 0) / margin);
 *         }
 *       }
 *
 *      Present when 2+ candidates exist AND the post-focus margin is non-zero.
 *      Math.min(1, ...) clamps it to [0, 1].
 *
 * GGA froze winnerFocusBoost/winnerScoreBase/candidatesInFocusCount/
 * inFocusFraction/focusMargin. GGB closes the remaining medium-focus gap
 * for focusRank, focusRankDelta, and focusConfidence.
 *
 * Why this matters
 * ----------------
 * A regression that:
 *
 *   (a) drops focusRank/focusRankDelta from the medium verbosity focus block
 *       (e.g. a copy-paste error that omits the `if (focusRank !== undefined)`
 *        guard in the medium path while keeping it in the full path), or
 *   (b) emits focusRankDelta as undefined or a non-integer, or
 *   (c) drops focusConfidence from the medium multi-candidate focus path
 *       (e.g. moves the `if (margin !== 0)` guard outside the focus block),
 *       or emits it outside [0, 1]
 *
 * would pass every existing explanation test silently. ES/EV freeze the field
 * NAMES and VALUE TYPES but do so via a bulk key-set or multi-field suite; GGB
 * provides targeted, isolated per-field presence guards that draw attention
 * directly to these three conditional fields.
 *
 * GGB frozen invariants:
 *
 *   GGB-1  verbosity:'medium', focus:'code' active, winner in-focus →
 *          explanation.focusRank IS PRESENT
 *          (presence guard; absent means the preFocusSorted computation was
 *           removed or the guard `if (focusRank !== undefined)` was dropped
 *           from the medium path)
 *
 *   GGB-2  verbosity:'medium', focus:'code' active, winner in-focus →
 *          explanation.focusRankDelta IS PRESENT
 *          (symmetric presence guard; focusRankDelta is emitted unconditionally
 *           alongside focusRank whenever focusRank is defined)
 *
 *   GGB-3  verbosity:'medium', focus:'code' active, winner in-focus →
 *          explanation.focusRankDelta === explanation.focusRank − 1
 *          (relational invariant; focusRankDelta is defined as focusRank − 1;
 *           a mismatch would indicate the formula was changed without updating
 *           both assignments atomically)
 *
 *   GGB-4  verbosity:'medium', focus:'code' active, 2-candidate, non-zero
 *          margin → explanation.focusConfidence IS PRESENT
 *          (presence guard for the conditional focusConfidence field; absent
 *           means the `if (margin !== 0)` block was removed or misplaced)
 *
 *   GGB-5  verbosity:'medium', focus:'code' active, 2-candidate, non-zero
 *          margin → explanation.focusConfidence ∈ [0, 1]
 *          (value range guard; Math.min(1, ...) must clamp the ratio to [0, 1];
 *           a value > 1 or NaN would indicate the clamp was removed or the
 *           dividend/divisor were swapped)
 *
 * Fixture: single neon server (category:'code') with two tools that both match
 * the intent 'list neon project', so topCandidates.length === 2. The 'code'
 * focus profile lists category:'code' and servers:['neon'] → both tools are
 * in-focus, winnerInFocus is true. Because the winner is promoted by the same
 * boost as the runner-up, winnerScore > runnerUpScore (the winner had a higher
 * keyword score pre-focus), so margin > 0 and focusConfidence is emitted.
 * KeywordOnlyCoordinator disables the brain route for determinism.
 * confirm:true (dryRun) avoids any backend network call.
 * suggestionsCatalog:{} prevents disk-loaded focus-suggestions.json from
 * injecting additional suggestion resources as extra candidates.
 *
 * Frozen 2026-10-02.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file, no src changes)
 *   - buildCastExplanation metric freeze: not applicable — GGB freezes the
 *     PRESENCE and relational invariants of existing conditional focus fields
 *     in the verbosity:'medium' path; no new fields are added to
 *     buildCastExplanation
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-ggb-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

const CODE_FOCUS_PROFILES = {
  profiles: {
    code: {
      description: 'Code and databases',
      categories: ['code' as const],
      servers: ['neon'],
      boost: 0.5,
    },
  },
};

const TOOL_LIST_PROJECTS = {
  name: 'list_projects',
  description: 'List all neon database projects for an account',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text' as const, text: '{"projects":[]}' }] },
};

const TOOL_GET_PROJECT = {
  name: 'get_project',
  description: 'Get details of a neon database project by id',
  inputSchema: { type: 'object', properties: { project_id: { type: 'string' } } },
  response: { content: [{ type: 'text' as const, text: '{"project":{}}' }] },
};

const CFG: ServerConfig = {
  id: 'neon',
  name: 'Neon DB',
  type: 'remote',
  access: 'readwrite',
  category: 'code',
  endpoint: 'https://neon.tech/mcp',
  lazy: true,
};

/** Two-tool neon registry with focus:code active — both tools in focus. */
function makeFocusAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', { tools: [TOOL_LIST_PROJECTS, TOOL_GET_PROJECT], prompts: [], resources: [] });
  const path = dlq();
  return new Aggregator([CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
    focusProfiles: CODE_FOCUS_PROFILES,
    focus: 'code',
    suggestionsCatalog: {},
  });
}

// Intent scores both tools: "list", "neon", "project" hit both haystacks.
const INTENT = 'list neon project';

async function castMediumFocus(agg: Aggregator): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', {
    intent: INTENT,
    confirm: true,
    explain: true,
    verbosity: 'medium',
  });
  const item = result.content[0];
  assert.ok(item && 'text' in item, 'content[0] must have text');
  const body = JSON.parse((item as { text: string }).text) as Record<string, unknown>;
  assert.ok(
    body['explanation'] !== null && typeof body['explanation'] === 'object' && !Array.isArray(body['explanation']),
    `explanation must be a non-null object, got ${JSON.stringify(body['explanation'])}`,
  );
  return body['explanation'] as Record<string, unknown>;
}

// ── GGB-1: focusRank IS PRESENT ───────────────────────────────────────────────

test('GGB-1: verbosity:medium focus:code winner-in-focus → explanation.focusRank IS PRESENT', async () => {
  const agg = makeFocusAgg();
  try {
    const explanation = await castMediumFocus(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'focusRank'),
      true,
      `GGB-1: focusRank must be present in medium-verbosity explanation when focus:code is active; ` +
      `got keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
    const rank = explanation['focusRank'];
    assert.ok(
      typeof rank === 'number' && Number.isFinite(rank) && rank >= 1 && Number.isInteger(rank),
      `GGB-1: focusRank must be a positive integer; got ${JSON.stringify(rank)}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GGB-2: focusRankDelta IS PRESENT ─────────────────────────────────────────

test('GGB-2: verbosity:medium focus:code winner-in-focus → explanation.focusRankDelta IS PRESENT', async () => {
  const agg = makeFocusAgg();
  try {
    const explanation = await castMediumFocus(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'focusRankDelta'),
      true,
      `GGB-2: focusRankDelta must be present in medium-verbosity explanation when focus:code is active; ` +
      `got keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
    const delta = explanation['focusRankDelta'];
    assert.ok(
      typeof delta === 'number' && Number.isFinite(delta) && delta >= 0 && Number.isInteger(delta),
      `GGB-2: focusRankDelta must be a non-negative integer; got ${JSON.stringify(delta)}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GGB-3: focusRankDelta === focusRank - 1 ───────────────────────────────────

test('GGB-3: verbosity:medium focus:code winner-in-focus → explanation.focusRankDelta === focusRank − 1', async () => {
  const agg = makeFocusAgg();
  try {
    const explanation = await castMediumFocus(agg);
    const rank = explanation['focusRank'];
    const delta = explanation['focusRankDelta'];
    assert.ok(
      typeof rank === 'number' && typeof delta === 'number',
      `GGB-3: both focusRank and focusRankDelta must be numbers; got focusRank=${JSON.stringify(rank)}, focusRankDelta=${JSON.stringify(delta)}`,
    );
    assert.equal(
      delta,
      (rank as number) - 1,
      `GGB-3: focusRankDelta must equal focusRank − 1 (${(rank as number) - 1}); ` +
      `got focusRank=${rank}, focusRankDelta=${delta}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GGB-4: focusConfidence IS PRESENT (non-zero margin) ──────────────────────

test('GGB-4: verbosity:medium focus:code 2-candidate non-zero-margin → explanation.focusConfidence IS PRESENT', async () => {
  const agg = makeFocusAgg();
  try {
    const explanation = await castMediumFocus(agg);
    // Verify 2-candidate precondition via topCandidates length
    const topCandidates = explanation['topCandidates'];
    assert.ok(
      Array.isArray(topCandidates) && topCandidates.length >= 2,
      `GGB-4: fixture must produce ≥2 candidates; got topCandidates.length=${Array.isArray(topCandidates) ? topCandidates.length : 'non-array'}`,
    );
    // Verify non-zero margin precondition
    const margin = explanation['focusMargin'];
    assert.ok(
      typeof margin === 'number' && margin > 0,
      `GGB-4: fixture must produce a non-zero focusMargin for focusConfidence to appear; got focusMargin=${JSON.stringify(margin)}`,
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'focusConfidence'),
      true,
      `GGB-4: focusConfidence must be present when 2 candidates exist and focusMargin > 0; ` +
      `got keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GGB-5: focusConfidence ∈ [0, 1] ──────────────────────────────────────────

test('GGB-5: verbosity:medium focus:code 2-candidate → explanation.focusConfidence ∈ [0, 1]', async () => {
  const agg = makeFocusAgg();
  try {
    const explanation = await castMediumFocus(agg);
    const fc = explanation['focusConfidence'];
    assert.ok(
      typeof fc === 'number' && Number.isFinite(fc) && fc >= 0 && fc <= 1,
      `GGB-5: focusConfidence must be a finite number in [0, 1] (Math.min(1, boost/margin)); ` +
      `got ${JSON.stringify(fc)}`,
    );
  } finally { await agg.shutdown(); }
});
