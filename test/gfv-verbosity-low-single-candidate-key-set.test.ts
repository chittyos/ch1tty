/**
 * GFV drift guard: freeze cast explanation key set for verbosity:'low' with a
 * single-candidate registry.
 *
 * Background
 * ----------
 * When explain:true is set on cast, the response includes an `explanation`
 * sub-object built by buildCastExplanation(). That function accepts a
 * verbosity parameter ('low' | 'medium' | 'full'; default 'full').
 *
 * verbosity:'low' returns only the essential fields:
 *   { method, candidateCount, topCandidates, rationale,
 *     ...(best ? { winnerScore, winnerServer } : {}),
 *     ...(topCandidates.length > 1 ? { runnerUpScore, runnerUpTool } : {}),
 *     ...(focus ? { focus, focusBoost, winnerInFocus, ... } : {}),
 *   }
 *
 * When the registry has exactly ONE candidate, `topCandidates.length > 1` is
 * false, so the runner-up fields (runnerUpScore, runnerUpTool) are absent.
 *
 * Why this matters
 * ----------------
 * No existing drift guard (GEE, GEF, GI, GK) tests the `explanation`
 * sub-object with verbosity:'low'. All prior guards use the default full
 * verbosity. A regression that:
 *
 *   (a) always includes runnerUpScore/runnerUpTool even with 1 candidate, or
 *   (b) changes the low-verbosity key set by adding an undocumented field, or
 *   (c) swaps winnerServer for winnerTool in the low-verbosity path, or
 *   (d) drops winnerScore from the single-candidate low-verbosity path
 *
 * would pass every existing explanation test silently.
 *
 * GFV closes those gaps:
 *
 *   GFV-1  verbosity:'low', single candidate, no focus → explanation has
 *          EXACTLY 6 keys: {candidateCount, method, rationale, topCandidates,
 *          winnerScore, winnerServer} (no extras; sorted alphabetically)
 *
 *   GFV-2  verbosity:'low', single candidate → explanation.runnerUpScore is
 *          ABSENT (runner-up fields must not appear with 1 candidate)
 *
 *   GFV-3  verbosity:'low', single candidate → explanation.runnerUpTool is
 *          ABSENT (symmetric with GFV-2 for the tool name field)
 *
 *   GFV-4  verbosity:'low', single candidate → explanation.candidateCount === 1
 *          (the count echoes the actual registry size; a refactor that hard-codes
 *           or fails to propagate scoredTools.length would be caught)
 *
 *   GFV-5  verbosity:'low', single candidate → explanation.winnerScore is a
 *          finite non-negative number
 *          (presence + type guard; distinguishes from the no_match path where
 *           best is undefined and winnerScore is absent; also catches a refactor
 *           that injects winnerScore as a string or NaN)
 *
 * Fixture: single neon server with one tool (list_projects). Intent
 * "list neon projects" reliably resolves to neon/list_projects via keyword
 * scoring. KeywordOnlyCoordinator disables the brain route for determinism.
 * confirm:true (dryRun) avoids any backend network call.
 * suggestionsCatalog:{} prevents disk-loaded focus-suggestions.json from
 * injecting suggestion resources that could compete as additional candidates.
 *
 * Frozen 2026-10-02.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable — GFV freezes the
 *     ABSENCE of existing conditional fields (runner-up) in the single-candidate
 *     low-verbosity path; no new fields are added to buildCastExplanation
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Frozen key set ─────────────────────────────────────────────────────────────

/**
 * Exact explanation keys for verbosity:'low', single candidate, no focus.
 * Source: buildCastExplanation() verbosity==='low' branch, aggregator.ts ~2261.
 */
const LOW_SINGLE_CANDIDATE_KEYS: readonly string[] = [
  'candidateCount',
  'method',
  'rationale',
  'topCandidates',
  'winnerScore',
  'winnerServer',
];

// ── Helpers ────────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gfv-${Date.now()}-${++dlqSeq}.jsonl`);
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

const CFG: ServerConfig = {
  id: 'neon',
  name: 'Neon DB',
  type: 'remote',
  access: 'readwrite',
  category: 'code',
  endpoint: 'https://neon.tech/mcp',
  lazy: true,
};

const INTENT = 'list neon projects';

function makeAgg(suffix: string): Aggregator {
  const backend = new FixtureBackend();
  // Single tool in the registry — ensures topCandidates.length === 1.
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

// ── GFV-1: exact 6-key set ─────────────────────────────────────────────────────

test('GFV-1: verbosity:low single-candidate explanation has exactly 6 keys', async () => {
  const agg = makeAgg('gfv-1');
  try {
    const { explanation } = await castLowVerbosity(agg);
    const keys = Object.keys(explanation).sort();
    assert.deepEqual(
      keys,
      [...LOW_SINGLE_CANDIDATE_KEYS].sort(),
      `GFV-1: expected keys ${JSON.stringify(LOW_SINGLE_CANDIDATE_KEYS)}, got ${JSON.stringify(keys)}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFV-2: runnerUpScore is absent ─────────────────────────────────────────────

test('GFV-2: verbosity:low single-candidate → explanation.runnerUpScore is ABSENT', async () => {
  const agg = makeAgg('gfv-2');
  try {
    const { explanation } = await castLowVerbosity(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'runnerUpScore'),
      false,
      `GFV-2: runnerUpScore must be absent with 1 candidate; got explanation=${JSON.stringify(explanation)}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFV-3: runnerUpTool is absent ──────────────────────────────────────────────

test('GFV-3: verbosity:low single-candidate → explanation.runnerUpTool is ABSENT', async () => {
  const agg = makeAgg('gfv-3');
  try {
    const { explanation } = await castLowVerbosity(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'runnerUpTool'),
      false,
      `GFV-3: runnerUpTool must be absent with 1 candidate; got explanation=${JSON.stringify(explanation)}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFV-4: candidateCount === 1 ────────────────────────────────────────────────

test('GFV-4: verbosity:low single-candidate → explanation.candidateCount === 1', async () => {
  const agg = makeAgg('gfv-4');
  try {
    const { explanation } = await castLowVerbosity(agg);
    assert.equal(
      explanation['candidateCount'],
      1,
      `GFV-4: candidateCount must be 1 for single-tool registry; got ${JSON.stringify(explanation['candidateCount'])}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFV-5: winnerScore is a finite non-negative number ─────────────────────────

test('GFV-5: verbosity:low single-candidate → explanation.winnerScore is finite non-negative', async () => {
  const agg = makeAgg('gfv-5');
  try {
    const { explanation } = await castLowVerbosity(agg);
    const ws = explanation['winnerScore'];
    assert.ok(
      typeof ws === 'number' && Number.isFinite(ws) && ws >= 0,
      `GFV-5: winnerScore must be a finite non-negative number; got ${JSON.stringify(ws)}`,
    );
  } finally { await agg.shutdown(); }
});
