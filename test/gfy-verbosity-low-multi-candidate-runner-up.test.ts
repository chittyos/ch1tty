/**
 * GFY drift guard: freeze cast explanation runner-up field presence for
 * verbosity:'low' with a two-candidate registry.
 *
 * Background
 * ----------
 * When explain:true is set on cast with verbosity:'low', buildCastExplanation()
 * includes runner-up fields when topCandidates.length > 1 (aggregator.ts ~2273):
 *
 *   if (topCandidates.length > 1) {
 *     r.runnerUpScore = topCandidates[1].score;
 *     r.runnerUpTool  = topCandidates[1].tool;   // "serverId/toolName"
 *   }
 *
 * Unlike verbosity:'medium', the low-verbosity block does NOT emit
 * runnerUpServer or runnerUpCategory — it is limited to the two core
 * runner-up scalars only.
 *
 * GFW froze the same fields for verbosity:'medium'. GFV froze the single-
 * candidate key set for verbosity:'low' (absence path). No test freezes
 * the PRESENCE of runner-up fields in the low-verbosity multi-candidate path
 * or verifies that the medium-only fields (runnerUpServer, runnerUpCategory)
 * are correctly absent from low-verbosity output.
 *
 * Why this matters
 * ----------------
 * A regression that:
 *
 *   (a) drops runnerUpScore/runnerUpTool from low verbosity with 2+ candidates
 *   (b) emits runnerUpTool without the namespace slash (bare tool name only), or
 *   (c) makes runnerUpScore negative or non-finite, or
 *   (d) accidentally adds runnerUpServer/runnerUpCategory to low verbosity output
 *
 * would pass every existing explanation test silently — GFV only covers the
 * single-candidate path, GFW covers the medium-verbosity path, and all
 * other guards use full verbosity.
 *
 * GFY closes those gaps:
 *
 *   GFY-1  verbosity:'low', 2-candidate → explanation.runnerUpScore IS PRESENT
 *          (guards against a regression that drops the runner-up block entirely
 *           from the low-verbosity path)
 *
 *   GFY-2  verbosity:'low', 2-candidate → explanation.runnerUpTool IS PRESENT
 *          (symmetric field-presence check for the tool-name runner-up field)
 *
 *   GFY-3  verbosity:'low', 2-candidate → explanation.runnerUpScore is a
 *          finite non-negative number
 *          (type + range guard; catches a refactor that injects NaN or a string)
 *
 *   GFY-4  verbosity:'low', 2-candidate → explanation.runnerUpTool contains
 *          exactly one '/' (namespaced "serverId/toolName" format)
 *          (format guard; a regression that strips the server prefix or emits a
 *           bare name would break callers that parse the namespace)
 *
 *   GFY-5  verbosity:'low', 2-candidate → explanation.runnerUpServer IS ABSENT
 *          (low verbosity intentionally omits runnerUpServer and runnerUpCategory
 *           which are present in medium verbosity; this guards against a regression
 *           that accidentally promotes the low verbosity block to emit these fields)
 *
 * Fixture: single neon server with TWO tools (list_projects + get_project).
 * Intent "list neon project" scores both tools:
 *   - list_projects: matches "list", "neon", "project" → keywordScore=1.0 + nameBonus → ~1.3
 *   - get_project:   matches "neon", "project"         → keywordScore=0.67 + nameBonus → ~0.97
 * Both exceed the 0.1 filter threshold, so topCandidates.length === 2.
 * KeywordOnlyCoordinator disables the brain route for determinism.
 * confirm:true (dryRun) avoids any backend network call.
 * suggestionsCatalog:{} prevents disk-loaded focus-suggestions.json from
 * injecting suggestion resources that could compete as additional candidates.
 *
 * Frozen 2026-10-02.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable — GFY freezes the
 *     PRESENCE of existing conditional fields (runner-up) in the low-verbosity
 *     multi-candidate path and the ABSENCE of medium-only fields; no new fields
 *     are added to buildCastExplanation
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
  return join(tmpdir(), `ch1tty-gfy-${Date.now()}-${++dlqSeq}.jsonl`);
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

// "list" and "neon" and "project" all appear in both tool haystacks, so
// both score > 0.1 and appear in topCandidates.
const INTENT = 'list neon project';

async function castLowVerbosity(agg: Aggregator): Promise<{
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

// ── GFY-1: runnerUpScore is present with 2 candidates ─────────────────────────

test('GFY-1: verbosity:low 2-candidate → explanation.runnerUpScore IS PRESENT', async () => {
  const agg = makeTwoAgg();
  try {
    const { explanation } = await castLowVerbosity(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'runnerUpScore'),
      true,
      `GFY-1: runnerUpScore must be present with 2 candidates in low verbosity; got keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFY-2: runnerUpTool is present with 2 candidates ──────────────────────────

test('GFY-2: verbosity:low 2-candidate → explanation.runnerUpTool IS PRESENT', async () => {
  const agg = makeTwoAgg();
  try {
    const { explanation } = await castLowVerbosity(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'runnerUpTool'),
      true,
      `GFY-2: runnerUpTool must be present with 2 candidates in low verbosity; got keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFY-3: runnerUpScore is a finite non-negative number ──────────────────────

test('GFY-3: verbosity:low 2-candidate → explanation.runnerUpScore is finite non-negative', async () => {
  const agg = makeTwoAgg();
  try {
    const { explanation } = await castLowVerbosity(agg);
    const rs = explanation['runnerUpScore'];
    assert.ok(
      typeof rs === 'number' && Number.isFinite(rs) && rs >= 0,
      `GFY-3: runnerUpScore must be a finite non-negative number; got ${JSON.stringify(rs)}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFY-4: runnerUpTool contains exactly one '/' ───────────────────────────────

test('GFY-4: verbosity:low 2-candidate → explanation.runnerUpTool contains exactly one slash', async () => {
  const agg = makeTwoAgg();
  try {
    const { explanation } = await castLowVerbosity(agg);
    const rt = explanation['runnerUpTool'];
    assert.equal(typeof rt, 'string', `GFY-4: runnerUpTool must be a string; got ${typeof rt}`);
    const slashCount = ((rt as string).match(/\//g) ?? []).length;
    assert.equal(
      slashCount,
      1,
      `GFY-4: runnerUpTool must contain exactly one slash (namespaced "serverId/toolName"); got "${rt}" with ${slashCount} slashes`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFY-5: runnerUpServer ABSENT in low verbosity (medium-only field) ─────────

test('GFY-5: verbosity:low 2-candidate → explanation.runnerUpServer IS ABSENT', async () => {
  const agg = makeTwoAgg();
  try {
    const { explanation } = await castLowVerbosity(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'runnerUpServer'),
      false,
      `GFY-5: runnerUpServer must be absent in low verbosity (it is a medium-verbosity-only field); got explanation=${JSON.stringify(explanation)}`,
    );
  } finally { await agg.shutdown(); }
});
