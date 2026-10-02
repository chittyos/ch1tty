/**
 * GFX drift guard: freeze runnerUpServer + runnerUpCategory field presence and
 * value types for verbosity:'medium' with a two-candidate registry.
 *
 * Background
 * ----------
 * buildCastExplanation() (dist/aggregator.js ~1986) sets four runner-up fields
 * in the verbosity:'medium' block when topCandidates.length > 1:
 *
 *   r.runnerUpScore    = topCandidates[1].score;
 *   r.runnerUpTool     = topCandidates[1].tool;          // "serverId/toolName"
 *   r.runnerUpServer   = topCandidates[1].tool.split('/')[0];
 *   r.runnerUpCategory = scoredTools[1].category;
 *
 * GFW froze the PRESENCE of runnerUpScore and runnerUpTool (GFW-1, GFW-2) and
 * their value-type invariants (GFW-3, GFW-4). GFW did NOT test:
 *
 *   (a) runnerUpServer is PRESENT in medium-verbosity multi-candidate results
 *   (b) runnerUpCategory is PRESENT in the same path
 *   (c) runnerUpServer is a non-empty string (type + content guard)
 *   (d) runnerUpCategory is a non-empty string (type + content guard)
 *   (e) runnerUpServer is ABSENT in single-candidate medium-verbosity results
 *       (symmetric to GFW-5 for runnerUpScore)
 *
 * A refactor that drops runnerUpServer/runnerUpCategory from the medium-verbosity
 * block, changes their type, or accidentally injects them unconditionally (even
 * in the single-candidate path) would pass all prior GF* tests silently.
 *
 * GFX closes those gaps:
 *
 *   GFX-1  verbosity:'medium', 2-candidate → explanation.runnerUpServer IS PRESENT
 *   GFX-2  verbosity:'medium', 2-candidate → explanation.runnerUpCategory IS PRESENT
 *   GFX-3  verbosity:'medium', 2-candidate → explanation.runnerUpServer is a
 *           non-empty string (type + content guard)
 *   GFX-4  verbosity:'medium', 2-candidate → explanation.runnerUpCategory is a
 *           non-empty string (type + content guard; equals the fixture server's
 *           category, 'code')
 *   GFX-5  verbosity:'medium', 1-candidate → explanation.runnerUpServer ABSENT
 *           (symmetric absence check — medium verbosity must honour the same
 *            topCandidates.length > 1 guard as low verbosity does)
 *
 * Fixture: same two-tool neon registry as GFW (list_projects + get_project,
 * both score > 0.1 against "list neon project" → topCandidates.length === 2).
 * For GFX-5 the single-tool neon registry from GFV/GFW is reused.
 *
 * Frozen 2026-10-02.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable — GFX freezes the
 *     PRESENCE of existing conditional fields (runnerUpServer, runnerUpCategory)
 *     in the medium-verbosity multi-candidate path; no new fields are added to
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
  return join(tmpdir(), `ch1tty-gfx-${Date.now()}-${++dlqSeq}.jsonl`);
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

/** Two-tool registry — both tools score with INTENT, so topCandidates.length === 2. */
function makeTwoAgg(): Aggregator {
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

/** Single-tool registry — topCandidates.length === 1, so runner-up fields are absent. */
function makeOneAgg(): Aggregator {
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

async function castMediumVerbosity(agg: Aggregator): Promise<Record<string, unknown>> {
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

// ── GFX-1: runnerUpServer is present with 2 candidates ────────────────────────

test('GFX-1: verbosity:medium 2-candidate → explanation.runnerUpServer IS PRESENT', async () => {
  const agg = makeTwoAgg();
  try {
    const explanation = await castMediumVerbosity(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'runnerUpServer'),
      true,
      `GFX-1: runnerUpServer must be present with 2 candidates in medium verbosity; got keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFX-2: runnerUpCategory is present with 2 candidates ──────────────────────

test('GFX-2: verbosity:medium 2-candidate → explanation.runnerUpCategory IS PRESENT', async () => {
  const agg = makeTwoAgg();
  try {
    const explanation = await castMediumVerbosity(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'runnerUpCategory'),
      true,
      `GFX-2: runnerUpCategory must be present with 2 candidates in medium verbosity; got keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFX-3: runnerUpServer is a non-empty string ────────────────────────────────

test('GFX-3: verbosity:medium 2-candidate → explanation.runnerUpServer is a non-empty string', async () => {
  const agg = makeTwoAgg();
  try {
    const explanation = await castMediumVerbosity(agg);
    const rs = explanation['runnerUpServer'];
    assert.equal(typeof rs, 'string', `GFX-3: runnerUpServer must be a string; got ${typeof rs}`);
    assert.ok(
      (rs as string).length > 0,
      `GFX-3: runnerUpServer must be non-empty; got "${rs}"`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFX-4: runnerUpCategory is a non-empty string matching the fixture category ─

test('GFX-4: verbosity:medium 2-candidate → explanation.runnerUpCategory is \'code\' (fixture category)', async () => {
  const agg = makeTwoAgg();
  try {
    const explanation = await castMediumVerbosity(agg);
    const rc = explanation['runnerUpCategory'];
    assert.equal(typeof rc, 'string', `GFX-4: runnerUpCategory must be a string; got ${typeof rc}`);
    assert.equal(
      rc,
      'code',
      `GFX-4: runnerUpCategory must equal the fixture server category 'code'; got "${rc}"`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFX-5: runnerUpServer ABSENT with 1 candidate in medium verbosity ──────────

test('GFX-5: verbosity:medium 1-candidate → explanation.runnerUpServer ABSENT', async () => {
  const agg = makeOneAgg();
  try {
    const explanation = await castMediumVerbosity(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'runnerUpServer'),
      false,
      `GFX-5: runnerUpServer must be absent with 1 candidate in medium verbosity; got explanation=${JSON.stringify(explanation)}`,
    );
  } finally { await agg.shutdown(); }
});
