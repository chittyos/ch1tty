/**
 * GFZ drift guard: freeze cast explanation focus-specific fields present in the
 * verbosity:'low' path when a focus profile is active.
 *
 * Background
 * ----------
 * When explain:true is set on cast with verbosity:'low' AND a focus profile is
 * active (focusName && focus && best !== undefined), buildCastExplanation()
 * injects four additional fields into the low-verbosity result object
 * (aggregator.ts ~2277):
 *
 *   if (focusName && focus && best !== undefined) {
 *     r.focus = focusName;
 *     r.focusBoost = focusBoost;
 *     r.winnerInFocus = winnerInFocus;
 *     if (topCandidates.length > 1) {
 *       r.focusDecisive = (best.score - (winnerInFocus ? focusBoost : 0)) < topCandidates[1].score;
 *     }
 *   }
 *
 * GFV froze the 6-key structure for verbosity:'low' without a focus active.
 * GFW/GFX/GFY froze runner-up fields in medium and low verbosity.
 * No test freezes the PRESENCE of focus-specific fields in the low-verbosity
 * path when a focus is active (GFZ closes this gap).
 *
 * Why this matters
 * ----------------
 * A regression that:
 *
 *   (a) drops the focus block entirely from the low-verbosity path, or
 *   (b) changes r.focus to a boolean/undefined instead of the profile name, or
 *   (c) emits winnerInFocus as a non-boolean, or
 *   (d) drops focusDecisive from the 2-candidate focus path in low verbosity
 *
 * would pass every existing explanation test silently — GFV covers the no-focus
 * path, GFW/GFX/GFY cover runner-up fields, but none freeze focus-active fields
 * at verbosity:'low'.
 *
 * GFZ frozen invariants:
 *
 *   GFZ-1  verbosity:'low', focus:'code' active, best exists →
 *          explanation.focus IS PRESENT and equals 'code'
 *          (guards against the focus block being dropped, and against the value
 *           being coerced to a boolean or integer)
 *
 *   GFZ-2  verbosity:'low', focus:'code' active, best exists →
 *          explanation.focusBoost IS PRESENT and is a finite non-negative number
 *          (type + range guard for the additive scoring boost value)
 *
 *   GFZ-3  verbosity:'low', focus:'code' active, best exists →
 *          explanation.winnerInFocus IS PRESENT and is a boolean
 *          (type guard; winnerInFocus encodes whether the winner is in the active
 *           focus set; a regression that emits a number or string breaks callers
 *           that branch on it)
 *
 *   GFZ-4  verbosity:'low', focus:'code' active, 2-candidate →
 *          explanation.focusDecisive IS PRESENT and is a boolean
 *          (guards the focusDecisive conditional; topCandidates.length > 1 is
 *           required; with a single candidate focusDecisive is intentionally absent)
 *
 *   GFZ-5  verbosity:'low', NO focus active →
 *          explanation.focus IS ABSENT
 *          (symmetric absence guard; confirms the focus block is conditionally
 *           gated and does not leak into no-focus paths)
 *
 * Fixture: single neon server with category 'code' and two tools that both
 * match the intent 'list neon project', so topCandidates.length === 2 for GFZ-4.
 * The 'code' focus profile lists category:'code' → neon is in-focus, so the
 * focus block fires and winnerInFocus is true.
 * KeywordOnlyCoordinator disables the brain route for determinism.
 * confirm:true (dryRun) avoids any backend network call.
 * suggestionsCatalog:{} prevents disk-loaded focus-suggestions.json from
 * injecting additional suggestion resources as extra candidates.
 * GFZ-5 reuses the same two-tool registry but with no focus option set.
 *
 * Frozen 2026-10-02.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable — GFZ freezes the
 *     PRESENCE and TYPE of existing conditional focus fields in the
 *     verbosity:'low' path; no new fields are added to buildCastExplanation
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
  return join(tmpdir(), `ch1tty-gfz-${Date.now()}-${++dlqSeq}.jsonl`);
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

/** Two-tool registry with NO focus active — baseline for absence guard. */
function makeNoFocusAgg(suffix: string): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', { tools: [TOOL_LIST_PROJECTS, TOOL_GET_PROJECT], prompts: [], resources: [] });
  const path = dlq();
  return new Aggregator([CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
    focusProfiles: CODE_FOCUS_PROFILES,
    suggestionsCatalog: {},
  });
}

