/**
 * GGD drift guard: freeze ABSENCE of medium-only fields from verbosity:'low'
 * cast explanation when a focus profile is active.
 *
 * Background
 * ----------
 * buildCastExplanation() has three verbosity paths: 'low', 'medium', and 'full'.
 * The following fields appear in the 'medium' (and 'full') focus-active block
 * but are intentionally absent from the 'low' path:
 *
 *   unfocusedWinner   – conditional: present only when focus changed the winner
 *   focusRank         – present when focus active + winner exists
 *   focusRankDelta    – present whenever focusRank is present
 *   focusMargin       – present when focus active + 2+ candidates
 *   focusConfidence   – conditional: present when focusMargin ≠ 0
 *
 * The 'low' verbosity path (lines 2261-2288 of src-stdio/aggregator.ts) emits
 * only: method, candidateCount, topCandidates, rationale, winnerScore,
 * winnerServer, runnerUpScore, runnerUpTool, focus, focusBoost, winnerInFocus,
 * focusDecisive.  No other focus fields are included.
 *
 * Why this matters
 * ----------------
 * A regression that accidentally emits medium-only focus fields in the low path
 * would violate the verbosity contract ("low" is 9-10 essential fields, not 20+),
 * widen the context cost for callers who specifically opted into low verbosity to
 * keep their context budget small, and break any downstream code that relies on
 * the field set being bounded.  Because the absence is structural (a missing code
 * branch) rather than a value check, no existing presence test catches it — only
 * an explicit absence guard does.
 *
 * Using INTENT_CROSS from GGC (which causes focus to change the winner) ensures
 * the MOST PERMISSIVE possible condition: even when unfocusedWinner/focusRank/
 * etc. would be emitted in medium, they must still be absent in low.  An absence
 * guard on a scenario where the field would not appear in medium anyway would be
 * vacuous — GGD is deliberately adversarial.
 *
 * GGD frozen invariants:
 *
 *   GGD-1  verbosity:'low', focus:'code' active, focus changes winner →
 *          explanation.unfocusedWinner IS ABSENT
 *          (medium-only field must not appear in the low path even when
 *           the preFocusSorted[0].n !== best.namespacedName condition holds)
 *
 *   GGD-2  verbosity:'low', focus:'code' active, focus changes winner →
 *          explanation.focusRank IS ABSENT
 *          (medium-only field must not appear in the low path even when
 *           focusRank would be defined — winner's pre-focus position — for medium)
 *
 *   GGD-3  verbosity:'low', focus:'code' active, focus changes winner →
 *          explanation.focusRankDelta IS ABSENT
 *          (always present alongside focusRank in medium; must not leak into low)
 *
 *   GGD-4  verbosity:'low', focus:'code' active, 2+ candidates →
 *          explanation.focusMargin IS ABSENT
 *          (present in medium when topCandidates.length > 1; must not leak)
 *
 *   GGD-5  verbosity:'low', focus:'code' active, 2+ candidates, margin ≠ 0 →
 *          explanation.focusConfidence IS ABSENT
 *          (conditionally present in medium when margin ≠ 0; must not leak)
 *
 * Fixture reuses the GGC cross-category neon/stripe setup.
 *
 * Scoring derivation (same as GGC INTENT_CROSS)
 * -----------------------------------------------
 * INTENT_CROSS = 'list all payment projects' (4 terms: list/all/payment/projects)
 *   stripe/list_payment_projects — all 4 terms hit; no nameBonus → score 1.0
 *   neon/list_projects — list/all/projects hit, NOT payment; no nameBonus → 0.75
 *   Pre-focus: stripe > neon (1.0 > 0.75)
 *   Post-focus neon: 0.75 + boost(0.5) = 1.25 > 1.0 → neon wins
 *   ∴ focus changed the winner → unfocusedWinner/focusRank conditions are met
 *     for medium; they must still be absent at low.
 *
 * Frozen 2026-10-02.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file, no src changes)
 *   - buildCastExplanation metric freeze: not applicable — GGD freezes the
 *     ABSENCE of existing medium-only fields from the verbosity:'low' path;
 *     no new fields are added to buildCastExplanation
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
  return join(tmpdir(), `ch1tty-ggd-${Date.now()}-${++dlqSeq}.jsonl`);
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

const NEON_CFG: ServerConfig = {
  id: 'neon',
  name: 'Neon DB',
  type: 'remote',
  access: 'readwrite',
  category: 'code',
  endpoint: 'https://neon.tech/mcp',
  lazy: true,
};

const STRIPE_CFG: ServerConfig = {
  id: 'stripe',
  name: 'Stripe Payments',
  type: 'remote',
  access: 'read',
  category: 'finance',
  endpoint: 'https://stripe.com/mcp',
  lazy: true,
};

const TOOL_NEON_LIST_PROJECTS = {
  name: 'list_projects',
  description: 'List all neon database projects for an account',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text' as const, text: '{"projects":[]}' }] },
};

const TOOL_STRIPE_LIST_PAYMENT_PROJECTS = {
  name: 'list_payment_projects',
  description: 'List all payment projects from Stripe accounts',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text' as const, text: '{"projects":[]}' }] },
};

// INTENT_CROSS: focus changes winner (neon beats stripe after boost).
// This is the most adversarial setup — the conditions for unfocusedWinner,
// focusRank, etc. to appear in medium are ALL satisfied; they must still
// be absent in low.
const INTENT_CROSS = 'list all payment projects';

function makeCrossAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', { tools: [TOOL_NEON_LIST_PROJECTS], prompts: [], resources: [] });
  backend.defineServer('stripe', { tools: [TOOL_STRIPE_LIST_PAYMENT_PROJECTS], prompts: [], resources: [] });
  const path = dlq();
  return new Aggregator([NEON_CFG, STRIPE_CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
    focusProfiles: CODE_FOCUS_PROFILES,
    focus: 'code',
    suggestionsCatalog: {},
  });
}

async function castLow(agg: Aggregator): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', {
    intent: INTENT_CROSS,
    confirm: true,
    explain: true,
    verbosity: 'low',
  });
  const item = result.content[0];
  assert.ok(item && 'text' in item, 'content[0] must have text');
  const body = JSON.parse((item as { text: string }).text) as Record<string, unknown>;
  assert.ok(
    body['explanation'] !== null && typeof body['explanation'] === 'object' && !Array.isArray(body['explanation']),
    `explanation must be a non-null object; got ${JSON.stringify(body['explanation'])}`,
  );
  return body['explanation'] as Record<string, unknown>;
}

// ── GGD-1: unfocusedWinner IS ABSENT in verbosity:low ─────────────────────────

test('GGD-1: verbosity:low focus:code cross-category → explanation.unfocusedWinner IS ABSENT (medium-only field must not leak into low path)', async () => {
  const agg = makeCrossAgg();
  try {
    const explanation = await castLow(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'unfocusedWinner'),
      false,
      `GGD-1: unfocusedWinner must be absent in verbosity:low explanation even when focus changes ` +
      `the winner (it is a medium-only field); ` +
      `got unfocusedWinner=${JSON.stringify(explanation['unfocusedWinner'])}, ` +
      `keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GGD-2: focusRank IS ABSENT in verbosity:low ───────────────────────────────

test('GGD-2: verbosity:low focus:code cross-category → explanation.focusRank IS ABSENT (medium-only field must not leak into low path)', async () => {
  const agg = makeCrossAgg();
  try {
    const explanation = await castLow(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'focusRank'),
      false,
      `GGD-2: focusRank must be absent in verbosity:low explanation even when focus is active and ` +
      `a winner exists (it is a medium-only field); ` +
      `got focusRank=${JSON.stringify(explanation['focusRank'])}, ` +
      `keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GGD-3: focusRankDelta IS ABSENT in verbosity:low ──────────────────────────

test('GGD-3: verbosity:low focus:code cross-category → explanation.focusRankDelta IS ABSENT (medium-only field must not leak into low path)', async () => {
  const agg = makeCrossAgg();
  try {
    const explanation = await castLow(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'focusRankDelta'),
      false,
      `GGD-3: focusRankDelta must be absent in verbosity:low explanation even when focus is active ` +
      `and a winner exists (it is emitted alongside focusRank, which is medium-only); ` +
      `got focusRankDelta=${JSON.stringify(explanation['focusRankDelta'])}, ` +
      `keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GGD-4: focusMargin IS ABSENT in verbosity:low ─────────────────────────────

test('GGD-4: verbosity:low focus:code cross-category 2+ candidates → explanation.focusMargin IS ABSENT (medium-only field must not leak into low path)', async () => {
  const agg = makeCrossAgg();
  try {
    const explanation = await castLow(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'focusMargin'),
      false,
      `GGD-4: focusMargin must be absent in verbosity:low explanation even when focus is active ` +
      `and 2+ candidates exist (it is a medium-only field); ` +
      `got focusMargin=${JSON.stringify(explanation['focusMargin'])}, ` +
      `keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GGD-5: focusConfidence IS ABSENT in verbosity:low ─────────────────────────

test('GGD-5: verbosity:low focus:code cross-category 2+ candidates margin≠0 → explanation.focusConfidence IS ABSENT (medium-only field must not leak into low path)', async () => {
  const agg = makeCrossAgg();
  try {
    const explanation = await castLow(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'focusConfidence'),
      false,
      `GGD-5: focusConfidence must be absent in verbosity:low explanation even when focus is active, ` +
      `2+ candidates exist, and margin ≠ 0 (conditions that emit focusConfidence in medium); ` +
      `it is a medium-only field; ` +
      `got focusConfidence=${JSON.stringify(explanation['focusConfidence'])}, ` +
      `keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
  } finally { await agg.shutdown(); }
});
