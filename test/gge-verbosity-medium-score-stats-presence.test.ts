/**
 * GGE drift guard: freeze cast explanation candidateScoreSpread/candidateScoreMean
 * presence/absence for verbosity:'medium' with two-candidate vs one-candidate registry.
 *
 * Background
 * ----------
 * When explain:true is set on cast with verbosity:'medium', buildCastExplanation()
 * (aggregator.ts ~2288) adds score-distribution fields when scoredTools.length >= 2:
 *
 *   if (scoredTools.length >= 2) {
 *     r.candidateScoreSpread = scoredTools[0].score - scoredTools[last].score;
 *     r.candidateScoreMean   = scoredTools.reduce((s,t) => s+t.score, 0) / scoredTools.length;
 *     if (medianCandidateScore !== undefined) r.medianCandidateScore = medianCandidateScore;
 *     if (candidateScoreStdDev !== undefined) r.candidateScoreStdDev = candidateScoreStdDev;
 *   }
 *
 * GFW froze runner-up field presence/absence in the medium-verbosity path.
 * GFX froze runnerUpServer/runnerUpCategory.
 * No test freezes the score-stats (spread/mean) fields in the medium path.
 *
 * Why this matters
 * ----------------
 * A regression that:
 *
 *   (a) drops candidateScoreSpread/candidateScoreMean from medium verbosity
 *       with 2+ candidates, or
 *   (b) changes the spread formula sign (e.g. lowest - highest), or
 *   (c) emits these fields even in the 1-candidate path (where they must be absent)
 *
 * would pass every existing explanation test silently — all other guards either
 * use full verbosity or don't check these specific fields.
 *
 * GGE closes those gaps:
 *
 *   GGE-1  verbosity:'medium', 2-candidate → candidateScoreSpread IS PRESENT
 *   GGE-2  verbosity:'medium', 2-candidate → candidateScoreMean IS PRESENT
 *   GGE-3  verbosity:'medium', 2-candidate → candidateScoreSpread is a finite
 *          non-negative number (winner.score >= lowestScore, so spread >= 0)
 *   GGE-4  verbosity:'medium', 1-candidate → candidateScoreSpread ABSENT
 *   GGE-5  verbosity:'medium', 1-candidate → candidateScoreMean ABSENT
 *
 * Fixture: same two-tool neon backend as GFW.
 * Frozen 2026-10-02.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable — GGE freezes the
 *     PRESENCE of existing conditional fields in the medium-verbosity path;
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
  return join(tmpdir(), `ch1tty-gge-${Date.now()}-${++dlqSeq}.jsonl`);
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

/** Two-tool registry — both tools score with INTENT, so scoredTools.length === 2. */
function makeTwoAgg(suffix: string): Aggregator {
  void suffix;
  const backend = new FixtureBackend();
  backend.defineServer('neon', { tools: [TOOL_LIST_PROJECTS, TOOL_GET_PROJECT], prompts: [], resources: [] });
  const path = dlq();
  return new Aggregator([CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
    suggestionsCatalog: {},
  });
}

/** Single-tool registry — scoredTools.length === 1, so score-stats fields are absent. */
function makeOneAgg(suffix: string): Aggregator {
  void suffix;
  const backend = new FixtureBackend();
  backend.defineServer('neon', { tools: [TOOL_LIST_PROJECTS], prompts: [], resources: [] });
  const path = dlq();
  return new Aggregator([CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
    suggestionsCatalog: {},
  });
}

const INTENT = 'list neon project';

async function castMediumVerbosity(agg: Aggregator): Promise<{
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

// ── GGE-1: candidateScoreSpread present with 2 candidates ────────────────────

test('GGE-1: verbosity:medium 2-candidate → explanation.candidateScoreSpread IS PRESENT', async () => {
  const agg = makeTwoAgg('gge-1');
  try {
    const { explanation } = await castMediumVerbosity(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'candidateScoreSpread'),
      true,
      `GGE-1: candidateScoreSpread must be present with 2 candidates in medium verbosity; got keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GGE-2: candidateScoreMean present with 2 candidates ──────────────────────

test('GGE-2: verbosity:medium 2-candidate → explanation.candidateScoreMean IS PRESENT', async () => {
  const agg = makeTwoAgg('gge-2');
  try {
    const { explanation } = await castMediumVerbosity(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'candidateScoreMean'),
      true,
      `GGE-2: candidateScoreMean must be present with 2 candidates in medium verbosity; got keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GGE-3: candidateScoreSpread is finite non-negative ───────────────────────

test('GGE-3: verbosity:medium 2-candidate → explanation.candidateScoreSpread is finite non-negative', async () => {
  const agg = makeTwoAgg('gge-3');
  try {
    const { explanation } = await castMediumVerbosity(agg);
    const spread = explanation['candidateScoreSpread'];
    assert.ok(
      typeof spread === 'number' && Number.isFinite(spread) && spread >= 0,
      `GGE-3: candidateScoreSpread must be a finite non-negative number (winner >= lowest by definition); got ${JSON.stringify(spread)}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GGE-4: candidateScoreSpread ABSENT with 1 candidate ──────────────────────

test('GGE-4: verbosity:medium 1-candidate → explanation.candidateScoreSpread ABSENT', async () => {
  const agg = makeOneAgg('gge-4');
  try {
    const { explanation } = await castMediumVerbosity(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'candidateScoreSpread'),
      false,
      `GGE-4: candidateScoreSpread must be absent with 1 candidate in medium verbosity; got explanation=${JSON.stringify(explanation)}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GGE-5: candidateScoreMean ABSENT with 1 candidate ────────────────────────

test('GGE-5: verbosity:medium 1-candidate → explanation.candidateScoreMean ABSENT', async () => {
  const agg = makeOneAgg('gge-5');
  try {
    const { explanation } = await castMediumVerbosity(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'candidateScoreMean'),
      false,
      `GGE-5: candidateScoreMean must be absent with 1 candidate in medium verbosity; got explanation=${JSON.stringify(explanation)}`,
    );
  } finally { await agg.shutdown(); }
});