// "list", "neon", and "project" all appear in both tool haystacks, so both
// score > 0.1 and appear in topCandidates (topCandidates.length === 2).
const INTENT = 'list neon project';

async function castLowFocus(agg: Aggregator): Promise<{
  body: Record<string, unknown>;
  explanation: Record<string, unknown>;
}> {
  const result = await agg.callTool('ch1tty/cast', {
    intent: INTENT,
    confirm: true,
    explain: true,
    verbosity: 'low',
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

// ── GFZ-1: explanation.focus is present and equals the active focus name ────────

test('GFZ-1: verbosity:low focus:code → explanation.focus IS PRESENT and equals "code"', async () => {
  const agg = makeFocusAgg('gfz-1');
  try {
    const { explanation } = await castLowFocus(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'focus'),
      true,
      `GFZ-1: focus must be present in low-verbosity explanation when focus profile is active; got keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
    assert.equal(
      explanation['focus'],
      'code',
      `GFZ-1: focus must equal the active profile name 'code'; got ${JSON.stringify(explanation['focus'])}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFZ-2: explanation.focusBoost is present and is a finite non-negative number

test('GFZ-2: verbosity:low focus:code → explanation.focusBoost IS PRESENT and is non-negative', async () => {
  const agg = makeFocusAgg('gfz-2');
  try {
    const { explanation } = await castLowFocus(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'focusBoost'),
      true,
      `GFZ-2: focusBoost must be present in low-verbosity explanation when focus is active; got keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
    const fb = explanation['focusBoost'];
    assert.ok(
      typeof fb === 'number' && Number.isFinite(fb) && fb >= 0,
      `GFZ-2: focusBoost must be a finite non-negative number; got ${JSON.stringify(fb)}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFZ-3: explanation.winnerInFocus is present and is a boolean ──────────────

test('GFZ-3: verbosity:low focus:code → explanation.winnerInFocus IS PRESENT and is boolean', async () => {
  const agg = makeFocusAgg('gfz-3');
  try {
    const { explanation } = await castLowFocus(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'winnerInFocus'),
      true,
      `GFZ-3: winnerInFocus must be present in low-verbosity explanation when focus is active; got keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
    assert.equal(
      typeof explanation['winnerInFocus'],
      'boolean',
      `GFZ-3: winnerInFocus must be a boolean; got ${typeof explanation['winnerInFocus']} (${JSON.stringify(explanation['winnerInFocus'])})`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFZ-4: explanation.focusDecisive is present and is a boolean (2-candidate) ─

test('GFZ-4: verbosity:low focus:code 2-candidate → explanation.focusDecisive IS PRESENT and is boolean', async () => {
  const agg = makeFocusAgg('gfz-4');
  try {
    const { explanation } = await castLowFocus(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'focusDecisive'),
      true,
      `GFZ-4: focusDecisive must be present in low-verbosity explanation when focus active and topCandidates.length > 1; got keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
    assert.equal(
      typeof explanation['focusDecisive'],
      'boolean',
      `GFZ-4: focusDecisive must be a boolean; got ${typeof explanation['focusDecisive']} (${JSON.stringify(explanation['focusDecisive'])})`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFZ-5: explanation.focus IS ABSENT when no focus is active ────────────────

test('GFZ-5: verbosity:low NO focus → explanation.focus IS ABSENT', async () => {
  const agg = makeNoFocusAgg('gfz-5');
  try {
    const { explanation } = await castLowFocus(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'focus'),
      false,
      `GFZ-5: focus must be absent in low-verbosity explanation when no focus profile is active; got explanation=${JSON.stringify(explanation)}`,
    );
  } finally { await agg.shutdown(); }
});
