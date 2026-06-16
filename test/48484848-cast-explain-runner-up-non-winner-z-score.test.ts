/**
 * 48484848: explanation.runnerUpNonWinnerZScore in ch1tty/cast when explain:true.
 *
 * runnerUpNonWinnerZScore: number — z-score of the runner-up within the non-winner pool:
 * (runnerUpScore - candidateScoreNonWinnerMean) / candidateScoreNonWinnerStdDev.
 *
 * Present when: >= 3 candidates and candidateScoreNonWinnerStdDev > 0.
 * Absent when: no_match, < 3 candidates, or nonWinnerStdDev === 0.
 * Always >= 0: runnerUp is the highest non-winner, so runnerUpScore >= nonWinnerMean.
 * For n=3: always equals 1 (2-element pool symmetry gives z-scores of +1 and -1).
 * Identity: runnerUpNonWinnerZScore * nonWinnerStdDev === runnerUpScore - nonWinnerMean.
 * Always <= winnerNonWinnerZScore (winner scores higher than runner-up, same denominator).
 *
 * Covered:
 *   48484848-1: present when >= 3 candidates and nonWinnerStdDev > 0
 *   48484848-2: always finite and >= 0 when present
 *   48484848-3: identity — runnerUpNonWinnerZScore * nonWinnerStdDev === runnerUpScore - nonWinnerMean
 *   48484848-4: for n=3 always equals 1
 *   48484848-5: absent on cast:no_match
 *   48484848-6: absent when fewer than 3 candidates
 *   48484848-7: always <= winnerNonWinnerZScore when both present
 *   48484848-8: tool description documents runnerUpNonWinnerZScore
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-48484848-${label}-${Date.now()}.jsonl`);
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

test('48484848-1: present when >= 3 candidates and nonWinnerStdDev > 0', async () => {
  const agg = buildAgg('www1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3 && explanation.candidateScoreNonWinnerStdDev >= 1e-10) {
      assert.ok('runnerUpNonWinnerZScore' in explanation,
        `runnerUpNonWinnerZScore should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.runnerUpNonWinnerZScore, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('48484848-2: always finite and >= 0 when present', async () => {
  const agg = buildAgg('www2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpNonWinnerZScore' in explanation) {
      assert.ok(
        Number.isFinite(explanation.runnerUpNonWinnerZScore),
        `should be finite, got ${explanation.runnerUpNonWinnerZScore}`,
      );
      assert.ok(
        explanation.runnerUpNonWinnerZScore >= -1e-9,
        `should be >= 0, got ${explanation.runnerUpNonWinnerZScore}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('48484848-3: identity — runnerUpNonWinnerZScore * nonWinnerStdDev === runnerUpScore - nonWinnerMean', async () => {
  const agg = buildAgg('www3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpNonWinnerZScore' in explanation &&
        'candidateScoreNonWinnerStdDev' in explanation &&
        'runnerUpScore' in explanation &&
        'candidateScoreNonWinnerMean' in explanation) {
      const product = explanation.runnerUpNonWinnerZScore * explanation.candidateScoreNonWinnerStdDev;
      const expected = explanation.runnerUpScore - explanation.candidateScoreNonWinnerMean;
      assert.ok(
        Math.abs(product - expected) < 1e-9,
        `runnerUpNonWinnerZScore * nonWinnerStdDev (${product}) should equal runnerUpScore - nonWinnerMean (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('48484848-4: for n=3 always equals 1', async () => {
  const agg = buildAgg('www4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpNonWinnerZScore' in explanation &&
        'runnerUpThirdGap' in explanation &&
        explanation.candidateCount === 3 &&
        explanation.runnerUpThirdGap > 0) {
      assert.ok(
        Math.abs(explanation.runnerUpNonWinnerZScore - 1) < 1e-9,
        `for n=3 with distinct non-winner scores, runnerUpNonWinnerZScore (${explanation.runnerUpNonWinnerZScore}) should equal 1`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('48484848-5: absent on cast:no_match', async () => {
  const path = dlqPath('www5');
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
      !('runnerUpNonWinnerZScore' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.runnerUpNonWinnerZScore}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('48484848-6: absent when fewer than 3 candidates', async () => {
  const path = dlqPath('www6');
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
        !('runnerUpNonWinnerZScore' in explanation),
        `should be absent with < 3 candidates, found: ${explanation.runnerUpNonWinnerZScore}`,
      );
    }
  } finally {
    await twoAgg.shutdown();
  }
});

test('48484848-7: always <= winnerNonWinnerZScore when both present', async () => {
  const agg = buildAgg('www7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpNonWinnerZScore' in explanation && 'winnerNonWinnerZScore' in explanation) {
      assert.ok(
        explanation.runnerUpNonWinnerZScore <= explanation.winnerNonWinnerZScore + 1e-9,
        `runnerUpNonWinnerZScore (${explanation.runnerUpNonWinnerZScore}) should be <= winnerNonWinnerZScore (${explanation.winnerNonWinnerZScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('48484848-8: tool description documents runnerUpNonWinnerZScore', async () => {
  const path = dlqPath('www8');
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
      cast.description?.includes('runnerUpNonWinnerZScore'),
      `cast description should mention runnerUpNonWinnerZScore, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
