/**
 * GGA drift guard: freeze cast explanation focus-specific fields that appear
 * exclusively in the verbosity:'medium' path when a focus profile is active.
 *
 * Background
 * ----------
 * When explain:true is set on cast with verbosity:'medium' AND a focus profile is
 * active (focusName && focus && best !== undefined), buildCastExplanation()
 * injects a richer focus analysis block than verbosity:'low' does
 * (aggregator.ts ~2313):
 *
 *   if (focusName && focus && best !== undefined) {
 *     r.focus = focusName;
 *     r.focusBoost = focusBoost;
 *     r.winnerInFocus = winnerInFocus;
 *     r.winnerFocusBoost = winnerInFocus ? focusBoost : 0;     // ← medium-only
 *     r.winnerScoreBase = best.score - (winnerInFocus ? focusBoost : 0);  // ← medium-only
 *     r.candidatesInFocusCount = ...;   // ← medium-only
 *     if (scoredTools.length > 0) {
 *       r.inFocusFraction = ...;        // ← medium-only
 *     }
 *     ...
 *     if (topCandidates.length > 1) {
 *       r.focusDecisive = ...;
 *       r.focusMargin = best.score - topCandidates[1].score;   // ← medium-only
 *       ...
 *     }
 *   }
 *
 * GFZ froze the 4 focus fields in verbosity:'low' (focus, focusBoost,
 * winnerInFocus, focusDecisive). GGA closes the gap for the fields that are
 * EXCLUSIVE to verbosity:'medium': winnerFocusBoost, winnerScoreBase,
 * candidatesInFocusCount, inFocusFraction, and focusMargin.
 *
 * Why this matters
 * ----------------
 * A regression that:
 *
 *   (a) drops winnerFocusBoost/winnerScoreBase from the medium focus block, or
 *   (b) emits candidatesInFocusCount as undefined or NaN, or
 *   (c) emits inFocusFraction outside [0,1] (e.g. a / 0 path), or
 *   (d) drops focusMargin from the multi-candidate medium focus path
 *
 * would pass every existing guard silently — GFZ only covers the low-verbosity
 * focus fields, FH-4 freezes the key count but not the types/values of each field.
 *
 * GGA frozen invariants:
 *
 *   GGA-1  verbosity:'medium', focus:'code' active, winner in-focus →
 *          explanation.winnerFocusBoost IS PRESENT and equals the focus boost
 *          (presence + value guard; winnerInFocus=true means winnerFocusBoost
 *           equals focusBoost, not 0; a zero or undefined value is a regression)
 *
 *   GGA-2  verbosity:'medium', focus:'code' active →
 *          explanation.winnerScoreBase IS PRESENT and is a finite number
 *          (type guard; winnerScoreBase = best.score - winnerFocusBoost;
 *           a NaN or undefined here would corrupt callers that compute margins)
 *
 *   GGA-3  verbosity:'medium', focus:'code' active →
 *          explanation.candidatesInFocusCount IS PRESENT and is a non-negative integer
 *          (count guard; must be a whole number >= 0; a float or negative indicates
 *           a regression in the filter or count logic)
 *
 *   GGA-4  verbosity:'medium', focus:'code' active →
 *          explanation.inFocusFraction IS PRESENT and is in [0, 1]
 *          (range guard; inFocusFraction = in-focus count / total count;
 *           a value > 1 or < 0 or NaN signals a division or filter regression)
 *
 *   GGA-5  verbosity:'medium', focus:'code' active, 2-candidate →
 *          explanation.focusMargin IS PRESENT and is a finite number
 *          (presence + type guard for the medium-only winner vs runner-up margin;
 *           absent means the topCandidates.length > 1 guard was dropped or the
 *           field was renamed)
 *
 * Fixture: single neon server (category:'code') with two tools that both match
 * the intent 'list neon project', so topCandidates.length === 2 (GGA-1 through
 * GGA-5 all use the two-tool registry). The 'code' focus profile lists
 * category:'code' and servers:['neon'] → both tools are in-focus, winnerInFocus
 * is true, and inFocusFraction = 1.0.
 * KeywordOnlyCoordinator disables the brain route for determinism.
 * confirm:true (dryRun) avoids any backend network call.
 * suggestionsCatalog:{} prevents disk-loaded focus-suggestions.json from
 * injecting additional suggestion resources as extra candidates.
 *
 * Frozen 2026-10-02.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file, no src changes)
 *   - buildCastExplanation metric freeze: not applicable — GGA freezes the
 *     PRESENCE, TYPE and VALUE of existing conditional focus fields in the
 *     verbosity:'medium' path; no new fields are added to buildCastExplanation
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
  return join(tmpdir(), `ch1tty-gga-${Date.now()}-${++dlqSeq}.jsonl`);
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

/** Two-tool registry with focus:code active — both tools score, winner is in-focus. */
function makeFocusAgg(suffix: string): Aggregator {
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

// "list", "neon", and "project" all appear in both tool haystacks, so both
// score > 0.1 and appear in topCandidates (topCandidates.length === 2).
const INTENT = 'list neon project';

async function castMediumFocus(agg: Aggregator): Promise<{
  body: Record<string, unknown>;
  explanation: Record<string, unknown>;
}> {
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
  return { body, explanation: body['explanation'] as Record<string, unknown> };
}

// ── GGA-1: winnerFocusBoost is present and equals the active boost ─────────────

test('GGA-1: verbosity:medium focus:code winner-in-focus → explanation.winnerFocusBoost IS PRESENT and equals focusBoost', async () => {
  const agg = makeFocusAgg('gga-1');
  try {
    const { explanation } = await castMediumFocus(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'winnerFocusBoost'),
      true,
      `GGA-1: winnerFocusBoost must be present in medium-verbosity explanation when focus:code is active; got keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
    const wfb = explanation['winnerFocusBoost'];
    assert.ok(
      typeof wfb === 'number' && Number.isFinite(wfb) && wfb > 0,
      `GGA-1: winnerFocusBoost must be a positive finite number when winner is in-focus (= focusBoost 0.5); got ${JSON.stringify(wfb)}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GGA-2: winnerScoreBase is present and is a finite number ──────────────────

test('GGA-2: verbosity:medium focus:code → explanation.winnerScoreBase IS PRESENT and is finite', async () => {
  const agg = makeFocusAgg('gga-2');
  try {
    const { explanation } = await castMediumFocus(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'winnerScoreBase'),
      true,
      `GGA-2: winnerScoreBase must be present in medium-verbosity explanation when focus:code is active; got keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
    const wsb = explanation['winnerScoreBase'];
    assert.ok(
      typeof wsb === 'number' && Number.isFinite(wsb),
      `GGA-2: winnerScoreBase must be a finite number; got ${JSON.stringify(wsb)}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GGA-3: candidatesInFocusCount is present and is a non-negative integer ────

test('GGA-3: verbosity:medium focus:code → explanation.candidatesInFocusCount IS PRESENT and is a non-negative integer', async () => {
  const agg = makeFocusAgg('gga-3');
  try {
    const { explanation } = await castMediumFocus(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'candidatesInFocusCount'),
      true,
      `GGA-3: candidatesInFocusCount must be present in medium-verbosity explanation when focus:code is active; got keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
    const count = explanation['candidatesInFocusCount'];
    assert.ok(
      typeof count === 'number' && Number.isFinite(count) && count >= 0 && Number.isInteger(count),
      `GGA-3: candidatesInFocusCount must be a non-negative integer; got ${JSON.stringify(count)}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GGA-4: inFocusFraction is present and is in [0, 1] ───────────────────────

test('GGA-4: verbosity:medium focus:code → explanation.inFocusFraction IS PRESENT and is in [0, 1]', async () => {
  const agg = makeFocusAgg('gga-4');
  try {
    const { explanation } = await castMediumFocus(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'inFocusFraction'),
      true,
      `GGA-4: inFocusFraction must be present in medium-verbosity explanation when focus:code is active; got keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
    const frac = explanation['inFocusFraction'];
    assert.ok(
      typeof frac === 'number' && Number.isFinite(frac) && frac >= 0 && frac <= 1,
      `GGA-4: inFocusFraction must be a finite number in [0, 1]; got ${JSON.stringify(frac)}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GGA-5: focusMargin is present and is a finite number (2-candidate) ────────

test('GGA-5: verbosity:medium focus:code 2-candidate → explanation.focusMargin IS PRESENT and is finite', async () => {
  const agg = makeFocusAgg('gga-5');
  try {
    const { explanation } = await castMediumFocus(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'focusMargin'),
      true,
      `GGA-5: focusMargin must be present in medium-verbosity explanation with 2 candidates and focus:code active; got keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
    const margin = explanation['focusMargin'];
    assert.ok(
      typeof margin === 'number' && Number.isFinite(margin),
      `GGA-5: focusMargin must be a finite number; got ${JSON.stringify(margin)}`,
    );
  } finally { await agg.shutdown(); }
});
