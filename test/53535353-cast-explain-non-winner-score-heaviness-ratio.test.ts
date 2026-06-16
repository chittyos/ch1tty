/**
 * 53535353: explanation.nonWinnerScoreHeavinessRatio in ch1tty/cast when explain:true.
 *
 * nonWinnerScoreHeavinessRatio: number — fraction of total score mass in the non-winner pool:
 * (candidateScoreEntropyTotal - winnerScore) / candidateScoreEntropyTotal.
 *
 * Present when: >= 2 candidates and candidateScoreEntropyTotal > 0.
 * Absent when: no_match, single candidate, or all scores zero.
 * Always in (0, 1).
 * Complementary: nonWinnerScoreHeavinessRatio + scoreDominanceIndex === 1.
 * Mass identity: ratio * total === (n-1) * candidateScoreNonWinnerMean.
 * For n=2: equals runnerUpScore / candidateScoreEntropyTotal.
 *
 * Covered:
 *   53535353-1: present when >= 2 candidates and total > 0
 *   53535353-2: always finite and in (0, 1)
 *   53535353-3: complementary — ratio + scoreDominanceIndex === 1
 *   53535353-4: mass identity — ratio * total === (n-1) * nonWinnerMean
 *   53535353-5: absent on cast:no_match
 *   53535353-6: absent when single candidate
 *   53535353-7: for n=2 equals runnerUpScore / candidateScoreEntropyTotal
 *   53535353-8: tool description documents nonWinnerScoreHeavinessRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-53535353-${label}-${Date.now()}.jsonl`);
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

test('53535353-1: present when >= 2 candidates and total > 0', async () => {
  const agg = buildAgg('bbb1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 2 && explanation.winnerScore > 0) {
      assert.ok('nonWinnerScoreHeavinessRatio' in explanation,
        `nonWinnerScoreHeavinessRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.nonWinnerScoreHeavinessRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('53535353-2: always finite and in (0, 1)', async () => {
  const agg = buildAgg('bbb2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('nonWinnerScoreHeavinessRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.nonWinnerScoreHeavinessRatio),
        `should be finite, got ${explanation.nonWinnerScoreHeavinessRatio}`,
      );
      assert.ok(
        explanation.nonWinnerScoreHeavinessRatio > 0,
        `should be > 0, got ${explanation.nonWinnerScoreHeavinessRatio}`,
      );
      assert.ok(
        explanation.nonWinnerScoreHeavinessRatio < 1,
        `should be < 1, got ${explanation.nonWinnerScoreHeavinessRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('53535353-3: complementary — nonWinnerScoreHeavinessRatio + scoreDominanceIndex === 1', async () => {
  const agg = buildAgg('bbb3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('nonWinnerScoreHeavinessRatio' in explanation && 'scoreDominanceIndex' in explanation) {
      const sum = explanation.nonWinnerScoreHeavinessRatio + explanation.scoreDominanceIndex;
      assert.ok(
        Math.abs(sum - 1) < 1e-9,
        `nonWinnerScoreHeavinessRatio (${explanation.nonWinnerScoreHeavinessRatio}) + scoreDominanceIndex (${explanation.scoreDominanceIndex}) = ${sum}, should equal 1`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('53535353-4: mass identity — ratio * total === (n-1) * nonWinnerMean', async () => {
  const agg = buildAgg('bbb4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('nonWinnerScoreHeavinessRatio' in explanation &&
        'candidateScoreMean' in explanation &&
        'candidateScoreNonWinnerMean' in explanation &&
        'candidateCount' in explanation) {
      const total = explanation.candidateScoreMean * explanation.candidateCount;
      const lhs = explanation.nonWinnerScoreHeavinessRatio * total;
      const rhs = (explanation.candidateCount - 1) * explanation.candidateScoreNonWinnerMean;
      assert.ok(
        Math.abs(lhs - rhs) < 1e-9,
        `ratio * total (${lhs}) should equal (n-1) * nonWinnerMean (${rhs})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('53535353-5: absent on cast:no_match', async () => {
  const path = dlqPath('bbb5');
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
      !('nonWinnerScoreHeavinessRatio' in parsed.explanation),
      `should be absent on no_match`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('53535353-6: absent when single candidate', async () => {
  const path = dlqPath('bbb6');
  const singleAgg = new Aggregator([STRIPE_CFG], {
    backendFactory: () => makeBackend([stripeTools[0]]),
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
  });
  try {
    const r = await singleAgg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if (explanation.candidateCount <= 1) {
      assert.ok(
        !('nonWinnerScoreHeavinessRatio' in explanation),
        `should be absent with single candidate, found: ${explanation.nonWinnerScoreHeavinessRatio}`,
      );
    }
  } finally {
    await singleAgg.shutdown();
  }
});

test('53535353-7: for n=2 equals runnerUpScore / candidateScoreEntropyTotal', async () => {
  const agg = buildAgg('bbb7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('nonWinnerScoreHeavinessRatio' in explanation &&
        'runnerUpScore' in explanation &&
        'candidateScoreMean' in explanation &&
        'candidateCount' in explanation &&
        explanation.candidateCount === 2) {
      const total = explanation.candidateScoreMean * explanation.candidateCount;
      const expected = explanation.runnerUpScore / total;
      assert.ok(
        Math.abs(explanation.nonWinnerScoreHeavinessRatio - expected) < 1e-9,
        `for n=2, nonWinnerScoreHeavinessRatio (${explanation.nonWinnerScoreHeavinessRatio}) should equal runnerUpScore/total (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('53535353-8: tool description documents nonWinnerScoreHeavinessRatio', async () => {
  const path = dlqPath('bbb8');
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
      cast.description?.includes('nonWinnerScoreHeavinessRatio'),
      `cast description should mention nonWinnerScoreHeavinessRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
