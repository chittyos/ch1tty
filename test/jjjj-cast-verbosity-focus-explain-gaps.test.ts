/**
 * JJJJ coverage sweep — closes branch gaps in buildCastExplanation (aggregator.ts).
 *
 * Targeted gaps (all in src-stdio/aggregator.ts):
 *  1. Lines 2081-2095 — verbosity='low' block (basic: no focus, runner-up path)
 *  2. Lines 2096-2103 — verbosity='low' + focus active + runner-up
 *  3. Lines 2108-2131 — verbosity='medium' block (basic: no focus, 2+ candidates)
 *  4. Lines 2132-2157 — verbosity='medium' + focus active + runner-up + sub-conditions
 *  5. Lines 2071-2072 — rationale branch: focus active but winner is out-of-focus
 *
 * Setup: two FixtureBackend servers — 'alpha' (in custom focus) and 'beta' (out of focus).
 * All tests use inline focusProfiles so the real focus-profiles.json is not required.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { FocusProfiles } from '../src/focus.js';
import type { RoutedTool, ToolCandidate } from '../src/ollama-brain.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

function dlq(label: string): string {
  return join(tmpdir(), `ch1tty-jjjj-${label}-${Date.now()}.jsonl`);
}

class KeywordCoord extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

class BrainCoord extends SessionCoordinator {
  override async routeIntent(_q: string, candidates: ToolCandidate[]): Promise<RoutedTool[] | null> {
    if (candidates.length === 0) return null;
    return [{ tool: candidates[0], confidence: 0.9, reason: 'test-brain' }];
  }
}

/** Two-server fixture: alpha (in-focus for 'testfocus'), beta (out-of-focus). */
function makeTwoServerFixture() {
  const backend = new FixtureBackend();
  backend.defineServer('alpha', {
    tools: [
      {
        name: 'list_invoices',
        description: 'list billing invoices for finance review',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '[]' }] },
      },
    ],
  });
  backend.defineServer('beta', {
    tools: [
      {
        name: 'list_projects',
        description: 'list neon database projects for code review',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '[]' }] },
      },
    ],
  });

  const configs: ServerConfig[] = [
    { id: 'alpha', name: 'Alpha', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://alpha.test/mcp', lazy: true, enabled: true },
    { id: 'beta',  name: 'Beta',  type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://beta.test/mcp',  lazy: true, enabled: true },
  ];

  // Focus profile: 'testfocus' boosts server 'alpha' only.
  const focusProfiles: FocusProfiles = {
    profiles: {
      testfocus: { categories: [], servers: ['alpha'], boost: 0.5 },
    },
  };

  return { backend, configs, focusProfiles };
}

// ── 1. verbosity='low' — no focus, runner-up present (lines 2081-2095) ──────

test('jjjj: cast explain verbosity=low fires low block (lines 2081-2095)', async () => {
  const { backend, configs } = makeTwoServerFixture();
  const d = dlq('low-nofocus');
  const coord = new KeywordCoord({}, { enabled: false }, d);
  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: d,
    suggestionsCatalog: {},
    coordinator: coord,
  });
  try {
    // 'list' matches both tools → winner + runner-up both found
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list',
      explain: true,
      verbosity: 'low',
      dryRun: true,
    });
    const data = JSON.parse(result.content[0].text as string) as Record<string, unknown>;
    const exp = data.explanation as Record<string, unknown> | undefined;
    assert.ok(exp !== undefined, 'explanation must be present when explain:true');
    assert.equal(typeof exp.method, 'string', 'method is a string in low verbosity');
    assert.equal(typeof exp.candidateCount, 'number', 'candidateCount present in low verbosity');
    assert.ok(Array.isArray(exp.topCandidates), 'topCandidates array in low verbosity');
    assert.equal(typeof exp.rationale, 'string', 'rationale string in low verbosity');
    // runnerUpScore/runnerUpTool present when 2+ candidates match
    if ((exp.candidateCount as number) > 1) {
      assert.equal(typeof exp.runnerUpScore, 'number', 'runnerUpScore when runner-up exists');
      assert.equal(typeof exp.runnerUpTool, 'string', 'runnerUpTool when runner-up exists');
    }
    // focus fields must NOT be present when no focus is active
    assert.equal(exp.focus, undefined, 'no focus field when no focus active');
  } finally {
    await agg.shutdown();
  }
});

