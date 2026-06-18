/**
 * 64646464: explanation.candidateScoreNonWinnerMidRange in ch1tty/cast when explain:true.
 *
 * candidateScoreNonWinnerMidRange: number — midpoint between highest and lowest non-winner scores:
 * (runnerUpScore + lowestCandidateScore) / 2.
 *
 * Present when: >= 3 candidates, runnerUpScore > 0, and lowestCandidateScore > 0.
 * Absent when: no_match, < 3 candidates, or either boundary score is zero.
 * Always > 0.
 * Always in [lowestCandidateScore, runnerUpScore].
 * For n=3: equals candidateScoreNonWinnerMean.
 * Identity: 2 * candidateScoreNonWinnerMidRange === runnerUpScore + lowestCandidateScore.
 *
 * Covered:
 *   64646464-1: present when >= 3 candidates, runnerUpScore > 0, lowestScore > 0
 *   64646464-2: always finite and > 0
 *   64646464-3: identity — 2 * midRange === runnerUpScore + lowestCandidateScore
 *   64646464-4: for n=3 equals candidateScoreNonWinnerMean
 *   64646464-5: absent on cast:no_match
 *   64646464-6: absent when fewer than 3 candidates
 *   64646464-7: always in [lowestCandidateScore, runnerUpScore]
 *   64646464-8: tool description documents candidateScoreNonWinnerMidRange
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-64646464-${label}-${Date.now()}.jsonl`);
}

const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe Payments', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.test/mcp',
};
const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.test/mcp',
};
const LINEAR_CFG: ServerConfig = {
  id: 'linear', name: 'Linear', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://linear.test/mcp',
};

function makeBackend(tools: ToolEntry[]): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: tools.length, toolCacheAge: 0 }),
    listTools: async () => tools,
    callTool: async (): Promise<ToolCallResult> => ({ content: [{ type: 'text', text: 'ok' }] }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

class FallbackCoordinator extends SessionCoordinator {
  constructor(dlq?: string) { super({}, { enabled: false }, dlq); }
  override async routeIntent(): Promise<null> { return null; }
}

function buildAgg(label: string, configs: ServerConfig[], toolMap: Record<string, ToolEntry[]>): Aggregator {
  const path = dlqPath(label);
  return new Aggregator(configs, {
    backendFactory: (cfg) => makeBackend(toolMap[cfg.id] ?? []),
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
  });
}

const stripeTools: ToolEntry[] = [
  { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
];
const neonTools: ToolEntry[] = [
  { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
];
const linearTools: ToolEntry[] = [
  { name: 'create_issue', description: 'billing issue tracking project', inputSchema: { type: 'object', properties: {} } },
];

test('64646464-1: present when >= 3 candidates, runnerUpScore > 0, lowestScore > 0', async () => {
  const agg = buildAgg('mmm1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3 && explanation.runnerUpScore > 0 && explanation.lowestCandidateScore > 0) {
      assert.ok('candidateScoreNonWinnerMidRange' in explanation,
        `candidateScoreNonWinnerMidRange should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreNonWinnerMidRange, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('64646464-2: always finite and > 0', async () => {
  const agg = buildAgg('mmm2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerMidRange' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreNonWinnerMidRange),
        `should be finite, got ${explanation.candidateScoreNonWinnerMidRange}`,
      );
      assert.ok(
        explanation.candidateScoreNonWinnerMidRange > 0,
        `should be > 0, got ${explanation.candidateScoreNonWinnerMidRange}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('64646464-3: identity — 2 * midRange === runnerUpScore + lowestCandidateScore', async () => {
  const agg = buildAgg('mmm3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerMidRange' in explanation &&
        'runnerUpScore' in explanation &&
        'lowestCandidateScore' in explanation) {
      const sum = explanation.runnerUpScore + explanation.lowestCandidateScore;
      assert.ok(
        Math.abs(2 * explanation.candidateScoreNonWinnerMidRange - sum) < 1e-9,
        `2 * midRange (${2 * explanation.candidateScoreNonWinnerMidRange}) should equal runnerUpScore + lowestScore (${sum})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('64646464-4: for n=3 equals candidateScoreNonWinnerMean', async () => {
  const agg = buildAgg('mmm4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerMidRange' in explanation &&
        'candidateScoreNonWinnerMean' in explanation &&
        explanation.candidateCount === 3) {
      assert.ok(
        Math.abs(explanation.candidateScoreNonWinnerMidRange - explanation.candidateScoreNonWinnerMean) < 1e-9,
        `for n=3, candidateScoreNonWinnerMidRange (${explanation.candidateScoreNonWinnerMidRange}) should equal candidateScoreNonWinnerMean (${explanation.candidateScoreNonWinnerMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('64646464-5: absent on cast:no_match', async () => {
  const path = dlqPath('mmm5');
  const emptyAgg = new Aggregator([STRIPE_CFG], {
    backendFactory: () => makeBackend([]),
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
  });
  try {
    const r = await emptyAgg.callTool('ch1tty/cast', { intent: 'xyzzy-nonexistent', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'no_match', `expected no_match, got ${parsed.cast}`);
    assert.ok(
      !('candidateScoreNonWinnerMidRange' in parsed.explanation),
      `should be absent on no_match`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('64646464-6: absent when fewer than 3 candidates', async () => {
  const path = dlqPath('mmm6');
  const twoAgg = new Aggregator([STRIPE_CFG, NEON_CFG], {
    backendFactory: (cfg) => makeBackend(cfg.id === 'stripe' ? stripeTools : neonTools),
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
  });
  try {
    const r = await twoAgg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if (explanation.candidateCount < 3) {
      assert.ok(
        !('candidateScoreNonWinnerMidRange' in explanation),
        `should be absent with < 3 candidates`,
      );
    }
  } finally {
    await twoAgg.shutdown();
  }
});

test('64646464-7: always in [lowestCandidateScore, runnerUpScore]', async () => {
  const agg = buildAgg('mmm7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerMidRange' in explanation &&
        'lowestCandidateScore' in explanation &&
        'runnerUpScore' in explanation) {
      assert.ok(
        explanation.candidateScoreNonWinnerMidRange >= explanation.lowestCandidateScore - 1e-9,
        `midRange (${explanation.candidateScoreNonWinnerMidRange}) should be >= lowestCandidateScore (${explanation.lowestCandidateScore})`,
      );
      assert.ok(
        explanation.candidateScoreNonWinnerMidRange <= explanation.runnerUpScore + 1e-9,
        `midRange (${explanation.candidateScoreNonWinnerMidRange}) should be <= runnerUpScore (${explanation.runnerUpScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('64646464-8: tool description documents candidateScoreNonWinnerMidRange', async () => {
  const path = dlqPath('mmm8');
  const agg = new Aggregator([STRIPE_CFG], {
    backendFactory: () => makeBackend([]),
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
  });
  try {
    const { tools } = await agg.listAllTools();
    const cast = tools.find((t) => t.name === 'ch1tty/cast');
    assert.ok(cast, 'ch1tty/cast tool not found');
    assert.ok(
      cast.description?.includes('candidateScoreNonWinnerMidRange'),
      `cast description should mention candidateScoreNonWinnerMidRange, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
