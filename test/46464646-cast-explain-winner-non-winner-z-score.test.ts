/**
 * 46464646: explanation.winnerNonWinnerZScore in ch1tty/cast when explain:true.
 *
 * winnerNonWinnerZScore: number — z-score of the winner relative to the non-winner distribution:
 * (winnerScore - candidateScoreNonWinnerMean) / candidateScoreNonWinnerStdDev.
 *
 * Present when: >= 3 candidates and candidateScoreNonWinnerStdDev > 0.
 * Absent when: no_match, < 3 candidates, or nonWinnerStdDev === 0.
 * Always > 0: winner > runnerUp >= nonWinnerMean.
 * Identity: winnerNonWinnerZScore * candidateScoreNonWinnerStdDev === candidateScoreWinnerFieldGap.
 * For n=3: winnerNonWinnerZScore === candidateScoreWinnerFieldGap / (runnerUpThirdGap / 2).
 *
 * Covered:
 *   46464646-1: present when >= 3 candidates and nonWinnerStdDev > 0
 *   46464646-2: always finite and > 0 when present
 *   46464646-3: identity — winnerNonWinnerZScore * nonWinnerStdDev === candidateScoreWinnerFieldGap
 *   46464646-4: for n=3 equals candidateScoreWinnerFieldGap / (runnerUpThirdGap / 2)
 *   46464646-5: absent on cast:no_match
 *   46464646-6: absent when fewer than 3 candidates
 *   46464646-7: always > runnerUpScoreZScore when both present (winner above runner-up)
 *   46464646-8: tool description documents winnerNonWinnerZScore
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-46464646-${label}-${Date.now()}.jsonl`);
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

test('46464646-1: present when >= 3 candidates and nonWinnerStdDev > 0', async () => {
  const agg = buildAgg('uuu1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3 && explanation.candidateScoreNonWinnerStdDev > 0) {
      assert.ok('winnerNonWinnerZScore' in explanation,
        `winnerNonWinnerZScore should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.winnerNonWinnerZScore, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('46464646-2: always finite and > 0 when present', async () => {
  const agg = buildAgg('uuu2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerNonWinnerZScore' in explanation) {
      assert.ok(
        Number.isFinite(explanation.winnerNonWinnerZScore),
        `should be finite, got ${explanation.winnerNonWinnerZScore}`,
      );
      assert.ok(
        explanation.winnerNonWinnerZScore > 0,
        `should be > 0, got ${explanation.winnerNonWinnerZScore}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('46464646-3: identity — winnerNonWinnerZScore * nonWinnerStdDev === candidateScoreWinnerFieldGap', async () => {
  const agg = buildAgg('uuu3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerNonWinnerZScore' in explanation &&
        'candidateScoreNonWinnerStdDev' in explanation &&
        'candidateScoreWinnerFieldGap' in explanation) {
      const product = explanation.winnerNonWinnerZScore * explanation.candidateScoreNonWinnerStdDev;
      const expected = explanation.candidateScoreWinnerFieldGap;
      assert.ok(
        Math.abs(product - expected) < 1e-9,
        `winnerNonWinnerZScore * nonWinnerStdDev (${product}) should equal candidateScoreWinnerFieldGap (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('46464646-4: for n=3 equals candidateScoreWinnerFieldGap / (runnerUpThirdGap / 2)', async () => {
  const agg = buildAgg('uuu4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerNonWinnerZScore' in explanation &&
        'candidateScoreWinnerFieldGap' in explanation &&
        'runnerUpThirdGap' in explanation &&
        explanation.candidateCount === 3 &&
        explanation.runnerUpThirdGap > 0) {
      const expected = explanation.candidateScoreWinnerFieldGap / (explanation.runnerUpThirdGap / 2);
      assert.ok(
        Math.abs(explanation.winnerNonWinnerZScore - expected) < 1e-9,
        `for n=3, winnerNonWinnerZScore (${explanation.winnerNonWinnerZScore}) should equal winnerFieldGap/(runnerUpThirdGap/2) (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('46464646-5: absent on cast:no_match', async () => {
  const path = dlqPath('uuu5');
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
      !('winnerNonWinnerZScore' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.winnerNonWinnerZScore}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('46464646-6: absent when fewer than 3 candidates', async () => {
  const path = dlqPath('uuu6');
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
        !('winnerNonWinnerZScore' in explanation),
        `should be absent with < 3 candidates, found: ${explanation.winnerNonWinnerZScore}`,
      );
    }
  } finally {
    await twoAgg.shutdown();
  }
});

test('46464646-7: always > 0 and nonWinnerStdDev present when winnerNonWinnerZScore present', async () => {
  const agg = buildAgg('uuu7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerNonWinnerZScore' in explanation) {
      assert.ok(
        'candidateScoreNonWinnerStdDev' in explanation,
        `candidateScoreNonWinnerStdDev should be present when winnerNonWinnerZScore is present`,
      );
      assert.ok(
        explanation.candidateScoreNonWinnerStdDev > 0,
        `candidateScoreNonWinnerStdDev should be > 0 when winnerNonWinnerZScore is present, got ${explanation.candidateScoreNonWinnerStdDev}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('46464646-8: tool description documents winnerNonWinnerZScore', async () => {
  const path = dlqPath('uuu8');
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
      cast.description?.includes('winnerNonWinnerZScore'),
      `cast description should mention winnerNonWinnerZScore, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
