/**
 * GGI drift guard: freeze winnerCategory field presence and value type for
 * verbosity:'medium'.
 *
 * Background
 * ----------
 * buildCastExplanation() sets winnerCategory in the verbosity:'medium' block
 * inside the `best !== undefined` guard (NOT inside the `topCandidates.length > 1`
 * guard used by runner-up fields):
 *
 *   if (best !== undefined) {
 *     r.winnerScore = best.score;
 *     r.winnerServer = best.namespacedName.split('/')[0];
 *     r.winnerCategory = best.category;           // ← present even with 1 candidate
 *   }
 *
 * At verbosity:'low', winnerCategory is NOT set — only winnerScore and
 * winnerServer are included in the `best !== undefined` block.
 *
 * GFX froze runnerUpServer and runnerUpCategory (conditional on
 * topCandidates.length > 1). No existing drift guard freezes:
 *
 *   (a) winnerCategory IS PRESENT at medium verbosity in the multi-candidate path
 *   (b) winnerCategory is a non-empty string
 *   (c) winnerCategory equals the fixture server's declared category
 *   (d) winnerCategory IS ABSENT at verbosity:'low' (low-verbosity exclusion guard)
 *   (e) winnerCategory IS PRESENT at medium verbosity with a SINGLE candidate
 *       (distinguishes from runner-up fields which require topCandidates.length > 1)
 *
 * A refactor that:
 *   (i)  moves winnerCategory into the `topCandidates.length > 1` block, or
 *   (ii) removes it from the medium-verbosity path, or
 *   (iii) renames it to winnerDomain / winnerType / winnerTag, or
 *   (iv) accidentally adds it to the low-verbosity path
 * would pass all prior GF-series/GG-series tests silently.
 *
 * GGI closes those gaps:
 *
 *   GGI-1  verbosity:'medium', 2-candidate → explanation.winnerCategory IS PRESENT
 *   GGI-2  verbosity:'medium', 2-candidate → explanation.winnerCategory is a
 *           non-empty string (type + content guard)
 *   GGI-3  verbosity:'medium', 2-candidate → explanation.winnerCategory equals
 *           'code' (the fixture server's declared category)
 *   GGI-4  verbosity:'low', 2-candidate → explanation.winnerCategory IS ABSENT
 *           (low-verbosity must NOT include winnerCategory)
 *   GGI-5  verbosity:'medium', 1-candidate → explanation.winnerCategory IS PRESENT
 *           (present even without a runner-up — guard is `best !== undefined`,
 *            not `topCandidates.length > 1`)
 *
 * Fixture: same two-tool and one-tool neon registries as GFX/GFW/GFV.
 * KeywordOnlyCoordinator ensures determinism (no Ollama/embedding paths).
 * confirm:true (dryRun) skips any backend network call.
 * suggestionsCatalog:{} prevents disk-loaded focus-suggestions.json from
 * influencing scores.
 *
 * Frozen 2026-10-03.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable — GGI freezes the
 *     PRESENCE of an existing unconditional winner field (winnerCategory) in
 *     the medium-verbosity path; no new fields are added to buildCastExplanation
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
  return join(tmpdir(), `ch1tty-ggi-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

// ── Fixtures ───────────────────────────────────────────────────────────────────

const TOOL_LIST_PROJECTS = {
  name: 'list_projects',
  description: 'List all neon database projects for an account',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text' as const, text: '{"projects":[]}' }] },
};

const TOOL_GET_PROJECT = {
  name: 'get_project',
  description: 'Get details of a specific neon database project by ID',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text' as const, text: '{"project":{}}' }] },
};

const CFG: ServerConfig = {
  id: 'neon',
  name: 'Neon',
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

/** Single-tool registry — topCandidates.length === 1. */
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

async function castExplanation(agg: Aggregator, verbosity: 'low' | 'medium'): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', {
    intent: INTENT,
    confirm: true,
    explain: true,
    verbosity,
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

// ── GGI-1: winnerCategory IS PRESENT at medium verbosity (2 candidates) ────────

test('GGI-1: verbosity:medium 2-candidate → explanation.winnerCategory IS PRESENT', async () => {
  const agg = makeTwoAgg();
  try {
    const explanation = await castExplanation(agg, 'medium');
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'winnerCategory'),
      true,
      `GGI-1: winnerCategory must be present at medium verbosity with 2 candidates; got keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GGI-2: winnerCategory is a non-empty string ────────────────────────────────

test('GGI-2: verbosity:medium 2-candidate → explanation.winnerCategory is a non-empty string', async () => {
  const agg = makeTwoAgg();
  try {
    const explanation = await castExplanation(agg, 'medium');
    const wc = explanation['winnerCategory'];
    assert.equal(typeof wc, 'string', `GGI-2: winnerCategory must be a string; got ${typeof wc}`);
    assert.ok((wc as string).length > 0, `GGI-2: winnerCategory must be non-empty; got "${wc}"`);
  } finally { await agg.shutdown(); }
});

// ── GGI-3: winnerCategory equals the fixture server's declared category ─────────

test('GGI-3: verbosity:medium 2-candidate → explanation.winnerCategory equals \'code\' (fixture category)', async () => {
  const agg = makeTwoAgg();
  try {
    const explanation = await castExplanation(agg, 'medium');
    assert.equal(
      explanation['winnerCategory'],
      'code',
      `GGI-3: winnerCategory must equal the fixture server category 'code'; got "${explanation['winnerCategory']}"`,
    );
  } finally { await agg.shutdown(); }
});

// ── GGI-4: winnerCategory IS ABSENT at verbosity:low ──────────────────────────

test('GGI-4: verbosity:low 2-candidate → explanation.winnerCategory IS ABSENT', async () => {
  const agg = makeTwoAgg();
  try {
    const explanation = await castExplanation(agg, 'low');
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'winnerCategory'),
      false,
      `GGI-4: winnerCategory must be absent at low verbosity; got explanation=${JSON.stringify(explanation)}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GGI-5: winnerCategory IS PRESENT at medium verbosity with 1 candidate ──────

test('GGI-5: verbosity:medium 1-candidate → explanation.winnerCategory IS PRESENT', async () => {
  const agg = makeOneAgg();
  try {
    const explanation = await castExplanation(agg, 'medium');
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'winnerCategory'),
      true,
      `GGI-5: winnerCategory must be present at medium verbosity even with 1 candidate (guard is best!==undefined, not topCandidates.length>1); got keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
  } finally { await agg.shutdown(); }
});