// ── 2. verbosity='low' + focus active + runner-up (lines 2096-2103) ──────────

test('jjjj: cast explain verbosity=low with focus + runner-up covers focus block (lines 2096-2103)', async () => {
  const { backend, configs, focusProfiles } = makeTwoServerFixture();
  const d = dlq('low-focus');
  const coord = new KeywordCoord({}, { enabled: false }, d);
  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: d,
    suggestionsCatalog: {},
    coordinator: coord,
    focus: 'testfocus',
    focusProfiles,
  });
  try {
    // 'list' matches both tools; 'alpha' is boosted → alpha wins but beta is runner-up
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list',
      explain: true,
      verbosity: 'low',
      dryRun: true,
    });
    const data = JSON.parse(result.content[0].text as string) as Record<string, unknown>;
    const exp = data.explanation as Record<string, unknown> | undefined;
    assert.ok(exp !== undefined, 'explanation present');
    // Focus fields must appear in low verbosity when focus is active and best found
    assert.equal(exp.focus, 'testfocus', 'focus name present in low verbosity explanation');
    assert.equal(typeof exp.focusBoost, 'number', 'focusBoost present in low verbosity');
    assert.ok((exp.focusBoost as number) > 0, 'focusBoost positive');
    assert.equal(typeof exp.winnerInFocus, 'boolean', 'winnerInFocus present in low verbosity');
    // focusDecisive present when runner-up exists (topCandidates.length > 1 branch at 2100)
    if ((exp.candidateCount as number) > 1) {
      assert.equal(typeof exp.focusDecisive, 'boolean', 'focusDecisive present when runner-up exists');
    }
  } finally {
    await agg.shutdown();
  }
});

// ── 3. verbosity='medium' — no focus, 2+ candidates (lines 2108-2131) ────────

test('jjjj: cast explain verbosity=medium fires medium block (lines 2108-2131)', async () => {
  const { backend, configs } = makeTwoServerFixture();
  const d = dlq('medium-nofocus');
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
      intent: 'list',
      explain: true,
      verbosity: 'medium',
      dryRun: true,
    });
    const data = JSON.parse(result.content[0].text as string) as Record<string, unknown>;
    const exp = data.explanation as Record<string, unknown> | undefined;
    assert.ok(exp !== undefined, 'explanation present in medium verbosity');
    assert.equal(typeof exp.method, 'string', 'method in medium verbosity');
    assert.equal(typeof exp.candidateCount, 'number', 'candidateCount in medium verbosity');
    // scoredTools.length >= 2 → candidateScoreMean appears (line 2128)
    if ((exp.candidateCount as number) >= 2) {
      assert.equal(typeof exp.candidateScoreMean, 'number', 'candidateScoreMean present when 2+ candidates');
      assert.equal(typeof exp.candidateScoreSpread, 'number', 'candidateScoreSpread when 2+ candidates');
    }
    assert.equal(exp.focus, undefined, 'focus not present when no focus active');
  } finally {
    await agg.shutdown();
  }
});

// ── 4. verbosity='medium' + focus active + runner-up (lines 2132-2157) ───────

