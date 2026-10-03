/**
 * GGH drift guard: freeze cast explanation medianCandidateScore/candidateScoreStdDev
 * presence/absence for verbosity:'medium' with two-candidate vs one-candidate registry.
 *
 * Background
 * ----------
 * When explain:true is set on cast with verbosity:'medium', buildCastExplanation()
 * (aggregator.ts ~2288) adds score-distribution fields when scoredTools.length >= 2:
 *
 *   if (scoredTools.length >= 2) {
 *     r.candidateScoreSpread = ...
 *     r.candidateScoreMean   = ...
 *     if (medianCandidateScore !== undefined) r.medianCandidateScore = medianCandidateScore;
 *     if (candidateScoreStdDev !== undefined) r.candidateScoreStdDev = candidateScoreStdDev;
 *   }
 *
 * medianCandidateScore is computed as undefined when scoredTools.length < 2 and as the
 * median of the scored list (even-length: average of two middle values) when >= 2.
 * candidateScoreStdDev is sqrt(candidateScoreVariance), which is undefined when
 * scoredTools.length < 2 and otherwise defined.
 *
 * GGE froze candidateScoreSpread/candidateScoreMean in the medium path but did NOT
 * specifically isolate medianCandidateScore or candidateScoreStdDev.  A regression that:
 *
 *   (a) drops medianCandidateScore or candidateScoreStdDev from the 2+ candidate path,
 *   (b) emits them in the 1-candidate path (where both must be absent), or
 *   (c) emits a non-finite / negative stddev (stddev = sqrt(variance) >= 0 always)
 *
 * would pass every existing explanation guard silently.
 *
 * GGH closes those gaps:
 *
 *   GGH-1  verbosity:'medium', 2-candidate → medianCandidateScore IS PRESENT
 *   GGH-2  verbosity:'medium', 2-candidate → candidateScoreStdDev IS PRESENT
 *   GGH-3  verbosity:'medium', 2-candidate → candidateScoreStdDev is finite non-negative
 *          (stddev = sqrt(variance) >= 0 by construction)
 *   GGH-4  verbosity:'medium', 1-candidate → medianCandidateScore ABSENT
 *   GGH-5  verbosity:'medium', 1-candidate → candidateScoreStdDev ABSENT
 *
 * Fixture: same two-tool neon backend as GGE/GFW.
 * Frozen 2026-10-03.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable — GGH freezes the
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
  return join(tmpdir(), `ch1tty-ggh-${Date.now()}-${++dlqSeq}.jsonl`);
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

/** Single-tool registry — scoredTools.length === 1, so stat fields are absent. */
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

// ── GGH-1: medianCandidateScore present with 2 candidates ─────────────────────

test('GGH-1: verbosity:medium 2-candidate → explanation.medianCandidateScore IS PRESENT', async () => {
  const agg = makeTwoAgg('ggh-1');
  try {
    const { explanation } = await castMediumVerbosity(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'medianCandidateScore'),
      true,
      `GGH-1: medianCandidateScore must be present with 2 candidates in medium verbosity; got keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GGH-2: candidateScoreStdDev present with 2 candidates ─────────────────────

test('GGH-2: verbosity:medium 2-candidate → explanation.candidateScoreStdDev IS PRESENT', async () => {
  const agg = makeTwoAgg('ggh-2');
  try {
    const { explanation } = await castMediumVerbosity(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'candidateScoreStdDev'),
      true,
      `GGH-2: candidateScoreStdDev must be present with 2 candidates in medium verbosity; got keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GGH-3: candidateScoreStdDev is finite non-negative ────────────────────────

test('GGH-3: verbosity:medium 2-candidate → explanation.candidateScoreStdDev is finite non-negative', async () => {
  const agg = makeTwoAgg('ggh-3');
  try {
    const { explanation } = await castMediumVerbosity(agg);
    const stddev = explanation['candidateScoreStdDev'];
    assert.ok(
      typeof stddev === 'number' && Number.isFinite(stddev) && stddev >= 0,
      `GGH-3: candidateScoreStdDev must be a finite non-negative number (stddev = sqrt(variance) >= 0 by construction); got ${JSON.stringify(stddev)}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GGH-4: medianCandidateScore ABSENT with 1 candidate ───────────────────────

test('GGH-4: verbosity:medium 1-candidate → explanation.medianCandidateScore ABSENT', async () => {
  const agg = makeOneAgg('ggh-4');
  try {
    const { explanation } = await castMediumVerbosity(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'medianCandidateScore'),
      false,
      `GGH-4: medianCandidateScore must be absent with 1 candidate in medium verbosity; got explanation=${JSON.stringify(explanation)}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GGH-5: candidateScoreStdDev ABSENT with 1 candidate ───────────────────────

test('GGH-5: verbosity:medium 1-candidate → explanation.candidateScoreStdDev ABSENT', async () => {
  const agg = makeOneAgg('ggh-5');
  try {
    const { explanation } = await castMediumVerbosity(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'candidateScoreStdDev'),
      false,
      `GGH-5: candidateScoreStdDev must be absent with 1 candidate in medium verbosity; got explanation=${JSON.stringify(explanation)}`,
    );
  } finally { await agg.shutdown(); }
});
