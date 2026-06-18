/**
 * 47474747: explanation.nonWinnerMeanZScore in ch1tty/cast when explain:true.
 *
 * nonWinnerMeanZScore: number — z-score of the non-winner mean in the full candidate distribution:
 * (candidateScoreNonWinnerMean - candidateScoreMean) / candidateScoreStdDev.
 *
 * Present when: >= 2 candidates and candidateScoreStdDev > 0.
 * Absent when: no_match, single candidate, or stdDev === 0.
 * Always <= 0: nonWinnerMean <= overall mean (winner excluded, pulling pool below mean).
 * Key: nonWinnerMeanZScore * (candidateCount - 1) + winnerScoreZScore === 0.
 * For n=2: nonWinnerMeanZScore === runnerUpScoreZScore === -winnerScoreZScore.
 * Identity: nonWinnerMeanZScore * candidateScoreStdDev === candidateScoreNonWinnerMean - candidateScoreMean.
 *
 * Covered:
 *   47474747-1: present when >= 2 candidates and stdDev > 0
 *   47474747-2: always finite and <= 0 when present
 *   47474747-3: identity — nonWinnerMeanZScore * stdDev === nonWinnerMean - mean
 *   47474747-4: key relationship — nonWinnerMeanZScore * (n-1) + winnerScoreZScore === 0
 *   47474747-5: absent on cast:no_match
 *   47474747-6: absent when single candidate
 *   47474747-7: for n=2 equals runnerUpScoreZScore
 *   47474747-8: tool description documents nonWinnerMeanZScore
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-47474747-${label}-${Date.now()}.jsonl`);
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

test('47474747-1: present when >= 2 candidates and stdDev > 0', async () => {
  const agg = buildAgg('vvv1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 2 && explanation.candidateScoreStdDev > 0) {
      assert.ok('nonWinnerMeanZScore' in explanation,
        `nonWinnerMeanZScore should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.nonWinnerMeanZScore, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('47474747-2: always finite and <= 0 when present', async () => {
  const agg = buildAgg('vvv2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('nonWinnerMeanZScore' in explanation) {
      assert.ok(
        Number.isFinite(explanation.nonWinnerMeanZScore),
        `should be finite, got ${explanation.nonWinnerMeanZScore}`,
      );
      assert.ok(
        explanation.nonWinnerMeanZScore <= 1e-9,
        `should be <= 0, got ${explanation.nonWinnerMeanZScore}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('47474747-3: identity — nonWinnerMeanZScore * stdDev === nonWinnerMean - mean', async () => {
  const agg = buildAgg('vvv3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('nonWinnerMeanZScore' in explanation &&
        'candidateScoreStdDev' in explanation &&
        'candidateScoreNonWinnerMean' in explanation &&
        'candidateScoreMean' in explanation) {
      const product = explanation.nonWinnerMeanZScore * explanation.candidateScoreStdDev;
      const expected = explanation.candidateScoreNonWinnerMean - explanation.candidateScoreMean;
      assert.ok(
        Math.abs(product - expected) < 1e-9,
        `nonWinnerMeanZScore * stdDev (${product}) should equal nonWinnerMean - mean (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('47474747-4: key relationship — nonWinnerMeanZScore * (n-1) + winnerScoreZScore === 0', async () => {
  const agg = buildAgg('vvv4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('nonWinnerMeanZScore' in explanation &&
        'winnerScoreZScore' in explanation &&
        'candidateCount' in explanation) {
      const lhs = explanation.nonWinnerMeanZScore * (explanation.candidateCount - 1) + explanation.winnerScoreZScore;
      assert.ok(
        Math.abs(lhs) < 1e-9,
        `nonWinnerMeanZScore*(n-1) + winnerScoreZScore (${lhs}) should be 0`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('47474747-5: absent on cast:no_match', async () => {
  const path = dlqPath('vvv5');
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
      !('nonWinnerMeanZScore' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.nonWinnerMeanZScore}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('47474747-6: absent when single candidate', async () => {
  const path = dlqPath('vvv6');
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
        !('nonWinnerMeanZScore' in explanation),
        `should be absent with single candidate, found: ${explanation.nonWinnerMeanZScore}`,
      );
    }
  } finally {
    await singleAgg.shutdown();
  }
});

test('47474747-7: for n=2 equals runnerUpScoreZScore', async () => {
  const agg = buildAgg('vvv7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('nonWinnerMeanZScore' in explanation &&
        'runnerUpScoreZScore' in explanation &&
        explanation.candidateCount === 2) {
      assert.ok(
        Math.abs(explanation.nonWinnerMeanZScore - explanation.runnerUpScoreZScore) < 1e-9,
        `for n=2, nonWinnerMeanZScore (${explanation.nonWinnerMeanZScore}) should equal runnerUpScoreZScore (${explanation.runnerUpScoreZScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('47474747-8: tool description documents nonWinnerMeanZScore', async () => {
  const path = dlqPath('vvv8');
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
      cast.description?.includes('nonWinnerMeanZScore'),
      `cast description should mention nonWinnerMeanZScore, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
