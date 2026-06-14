/**
 * KKKK batch — 4 previously untested branches:
 *
 *   1. suggestions.ts:39 — `_cached && _catalogPath === catalogPath` cache hit:
 *      Calling `loadSuggestionsCatalog(path)` a second time with the same path returns
 *      the cached object immediately. All prior tests clear the cache between calls
 *      (clearSuggestionsCache()) so the hit-branch was never fired.
 *
 *   2. aggregator.ts:buildCastExplanation — `method: 'brain'` in explanation:
 *      When the coordinator routes via brain (returns non-null results) and the
 *      winning tool came from brain ranking (not keyword augmentation), resolvedBy
 *      stays 'brain'. With explain:true the explanation includes method:'brain'.
 *      All prior cast-explain tests use KeywordOnlyCoordinator (returns null → always
 *      keyword fallback), so explanation.method === 'brain' was never asserted.
 *
 *   3. aggregator.ts:buildCastExplanation — topCandidates.length === 1, no runner-up:
 *      The `if (topCandidates.length > 1)` branch (runner-up segment in rationale)
 *      requires ≥2 scored candidates. With exactly 1 matching tool the branch is
 *      false — runner-up text is absent from the rationale. Prior tests always have
 *      ≥2 tools in the fixture so topCandidates always has ≥2 entries.
 *
 *   4. aggregator.ts:buildCastExplanation (no_match path) — `method:'brain'` via
 *      brain route returning a non-existent tool: when the coordinator returns a
 *      namespaced tool that has no entry in the registry, byName.get() returns
 *      undefined for every brain result, scoredTools collapses to [], and the
 *      no_match path fires with resolvedBy:'brain'. With explain:true the explanation
 *      says method:'brain' and rationale: "No tool candidates found via brain routing."
 *      Prior no_match tests use keyword fallback (routeIntent returns null).
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import { loadSuggestionsCatalog, clearSuggestionsCache } from '../src/suggestions.js';
import { FixtureBackend } from './fixture-backend.js';
import type { RoutedTool, ToolCandidate } from '../src/ollama-brain.js';
import type { ServerConfig } from '../src/types.js';

// ── Temp dir ─────────────────────────────────────────────────────────────────

const tempDir = mkdtempSync(join(tmpdir(), 'ch1tty-kkkk-'));
after(() => rmSync(tempDir, { recursive: true, force: true }));

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-kkkk-${process.pid}-${++_seq}.dlq.jsonl`);
}

// ── Brain coordinator stub ────────────────────────────────────────────────────

class BrainCoordinator extends SessionCoordinator {
  private readonly brainResults: RoutedTool[];
  constructor(results: RoutedTool[]) {
    super({}, { enabled: false });
    this.brainResults = results;
  }
  override async routeIntent(_q: string, _c: ToolCandidate[]): Promise<RoutedTool[]> {
    return this.brainResults;
  }
}

// ── Minimal server configs ────────────────────────────────────────────────────

const NEON_CFG: ServerConfig = {
  id: 'neon',
  name: 'Neon',
  type: 'remote',
  access: 'readwrite',
  category: 'code',
  endpoint: 'https://fixture.neon',
};

// ── KKKK-1: loadSuggestionsCatalog cache hit ─────────────────────────────────

test('loadSuggestionsCatalog: second call with same path returns cached object (cache hit branch)', () => {
  clearSuggestionsCache();

  const catalogPath = join(tempDir, 'kkkk-cache-hit.json');
  writeFileSync(
    catalogPath,
    JSON.stringify({
      profiles: {
        test: {
          description: 'KKKK test profile',
          combos: [{ name: 'combo-a', chain: ['svc/tool_a', 'svc/tool_b'], accomplishes: 'Test', verified: true }],
          prompts: [{ text: 'Do the thing', resolves_to: 'combo-a' }],
        },
      },
    }),
    'utf-8',
  );

  try {
    const first = loadSuggestionsCatalog(catalogPath);
    // Second call — _cached is now set and _catalogPath === catalogPath → cache hit
    const second = loadSuggestionsCatalog(catalogPath);

    // Strict reference equality proves the cache was returned, not re-parsed
    assert.strictEqual(first, second, 'second call must return the exact same cached object reference');
    assert.ok(first['test'], 'the returned catalog must contain the test profile');
    assert.equal(first['test'].combos.length, 1, 'must have 1 combo from the written catalog');
  } finally {
    clearSuggestionsCache();
  }
});

// ── KKKK-2: cast explain method:'brain' via brain coordinator ─────────────────

test('cast explain: brain coordinator → explanation.method === "brain"', async () => {
  const fixture = new FixtureBackend();
  fixture.defineServer('neon', {
    tools: [
      {
        name: 'run_sql',
        description: 'Execute SQL queries on a Neon database',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '{}' }] },
      },
      {
        name: 'list_projects',
        description: 'List Neon projects in the account',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '[]' }] },
      },
    ],
  });

  // Brain returns neon/run_sql. No focus → no keyword augmentation loop.
  // Intent uses gibberish terms so keyword scoreIntent returns [] and the
  // keyword-augmented set stays empty → resolvedBy remains 'brain'.
  const brainResults: RoutedTool[] = [{
    tool: { namespacedName: 'neon/run_sql', description: 'Execute SQL', category: 'code' },
    confidence: 0.92,
    reason: 'kkkk-stub',
  }];

  const coordinator = new BrainCoordinator(brainResults);
  const dlqPath = dlq();
  const aggregator = new Aggregator([NEON_CFG], {
    coordinator,
    embedEnabled: false,
    suggestionsCatalog: {},
    focusProfiles: { profiles: {} },
    ledgerDlqPath: dlqPath,
    backendFactory: (cfg) => { fixture.registerServer(cfg); return fixture; },
  });

  try {
    const result = await aggregator.callTool('ch1tty/cast', {
      intent: 'frobnicate garblexyz quuxzap', // no keyword match → augmentation empty
      explain: true,
    });

    assert.equal(result.isError, undefined, 'cast must not error');
    const cast = JSON.parse(result.content[0]?.text ?? '{}') as {
      cast: string;
      resolvedBy: string;
      explanation?: { method: string; topCandidates: Array<{ tool: string; score: number }> };
    };

    assert.ok(
      cast.cast === 'executed' || cast.cast === 'plan',
      `expected executed or plan, got: ${cast.cast}`,
    );
    assert.equal(cast.resolvedBy, 'brain', 'resolvedBy must be brain');
    assert.ok(cast.explanation, 'explanation field must be present with explain:true');
    // KKKK-2: the previously uncovered path — method:'brain' in buildCastExplanation
    assert.equal(cast.explanation.method, 'brain', 'explanation.method must be "brain" for brain route');
    assert.ok(
      cast.explanation.topCandidates.length >= 1,
      'topCandidates must contain at least the winning tool',
    );
  } finally {
    await aggregator.shutdown();
    rmSync(dlqPath, { force: true });
  }
});

// ── KKKK-3: single candidate — topCandidates.length === 1, runner-up branch false ──

test('cast explain: single scoring tool → topCandidates.length === 1, no runner-up in rationale', async () => {
  const fixture = new FixtureBackend();
  fixture.defineServer('svc', {
    tools: [
      {
        name: 'do_invoice',
        description: 'invoice billing payment process financial',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '{}' }] },
      },
    ],
  });

  const svcCfg: ServerConfig = {
    id: 'svc',
    name: 'Svc',
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: 'https://fixture.svc',
  };

  const dlqPath = dlq();
  const aggregator = new Aggregator([svcCfg], {
    embedEnabled: false,
    suggestionsCatalog: {},
    focusProfiles: { profiles: {} },
    ledgerDlqPath: dlqPath,
    backendFactory: (cfg) => { fixture.registerServer(cfg); return fixture; },
  });

  try {
    const result = await aggregator.callTool('ch1tty/cast', {
      intent: 'invoice billing payment',
      explain: true,
    });

    assert.equal(result.isError, undefined, 'cast must not error');
    const cast = JSON.parse(result.content[0]?.text ?? '{}') as {
      cast: string;
      explanation?: {
        method: string;
        topCandidates: Array<{ tool: string; score: number }>;
        rationale: string;
      };
    };

    assert.ok(
      cast.cast === 'executed' || cast.cast === 'plan',
      `expected executed or plan, got: ${cast.cast}`,
    );
    assert.ok(cast.explanation, 'explanation must be present');
    // KKKK-3: exactly 1 candidate — topCandidates.length > 1 branch (runner-up) is false
    assert.equal(
      cast.explanation.topCandidates.length,
      1,
      `expected 1 topCandidate (single-tool registry), got ${cast.explanation.topCandidates.length}`,
    );
    assert.ok(
      !cast.explanation.rationale.includes('runner-up'),
      `rationale must not mention runner-up when there is only 1 candidate: "${cast.explanation.rationale}"`,
    );
  } finally {
    await aggregator.shutdown();
    rmSync(dlqPath, { force: true });
  }
});

// ── KKKK-4: brain route + non-existent tool → no_match with method:'brain' ───

test('cast explain: brain returns non-existent tool → no_match with explanation.method === "brain"', async () => {
  const fixture = new FixtureBackend();
  fixture.defineServer('neon', {
    tools: [
      {
        name: 'run_sql',
        description: 'Execute SQL on Neon',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '{}' }] },
      },
    ],
  });

  // Brain returns a tool that does NOT exist in the registry.
  // byName.get('ghost/phantomatic_tool') → undefined → filtered to null → scoredTools = []
  // No focus → augmentation loop skipped.
  // scoredTools.length === 0 → no_match path with resolvedBy:'brain'.
  const ghostResults: RoutedTool[] = [{
    tool: { namespacedName: 'ghost/phantomatic_tool', description: 'Does not exist', category: 'code' },
    confidence: 0.99,
    reason: 'kkkk-ghost',
  }];

  const coordinator = new BrainCoordinator(ghostResults);
  const dlqPath = dlq();
  const aggregator = new Aggregator([NEON_CFG], {
    coordinator,
    embedEnabled: false,
    suggestionsCatalog: {},
    focusProfiles: { profiles: {} },
    ledgerDlqPath: dlqPath,
    backendFactory: (cfg) => { fixture.registerServer(cfg); return fixture; },
  });

  try {
    const result = await aggregator.callTool('ch1tty/cast', {
      intent: 'frobnicate garblexyz quuxzap', // no keyword match either
      explain: true,
    });

    assert.equal(result.isError, undefined, 'cast must not error');
    const cast = JSON.parse(result.content[0]?.text ?? '{}') as {
      cast: string;
      resolvedBy: string;
      explanation?: {
        method: string;
        topCandidates: Array<unknown>;
        rationale: string;
      };
    };

    // KKKK-4: no_match via brain route
    assert.equal(cast.cast, 'no_match', `expected no_match, got: ${cast.cast}`);
    assert.equal(cast.resolvedBy, 'brain', 'resolvedBy must be brain even on no_match');
    assert.ok(cast.explanation, 'explanation must be present with explain:true');
    assert.equal(cast.explanation.method, 'brain', 'explanation.method must be "brain" for brain no_match path');
    assert.equal(cast.explanation.topCandidates.length, 0, 'no candidates on no_match');
    assert.ok(
      cast.explanation.rationale.includes('brain'),
      `rationale must mention brain routing: "${cast.explanation.rationale}"`,
    );
  } finally {
    await aggregator.shutdown();
    rmSync(dlqPath, { force: true });
  }
});
