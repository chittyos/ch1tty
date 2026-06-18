/**
 * 67676767: explanation.candidateScoreNonWinnerMeanToMidRangeRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreNonWinnerMeanToMidRangeRatio: number — ratio of non-winner mean to non-winner midrange:
 * candidateScoreNonWinnerMean / candidateScoreNonWinnerMidRange.
 *
 * Present when: >= 3 candidates, runnerUpScore > 0, lowestCandidateScore > 0.
 * Absent when: no_match, < 3 candidates, or either boundary score is zero.
 * Always > 0.
 * For n=3: equals 1 (mean === midrange for two-element sets).
 * > 1 when non-winner distribution is skewed toward higher scores.
 * < 1 when non-winner distribution is skewed toward lower scores.
 * Identity: ratio * candidateScoreNonWinnerMidRange === candidateScoreNonWinnerMean.
 *
 * Covered:
 *   67676767-1: present when >= 3 candidates, runnerUpScore > 0, lowestCandidateScore > 0
 *   67676767-2: always finite and > 0
 *   67676767-3: identity — ratio * midRange === nonWinnerMean
 *   67676767-4: for n=3 equals 1
 *   67676767-5: absent on cast:no_match
 *   67676767-6: absent when fewer than 3 candidates
 *   67676767-7: consistent ordering with nonWinnerMean vs midRange
 *   67676767-8: tool description documents candidateScoreNonWinnerMeanToMidRangeRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-67676767-${label}-${Date.now()}.jsonl`);
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

test('67676767-1: present when >= 3 candidates, runnerUpScore > 0, lowestCandidateScore > 0', async () => {
  const agg = buildAgg('ppp1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3 && explanation.runnerUpScore > 0 && explanation.lowestCandidateScore > 0) {
      assert.ok('candidateScoreNonWinnerMeanToMidRangeRatio' in explanation,
        `candidateScoreNonWinnerMeanToMidRangeRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreNonWinnerMeanToMidRangeRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('67676767-2: always finite and > 0', async () => {
  const agg = buildAgg('ppp2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerMeanToMidRangeRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreNonWinnerMeanToMidRangeRatio),
        `should be finite, got ${explanation.candidateScoreNonWinnerMeanToMidRangeRatio}`,
      );
      assert.ok(
        explanation.candidateScoreNonWinnerMeanToMidRangeRatio > 0,
        `should be > 0, got ${explanation.candidateScoreNonWinnerMeanToMidRangeRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('67676767-3: identity — ratio * midRange === nonWinnerMean', async () => {
  const agg = buildAgg('ppp3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerMeanToMidRangeRatio' in explanation &&
        'candidateScoreNonWinnerMidRange' in explanation &&
        'candidateScoreNonWinnerMean' in explanation) {
      const product = explanation.candidateScoreNonWinnerMeanToMidRangeRatio * explanation.candidateScoreNonWinnerMidRange;
      assert.ok(
        Math.abs(product - explanation.candidateScoreNonWinnerMean) < 1e-9,
        `ratio * midRange (${product}) should equal nonWinnerMean (${explanation.candidateScoreNonWinnerMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('67676767-4: for n=3 equals 1', async () => {
  const agg = buildAgg('ppp4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerMeanToMidRangeRatio' in explanation &&
        explanation.candidateCount === 3) {
      assert.ok(
        Math.abs(explanation.candidateScoreNonWinnerMeanToMidRangeRatio - 1) < 1e-9,
        `for n=3, candidateScoreNonWinnerMeanToMidRangeRatio (${explanation.candidateScoreNonWinnerMeanToMidRangeRatio}) should equal 1`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('67676767-5: absent on cast:no_match', async () => {
  const path = dlqPath('ppp5');
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
      !('candidateScoreNonWinnerMeanToMidRangeRatio' in parsed.explanation),
      `should be absent on no_match`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('67676767-6: absent when fewer than 3 candidates', async () => {
  const path = dlqPath('ppp6');
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
        !('candidateScoreNonWinnerMeanToMidRangeRatio' in explanation),
        `should be absent with < 3 candidates`,
      );
    }
  } finally {
    await twoAgg.shutdown();
  }
});

test('67676767-7: ratio > 1 iff nonWinnerMean > midRange; ratio < 1 iff nonWinnerMean < midRange', async () => {
  const agg = buildAgg('ppp7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerMeanToMidRangeRatio' in explanation &&
        'candidateScoreNonWinnerMean' in explanation &&
        'candidateScoreNonWinnerMidRange' in explanation) {
      const ratio = explanation.candidateScoreNonWinnerMeanToMidRangeRatio;
      const mean = explanation.candidateScoreNonWinnerMean;
      const midRange = explanation.candidateScoreNonWinnerMidRange;
      if (mean > midRange + 1e-9) {
        assert.ok(ratio > 1, `ratio (${ratio}) should be > 1 when mean (${mean}) > midRange (${midRange})`);
      } else if (mean < midRange - 1e-9) {
        assert.ok(ratio < 1, `ratio (${ratio}) should be < 1 when mean (${mean}) < midRange (${midRange})`);
      } else {
        assert.ok(Math.abs(ratio - 1) < 1e-9, `ratio (${ratio}) should be ~1 when mean ~= midRange`);
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('67676767-8: tool description documents candidateScoreNonWinnerMeanToMidRangeRatio', async () => {
  const path = dlqPath('ppp8');
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
      cast.description?.includes('candidateScoreNonWinnerMeanToMidRangeRatio'),
      `cast description should mention candidateScoreNonWinnerMeanToMidRangeRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