test('jjjj: cast explain verbosity=medium with focus + runner-up covers focus block (lines 2132-2157)', async () => {
  const { backend, configs, focusProfiles } = makeTwoServerFixture();
  const d = dlq('medium-focus');
  const coord = new KeywordCoord({}, { enabled: false }, d);
  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: d,
    suggestionsCatalog: {},
    coordinator: coord,
    focus: 'testfocus',
    focusProfiles,
  });
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list',
      explain: true,
      verbosity: 'medium',
      dryRun: true,
    });
    const data = JSON.parse(result.content[0].text as string) as Record<string, unknown>;
    const exp = data.explanation as Record<string, unknown> | undefined;
    assert.ok(exp !== undefined, 'explanation present in medium+focus');
    assert.equal(exp.focus, 'testfocus', 'focus name in medium verbosity');
    assert.equal(typeof exp.focusBoost, 'number', 'focusBoost in medium verbosity');
    assert.equal(typeof exp.winnerInFocus, 'boolean', 'winnerInFocus in medium verbosity');
    assert.equal(typeof exp.winnerFocusBoost, 'number', 'winnerFocusBoost in medium verbosity');
    assert.equal(typeof exp.winnerScoreBase, 'number', 'winnerScoreBase in medium verbosity');
    assert.equal(typeof exp.candidatesInFocusCount, 'number', 'candidatesInFocusCount in medium verbosity');
    // topCandidates > 1 → focusDecisive + focusMargin (line 2147-2154)
    if ((exp.candidateCount as number) > 1) {
      assert.equal(typeof exp.focusDecisive, 'boolean', 'focusDecisive in medium verbosity with runner-up');
      assert.equal(typeof exp.focusMargin, 'number', 'focusMargin in medium verbosity with runner-up');
    }
  } finally {
    await agg.shutdown();
  }
});

// ── 5. rationale branch: focus active but winner is out-of-focus (lines 2071-2072) ──

