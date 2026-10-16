/**
 * GGF drift guard: freeze cast explanation focusMargin field presence for
 * verbosity:'medium' with focus active.
 *
 * Background
 * ----------
 * When explain:true is set on cast with verbosity:'medium' and a focus profile
 * is active, buildCastExplanation() adds focusMargin inside the focus block
 * when topCandidates.length > 1 (src/aggregator.ts focusName&&focus block):
 *
 *   if (topCandidates.length > 1) {
 *     r.focusDecisive = ...
 *     r.focusMargin = best.score - topCandidates[1].score;
 *     const margin = best.score - topCandidates[1].score;
 *     if (margin !== 0) { r.focusConfidence = ...; }
 *   }
 *
 * GGB froze focusRank/focusRankDelta/focusConfidence in the same block.
 * GGA froze the broader medium-only focus field set. ES froze the complete
 * key sets for verbosity:medium with focus. No test specifically isolates
 * focusMargin presence (medium + focus + multi-candidate) vs absence in
 * verbosity:low, single-candidate, or no-focus scenarios.
 *
 * GGF closes that gap:
 *
 *   GGF-1  verbosity:'medium', 2-candidate, focus active → focusMargin PRESENT
 *          (guards against a regression that drops focusMargin from the focus
 *           block in the medium path while keeping other runner-up fields)
 *
 *   GGF-2  verbosity:'medium', 2-candidate, focus active → focusMargin is a
 *          finite non-negative number
 *          (type + range guard; focusMargin = winnerScore - runnerUpScore ≥ 0
 *           because the pool is sorted descending)
 *
 *   GGF-3  verbosity:'low', 2-candidate, focus active → focusMargin ABSENT
 *          (medium-only guard; verbosity:'low' builds a separate return value
 *           that never assigns r.focusMargin, so it must stay absent)
 *
 *   GGF-4  verbosity:'medium', 1-candidate, focus active → focusMargin ABSENT
 *          (no runner-up means the topCandidates.length>1 guard is false;
 *           focusMargin requires a runner-up to compute)
 *
 *   GGF-5  verbosity:'medium', 2-candidate, NO focus → focusMargin ABSENT
 *          (focus required; without a focus profile the focus block is skipped
 *           and focusMargin is never assigned)
 *
 * Fixture: single neon server (category:'code') + focus profile {code}.
 * Two-tool registry for GGF-1/2/3/5 (list_projects + get_project both score
 * on "list neon project"). One-tool registry for GGF-4 (topCandidates.length===1).
 * KeywordOnlyCoordinator disables the brain route for determinism.
 * confirm:true avoids any backend network call.
 * suggestionsCatalog:{} prevents disk-loaded focus-suggestions.json from
 * injecting additional candidates.
 *
 * Frozen 2026-10-03.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable — GGF freezes the
 *     PRESENCE of the existing focusMargin field in the medium-verbosity focus
 *     path; no new fields are added to buildCastExplanation
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
  return join(tmpdir(), `ch1tty-ggf-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

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

const FOCUS_PROFILES = {
  profiles: {
    code: { categories: ['code'] as string[], servers: [] as string[], boost: 0.5 },
  },
};

/** Two-tool registry — both tools score on "list neon project", topCandidates.length === 2. */
function makeTwoAgg(suffix: string): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', { tools: [TOOL_LIST_PROJECTS, TOOL_GET_PROJECT], prompts: [], resources: [] });
  const path = dlq();
  return new Aggregator([CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: {},
  });
}

/** Single-tool registry — topCandidates.length === 1, so runner-up/focus-margin absent. */
function makeOneAgg(suffix: string): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', { tools: [TOOL_LIST_PROJECTS], prompts: [], resources: [] });
  const path = dlq();
  return new Aggregator([CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: {},
  });
}

const INTENT = 'list neon project';

async function castVerbosity(
  agg: Aggregator,
  verbosity: 'low' | 'medium',
  opts: { focus?: string } = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', {
    intent: INTENT,
    confirm: true,
    explain: true,
    verbosity,
    ...(opts.focus !== undefined ? { focus: opts.focus } : {}),
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

// ── GGF-1: focusMargin PRESENT in medium + focus + 2 candidates ───────────────

test('GGF-1: verbosity:medium 2-candidate focus:code → focusMargin IS PRESENT', async () => {
  const agg = makeTwoAgg('ggf-1');
  try {
    const explanation = await castVerbosity(agg, 'medium', { focus: 'code' });
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'focusMargin'),
      true,
      `GGF-1: focusMargin must be present in verbosity:medium with 2 candidates and focus:code; got keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GGF-2: focusMargin is a finite non-negative number ────────────────────────

test('GGF-2: verbosity:medium 2-candidate focus:code → focusMargin is finite non-negative', async () => {
  const agg = makeTwoAgg('ggf-2');
  try {
    const explanation = await castVerbosity(agg, 'medium', { focus: 'code' });
    const fm = explanation['focusMargin'];
    assert.ok(
      typeof fm === 'number' && Number.isFinite(fm) && fm >= 0,
      `GGF-2: focusMargin must be a finite non-negative number (winnerScore - runnerUpScore ≥ 0); got ${JSON.stringify(fm)}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GGF-3: focusMargin ABSENT in verbosity:low (medium-only field) ─────────────

test('GGF-3: verbosity:low 2-candidate focus:code → focusMargin ABSENT', async () => {
  const agg = makeTwoAgg('ggf-3');
  try {
    const explanation = await castVerbosity(agg, 'low', { focus: 'code' });
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'focusMargin'),
      false,
      `GGF-3: focusMargin must be absent in verbosity:low (it is a medium-only field); got keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GGF-4: focusMargin ABSENT with 1 candidate in medium + focus ───────────────

test('GGF-4: verbosity:medium 1-candidate focus:code → focusMargin ABSENT', async () => {
  const agg = makeOneAgg('ggf-4');
  try {
    const explanation = await castVerbosity(agg, 'medium', { focus: 'code' });
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'focusMargin'),
      false,
      `GGF-4: focusMargin must be absent with 1 candidate (no runner-up); got keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GGF-5: focusMargin ABSENT in medium + 2 candidates + NO focus ─────────────

test('GGF-5: verbosity:medium 2-candidate no focus → focusMargin ABSENT', async () => {
  const agg = makeTwoAgg('ggf-5');
  try {
    const explanation = await castVerbosity(agg, 'medium');
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'focusMargin'),
      false,
      `GGF-5: focusMargin must be absent without an active focus profile; got keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
  } finally { await agg.shutdown(); }
});
