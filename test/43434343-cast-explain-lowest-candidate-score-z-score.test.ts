/**
 * 43434343: explanation.lowestCandidateScoreZScore in ch1tty/cast when explain:true.
 *
 * lowestCandidateScoreZScore: number — z-score of the lowest-scoring candidate:
 * (lowestCandidateScore - candidateScoreMean) / candidateScoreStdDev.
 *
 * Present when: >= 2 candidates and candidateScoreStdDev > 0.
 * Absent when: no_match, single candidate, or stdDev === 0.
 * Always <= 0: the lowest score is always <= mean when stdDev > 0.
 * Always <= runnerUpScoreZScore: lowestCandidateScore <= runnerUpScore.
 * For n=2: lowestCandidateScoreZScore === -winnerScoreZScore (z-scores sum to 0).
 * For n=3: lowestCandidateScoreZScore === thirdCandidateScoreZScore.
 * Identity: lowestCandidateScoreZScore * candidateScoreStdDev === lowestCandidateScore - candidateScoreMean.
 *
 * Covered:
 *   43434343-1: present when >= 2 candidates and stdDev > 0
 *   43434343-2: always finite and <= 0 when present
 *   43434343-3: always <= runnerUpScoreZScore when both present
 *   43434343-4: for n=2 equals -winnerScoreZScore
 *   43434343-5: absent on cast:no_match
 *   43434343-6: absent when single candidate (stdDev === 0 guard)
 *   43434343-7: identity — lowestCandidateScoreZScore * stdDev === lowestCandidateScore - mean
 *   43434343-8: tool description documents lowestCandidateScoreZScore
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-43434343-${label}-${Date.now()}.jsonl`);
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

test('43434343-1: present when >= 2 candidates and stdDev > 0', async () => {
  const agg = buildAgg('rrr1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 2 && explanation.candidateScoreStdDev > 0) {
      assert.ok('lowestCandidateScoreZScore' in explanation,
        `lowestCandidateScoreZScore should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.lowestCandidateScoreZScore, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('43434343-2: always finite and <= 0 when present', async () => {
  const agg = buildAgg('rrr2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('lowestCandidateScoreZScore' in explanation) {
      assert.ok(
        Number.isFinite(explanation.lowestCandidateScoreZScore),
        `should be finite, got ${explanation.lowestCandidateScoreZScore}`,
      );
      assert.ok(
        explanation.lowestCandidateScoreZScore <= 1e-9,
        `should be <= 0, got ${explanation.lowestCandidateScoreZScore}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('43434343-3: always <= runnerUpScoreZScore when both present', async () => {
  const agg = buildAgg('rrr3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('lowestCandidateScoreZScore' in explanation && 'runnerUpScoreZScore' in explanation) {
      assert.ok(
        explanation.lowestCandidateScoreZScore <= explanation.runnerUpScoreZScore + 1e-9,
        `lowestCandidateScoreZScore (${explanation.lowestCandidateScoreZScore}) should be <= runnerUpScoreZScore (${explanation.runnerUpScoreZScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('43434343-4: for n=2 lowestCandidateScoreZScore === -winnerScoreZScore', async () => {
  const agg = buildAgg('rrr4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('lowestCandidateScoreZScore' in explanation && 'winnerScoreZScore' in explanation &&
        explanation.candidateCount === 2) {
      assert.ok(
        Math.abs(explanation.lowestCandidateScoreZScore + explanation.winnerScoreZScore) < 1e-9,
        `lowestCandidateScoreZScore (${explanation.lowestCandidateScoreZScore}) should equal -winnerScoreZScore (${-explanation.winnerScoreZScore}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('43434343-5: absent on cast:no_match', async () => {
  const path = dlqPath('rrr5');
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
      !('lowestCandidateScoreZScore' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.lowestCandidateScoreZScore}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('43434343-6: absent when single candidate (stdDev === 0 guard)', async () => {
  const path = dlqPath('rrr6');
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
    if (explanation.candidateCount <= 1 || explanation.candidateScoreStdDev === 0) {
      assert.ok(
        !('lowestCandidateScoreZScore' in explanation),
        `should be absent when stdDev === 0 or single candidate, found: ${explanation.lowestCandidateScoreZScore}`,
      );
    }
  } finally {
    await singleAgg.shutdown();
  }
});

test('43434343-7: identity — lowestCandidateScoreZScore * stdDev === lowestCandidateScore - mean', async () => {
  const agg = buildAgg('rrr7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('lowestCandidateScoreZScore' in explanation &&
        'candidateScoreStdDev' in explanation &&
        'lowestCandidateScore' in explanation &&
        'candidateScoreMean' in explanation) {
      const product = explanation.lowestCandidateScoreZScore * explanation.candidateScoreStdDev;
      const expected = explanation.lowestCandidateScore - explanation.candidateScoreMean;
      assert.ok(
        Math.abs(product - expected) < 1e-9,
        `lowestCandidateScoreZScore * stdDev (${product}) should equal lowestCandidateScore - mean (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('43434343-8: tool description documents lowestCandidateScoreZScore', async () => {
  const path = dlqPath('rrr8');
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
      cast.description?.includes('lowestCandidateScoreZScore'),
      `cast description should mention lowestCandidateScoreZScore, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