test('jjjj: cast rationale mentions out-of-focus when winner is not in the active focus (lines 2071-2072)', async () => {
  const { backend, configs, focusProfiles } = makeTwoServerFixture();
  const d = dlq('outoffocus');
  const coord = new KeywordCoord({}, { enabled: false }, d);
  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: d,
    suggestionsCatalog: {},
    coordinator: coord,
    // Focus on 'alpha' server, but we'll use an intent that makes 'beta' win
    focus: 'testfocus',
    focusProfiles,
  });
  try {
    // Intent specific to beta's tool description: 'neon database code review'
    // beta/list_projects scores high; alpha/list_invoices scores low
    // Even with alpha's focus boost, beta should win if the keyword gap is large enough.
    // Use verbosity='full' to get the full rationale string.
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'neon database code review projects',
      explain: true,
      verbosity: 'full',
      dryRun: true,
    });
    const data = JSON.parse(result.content[0].text as string) as Record<string, unknown>;
    const exp = data.explanation as Record<string, unknown> | undefined;
    assert.ok(exp !== undefined, 'explanation present');
    assert.equal(exp.focus, 'testfocus', 'focus active in explanation');
    // If beta wins (out-of-focus): winnerInFocus=false, rationale mentions "focus active; winner is out-of-focus"
    // If alpha wins (in-focus): winnerInFocus=true (different rationale branch; still valid coverage)
    // Either way, the test drives a cast with focus active → both rationale branches exercised across tests.
    assert.equal(typeof exp.winnerInFocus, 'boolean', 'winnerInFocus boolean in full verbosity with focus');
    if (exp.winnerInFocus === false) {
      // Line 2071-2072: the out-of-focus rationale branch
      assert.ok(
        typeof exp.rationale === 'string' && (exp.rationale as string).includes('out-of-focus'),
        `rationale mentions out-of-focus when winner is out-of-focus; got: ${exp.rationale}`,
      );
    } else {
      // alpha won — boosted in-focus winner; rationale mentions focus boost
      assert.ok(
        typeof exp.rationale === 'string' && (exp.rationale as string).includes('boosted'),
        `rationale mentions boost when winner is in-focus; got: ${exp.rationale}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── 5b. Guaranteed out-of-focus winner: focus on an empty server ────────────
//
// To guarantee winnerInFocus=false, use a focus that references a server 'zz-empty'
// which has no tools in the fixture. All actual candidates come from 'alpha' and 'beta'
// (both out-of-focus). Lines 2071-2072 (rationale) are guaranteed to fire.

test('jjjj: rationale out-of-focus branch guaranteed (lines 2071-2072) — focus on empty server', async () => {
  const { backend, configs } = makeTwoServerFixture();
  const d = dlq('guaranteed-outoffocus');
  const coord = new KeywordCoord({}, { enabled: false }, d);
  // Focus on 'zz-empty' which has no fixture tools → all found tools are out-of-focus
  const focusProfiles: FocusProfiles = {
    profiles: {
      emptyfocus: { categories: [], servers: ['zz-empty'], boost: 0.5 },
    },
  };
  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: d,
    suggestionsCatalog: {},
    coordinator: coord,
    focus: 'emptyfocus',
    focusProfiles,
  });
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list invoices',
      explain: true,
      verbosity: 'full',
      dryRun: true,
    });
    const data = JSON.parse(result.content[0].text as string) as Record<string, unknown>;
    const exp = data.explanation as Record<string, unknown> | undefined;
    assert.ok(exp !== undefined, 'explanation present');
    if (exp.winnerInFocus !== undefined) {
      // A winner was found; it must be out-of-focus (no tools on 'zz-empty')
      assert.equal(exp.winnerInFocus, false, 'winner must be out-of-focus (no in-focus tools exist)');
      // Lines 2071-2072: rationale must include the out-of-focus qualifier
      assert.ok(
        typeof exp.rationale === 'string' && (exp.rationale as string).includes('out-of-focus'),
        `rationale must mention out-of-focus; got: ${exp.rationale}`,
      );
    }
    // Focus name appears in explanation regardless
    assert.equal(exp.focus, 'emptyfocus', 'focus name present even with all-out-of-focus candidates');
  } finally {
    await agg.shutdown();
  }
});

// ── 6. verbosity='medium' + out-of-focus winner + non-zero margin ───────────
//
// Covers:
//  - Lines 2136-2137: `winnerInFocus ? focusBoost : 0` FALSE branches (winnerInFocus=false)
//  - Lines 2148, 2152: same ternary false branches in the runner-up block
//  - Line 2151: `if (margin !== 0)` TRUE branch — existing test-4 only hits margin=0
//
// Setup: focus on 'emptyfocus' (no matching tools → all candidates out-of-focus) so
// winnerInFocus is always false. Intent 'list invoices' matches list_invoices (score 1.0)
// and list_projects (score 0.5, only "list" matches) so both survive the >0.1 filter and
// margin = 1.0 - 0.5 = 0.5 ≠ 0.

test('jjjj: cast explain verbosity=medium with out-of-focus winner + non-zero margin covers winnerInFocus=false branches (lines 2136-2137,2148,2151-2152)', async () => {
  const { backend, configs } = makeTwoServerFixture();
  const d = dlq('medium-outoffocus-margin');
  const coord = new KeywordCoord({}, { enabled: false }, d);
  const focusProfiles: FocusProfiles = {
    profiles: {
      emptyfocus: { categories: [], servers: ['zz-empty'], boost: 0.5 },
    },
  };
  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: d,
    suggestionsCatalog: {},
    coordinator: coord,
    focus: 'emptyfocus',
    focusProfiles,
  });
  try {
    // 'list invoices': list_invoices scores 1.0 (both keywords match), list_projects
    // scores 0.5 (only "list" matches). Neither is in 'emptyfocus' (zz-empty has no
    // fixture tools) → winnerInFocus=false → false branch of winnerInFocus? ternaries.
    // margin = 1.0 - 0.5 = 0.5 ≠ 0 → if (margin !== 0) TRUE → line 2152 executes.
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list invoices',
      explain: true,
      verbosity: 'medium',
      dryRun: true,
    });
    const data = JSON.parse(result.content[0].text as string) as Record<string, unknown>;
    const exp = data.explanation as Record<string, unknown> | undefined;
    assert.ok(exp !== undefined, 'explanation present');
    assert.equal(exp.focus, 'emptyfocus', 'focus name in explanation');
    assert.equal(exp.winnerInFocus, false, 'winner is out-of-focus (zz-empty has no fixture tools)');
    // winnerFocusBoost = winnerInFocus ? focusBoost : 0 = 0 (false branch, line 2136)
    assert.equal(exp.winnerFocusBoost, 0, 'winnerFocusBoost is 0 for out-of-focus winner');
    // Runner-up must be present (list_invoices + list_projects both score > 0.1)
    assert.equal(typeof exp.focusMargin, 'number', 'focusMargin set when runner-up present');
    // margin ≠ 0 → focusConfidence is set (line 2152)
    if ((exp.focusMargin as number) !== 0) {
      assert.equal(typeof exp.focusConfidence, 'number', 'focusConfidence set when margin !== 0 (line 2152)');
    }
  } finally {
    await agg.shutdown();
  }
});

// ── 7. verbosity='low' + out-of-focus winner + runner-up (line 2101) ────────
//
// Line 2101: `(winnerInFocus ? focusBoost : 0)` FALSE branch in the low verbosity focus
// block — fires when winner is out of focus. Same emptyfocus + 'list invoices' approach.

test('jjjj: cast explain verbosity=low with out-of-focus winner + runner-up covers winnerInFocus=false ternary (line 2101)', async () => {
  const { backend, configs } = makeTwoServerFixture();
  const d = dlq('low-outoffocus-margin');
  const coord = new KeywordCoord({}, { enabled: false }, d);
  const focusProfiles: FocusProfiles = {
    profiles: {
      emptyfocus: { categories: [], servers: ['zz-empty'], boost: 0.5 },
    },
  };
  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: d,
    suggestionsCatalog: {},
    coordinator: coord,
    focus: 'emptyfocus',
    focusProfiles,
  });
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list invoices',
      explain: true,
      verbosity: 'low',
      dryRun: true,
    });
    const data = JSON.parse(result.content[0].text as string) as Record<string, unknown>;
    const exp = data.explanation as Record<string, unknown> | undefined;
    assert.ok(exp !== undefined, 'explanation present');
    assert.equal(exp.focus, 'emptyfocus', 'focus name in low verbosity explanation');
    assert.equal(exp.winnerInFocus, false, 'winner out-of-focus (zz-empty has no fixture tools)');
    // focusDecisive in low verbosity uses `(winnerInFocus ? focusBoost : 0)` — false branch now covered
    assert.equal(typeof exp.focusDecisive, 'boolean', 'focusDecisive present when runner-up exists (line 2101)');
  } finally {
    await agg.shutdown();
  }
});

// ── 8. brainMs truthy in verbosity='low' and 'medium' (lines 2087, 2114) ───
//
// Lines 2087 and 2114: `if (brainMs !== undefined) r.brainMs = brainMs;` in the low
// and medium verbosity blocks. BrainCoord returns a result → castRoute='brain' → brainMs
// is set. These lines are only covered in verbosity='full' by the rrrr tests.

test('jjjj: brain-route cast + verbosity=low covers brainMs truthy branch (line 2087)', async () => {
  const { backend, configs } = makeTwoServerFixture();
  const d = dlq('low-brain-ms');
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
      intent: 'list',
      explain: true,
      verbosity: 'low',
      dryRun: true,
    });
    const data = JSON.parse(result.content[0].text as string) as Record<string, unknown>;
    const exp = data.explanation as Record<string, unknown> | undefined;
    assert.ok(exp !== undefined, 'explanation present');
    // BrainCoord always routes via brain when candidates exist; assert unconditionally.
    assert.equal(exp.method, 'brain', 'BrainCoord always produces brain route');
    assert.equal(typeof exp.brainMs, 'number', 'brainMs present in low verbosity when brain-routed (line 2087)');
  } finally {
    await agg.shutdown();
  }
});

test('jjjj: brain-route cast + verbosity=medium covers brainMs truthy branch (line 2114)', async () => {
  const { backend, configs } = makeTwoServerFixture();
  const d = dlq('medium-brain-ms');
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
      intent: 'list',
      explain: true,
      verbosity: 'medium',
      dryRun: true,
    });
    const data = JSON.parse(result.content[0].text as string) as Record<string, unknown>;
    const exp = data.explanation as Record<string, unknown> | undefined;
    assert.ok(exp !== undefined, 'explanation present');
    // BrainCoord always routes via brain when candidates exist; assert unconditionally.
    assert.equal(exp.method, 'brain', 'BrainCoord always produces brain route');
    assert.equal(typeof exp.brainMs, 'number', 'brainMs present in medium verbosity when brain-routed (line 2114)');
  } finally {
    await agg.shutdown();
  }
});
