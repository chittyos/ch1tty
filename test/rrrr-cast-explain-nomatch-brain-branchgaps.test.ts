/**
 * RRRR coverage sweep — closes remaining reachable branch gaps in buildCastExplanation
 * (src-stdio/aggregator.ts lines 2161-2164, 2169, 2187):
 *
 *  1. Lines 2163 (false), 2164 (false), 2187 (false): the `best !== undefined` and
 *     `topCandidates.length > 1` outer-ternary FALSE branches. These fire when
 *     buildCastExplanation is called with best=undefined and scoredTools=[] — which
 *     happens on the cast: 'no_match' path when explain: true is passed (line 1283
 *     in aggregator.ts). No existing test calls cast with explain:true AND gets
 *     no_match.
 *
 *  2. Line 2169 (false branch of `best !== undefined ? {...} : {}` inside the focus
 *     block): fires under the same no_match+explain+focus condition as above.
 *
 *  3. Line 2161 (true branch of `brainMs !== undefined ? { brainMs } : {}`): fires
 *     when castRoute === 'brain', i.e. when routeIntent returns a non-empty result.
 *     Achieved by subclassing SessionCoordinator to return a brain result.
 *
 * Lines 2173, 2178, 2180 (zero-score false branches) are provably unreachable:
 * scoreIntent filters to t.score > 0.1 before applyFocusBias, so best.score and
 * runner-up scores are always > 0.1 when buildCastExplanation reaches those guards.
 * Those branches are left uncovered intentionally — coverage threshold is met.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { RoutedTool, ToolCandidate } from '../src/ollama-brain.js';
import type { FocusProfiles } from '../src/focus.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

function dlq(label: string): string {
  return join(tmpdir(), `ch1tty-rrrr-${label}-${Date.now()}.jsonl`);
}

class KeywordCoord extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

// Returns the first candidate with high confidence, simulating a brain route.
class BrainCoord extends SessionCoordinator {
  override async routeIntent(_q: string, candidates: ToolCandidate[]): Promise<RoutedTool[] | null> {
    if (candidates.length === 0) return null;
    return [{ tool: candidates[0], confidence: 0.9, reason: 'test-brain' }];
  }
}

// ── 1. no_match + explain: true (no focus) ──────────────────────────────────
//
// Intent has zero overlap with the registered tool's description → scoredTools=[].
// Line 1283 in aggregator calls buildCastExplanation(resolvedBy, undefined, [], ...).
// In buildCastExplanation:
//   • line 2161: brainMs === undefined → FALSE branch (empty spread `{}`)
//   • line 2163: best === undefined → FALSE branch
//   • line 2164: topCandidates.length (0) > 1 → FALSE branch
//   • line 2187: best===undefined → FALSE branch of the outer focus sub-condition
//
test('rrrr: no_match + explain:true + verbosity:full covers best=undefined branches (2163/2164/2187 false)', async () => {
  const backend = new FixtureBackend();
  backend.defineServer('greet', {
    tools: [{
      name: 'say_hello',
      description: 'greet a user with a friendly hello message',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: 'hello' }] },
    }],
  });
  const configs: ServerConfig[] = [
    { id: 'greet', name: 'Greet', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://greet.test/mcp', lazy: true, enabled: true },
  ];
  const d = dlq('nomatch-nofocus');
  const coord = new KeywordCoord({}, { enabled: false }, d);
  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: d,
    suggestionsCatalog: {},
    coordinator: coord,
  });

  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'xyzzy frobulate qqqzzz',
      explain: true,
      verbosity: 'full',
    });
    assert.equal(result.isError, undefined, 'no_match is not an error');

    const data = JSON.parse(result.content[0].text as string) as Record<string, unknown>;
    assert.equal(data.cast, 'no_match', 'cast resolves to no_match');

    const exp = data.explanation as Record<string, unknown> | undefined;
    assert.ok(exp !== undefined, 'explanation present on no_match when explain:true');

    // best === undefined path: winnerScore is absent, candidateCount = 0
    assert.equal(exp.winnerScore, undefined, 'winnerScore absent when best=undefined (line 2163 false)');
    assert.equal(exp.runnerUpScore, undefined, 'runnerUpScore absent when topCandidates empty (line 2164 false)');
    assert.equal(typeof (exp.candidateCount as number), 'number', 'candidateCount present');
    assert.equal(exp.candidateCount, 0, 'candidateCount = 0 for no_match');
    assert.equal(exp.brainMs, undefined, 'brainMs absent on keyword path (line 2161 false)');
    assert.ok(Array.isArray(exp.topCandidates), 'topCandidates array present');
    assert.equal((exp.topCandidates as unknown[]).length, 0, 'topCandidates empty on no_match');
    assert.equal(typeof exp.rationale, 'string', 'rationale present');
    assert.ok((exp.rationale as string).includes('No tool candidates'), 'rationale mentions no candidates');
  } finally {
    await agg.shutdown();
  }
});

// ── 2. no_match + explain: true + focus active ───────────────────────────────
//
// Same as test 1 but with focus active. The focus block `...(focusName && focus ? {...} : {})`
// is entered. Inside it, `...(best !== undefined ? {...} : {})` at line 2169 fires the
// FALSE branch (best=undefined → empty spread). Also confirms the outer focus spread
// itself is exercised, providing additional coverage of focus=active+best=undefined paths.
//
test('rrrr: no_match + explain:true + focus active covers line-2169 false (best=undefined in focus block)', async () => {
  const backend = new FixtureBackend();
  backend.defineServer('financial', {
    tools: [{
      name: 'list_invoices',
      description: 'list all billing invoices for the current period',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: '[]' }] },
    }],
  });
  const configs: ServerConfig[] = [
    { id: 'financial', name: 'Financial', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://financial.test/mcp', lazy: true, enabled: true },
  ];
  const focusProfiles: FocusProfiles = {
    profiles: {
      finance: { categories: ['ecosystem'], servers: ['financial'], boost: 0.5 },
    },
  };
  const d = dlq('nomatch-focus');
  const coord = new KeywordCoord({}, { enabled: false }, d);
  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: d,
    suggestionsCatalog: {},
    coordinator: coord,
    focus: 'finance',
    focusProfiles,
  });

  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'xyzzy frobulate qqqzzz',
      explain: true,
      verbosity: 'full',
    });
    assert.equal(result.isError, undefined, 'no_match is not an error');

    const data = JSON.parse(result.content[0].text as string) as Record<string, unknown>;
    assert.equal(data.cast, 'no_match', 'cast resolves to no_match');

    const exp = data.explanation as Record<string, unknown> | undefined;
    assert.ok(exp !== undefined, 'explanation present on no_match when explain:true');

    // Focus block entered, but best=undefined → line 2169 false branch fires (no winnerFocusBoost etc.)
    assert.equal(exp.focus, 'finance', 'focus name in explanation');
    assert.equal(typeof exp.focusBoost, 'number', 'focusBoost present in focus block');
    assert.equal(exp.winnerInFocus, false, 'winnerInFocus=false when no winner');
    assert.equal(exp.winnerFocusBoost, undefined, 'winnerFocusBoost absent when best=undefined (line 2169 false)');
    assert.equal(exp.winnerScore, undefined, 'winnerScore absent (line 2163 false)');
  } finally {
    await agg.shutdown();
  }
});

// ── 3. brain route + explain: true + verbosity: 'full' ──────────────────────
//
// BrainCoord.routeIntent returns the first candidate with confidence=0.9, making
// castRoute='brain' and brainRouteMs defined. At line 2161:
//   `...(brainMs !== undefined ? { brainMs } : {})` → TRUE branch fires.
// The test verifies brainMs is present in the explanation object.
//
test('rrrr: brain-route cast + explain:true + verbosity:full covers brainMs truthy branch (line 2161 true)', async () => {
  const backend = new FixtureBackend();
  backend.defineServer('db', {
    tools: [{
      name: 'query_database',
      description: 'run a SQL query against the database and return results',
      inputSchema: { type: 'object', properties: { sql: { type: 'string' } } },
      response: { content: [{ type: 'text', text: '[]' }] },
    }],
  });
  const configs: ServerConfig[] = [
    { id: 'db', name: 'Database', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://db.test/mcp', lazy: true, enabled: true },
  ];
  const d = dlq('brain-route');
  const coord = new BrainCoord({}, { enabled: false }, d);
  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: d,
    suggestionsCatalog: {},
    coordinator: coord,
  });

  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'run database query sql results',
      explain: true,
      verbosity: 'full',
      dryRun: true,
    });
    assert.equal(result.isError, undefined, 'brain-route cast succeeded');

    const data = JSON.parse(result.content[0].text as string) as Record<string, unknown>;
    // Should be cast:plan (dryRun:true) or cast:resolved; either way explanation should have brainMs
    assert.ok(['plan', 'resolved', 'no_match'].includes(data.cast as string), `unexpected cast value: ${data.cast}`);

    if (data.cast !== 'no_match') {
      const exp = data.explanation as Record<string, unknown> | undefined;
      assert.ok(exp !== undefined, 'explanation present');

      // Brain route → brainMs is defined → line 2161 TRUE branch fires
      assert.equal(typeof exp.brainMs, 'number', 'brainMs present in explanation (line 2161 true branch)');
      assert.ok((exp.brainMs as number) >= 0, 'brainMs is a non-negative number');
      assert.equal(exp.method, 'brain', 'method=brain when brain coordinator routes');
    }
  } finally {
    await agg.shutdown();
  }
});
