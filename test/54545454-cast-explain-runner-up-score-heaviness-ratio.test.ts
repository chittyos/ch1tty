/**
 * 54545454: explanation.runnerUpScoreHeavinessRatio in ch1tty/cast when explain:true.
 *
 * runnerUpScoreHeavinessRatio: number — runner-up score as fraction of total score mass:
 * runnerUpScore / candidateScoreEntropyTotal.
 *
 * Present when: >= 2 candidates, total > 0, and runnerUpScore > 0.
 * Absent when: no_match, single candidate, zero total, or zero runner-up score.
 * Always in (0, 1).
 * For n=2: equals nonWinnerScoreHeavinessRatio.
 * Always <= nonWinnerScoreHeavinessRatio.
 * Identity: ratio * total === runnerUpScore.
 *
 * Covered:
 *   54545454-1: present when >= 2 candidates, total > 0, and runnerUpScore > 0
 *   54545454-2: always finite and in (0, 1)
 *   54545454-3: identity — ratio * total === runnerUpScore
 *   54545454-4: for n=2 equals nonWinnerScoreHeavinessRatio
 *   54545454-5: absent on cast:no_match
 *   54545454-6: absent when single candidate
 *   54545454-7: always <= nonWinnerScoreHeavinessRatio
 *   54545454-8: tool description documents runnerUpScoreHeavinessRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-54545454-${label}-${Date.now()}.jsonl`);
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

test('54545454-1: present when >= 2 candidates, total > 0, and runnerUpScore > 0', async () => {
  const agg = buildAgg('ccc1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    const total = explanation.candidateScoreMean * explanation.candidateCount;
    if (explanation.candidateCount >= 2 && total > 0 && explanation.runnerUpScore > 0) {
      assert.ok('runnerUpScoreHeavinessRatio' in explanation,
        `runnerUpScoreHeavinessRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.runnerUpScoreHeavinessRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('54545454-2: always finite and in (0, 1)', async () => {
  const agg = buildAgg('ccc2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreHeavinessRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.runnerUpScoreHeavinessRatio),
        `should be finite, got ${explanation.runnerUpScoreHeavinessRatio}`,
      );
      assert.ok(
        explanation.runnerUpScoreHeavinessRatio > 0,
        `should be > 0, got ${explanation.runnerUpScoreHeavinessRatio}`,
      );
      assert.ok(
        explanation.runnerUpScoreHeavinessRatio < 1,
        `should be < 1, got ${explanation.runnerUpScoreHeavinessRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('54545454-3: identity — ratio * total === runnerUpScore', async () => {
  const agg = buildAgg('ccc3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreHeavinessRatio' in explanation &&
        'runnerUpScore' in explanation &&
        'candidateScoreMean' in explanation &&
        'candidateCount' in explanation) {
      const total = explanation.candidateScoreMean * explanation.candidateCount;
      const product = explanation.runnerUpScoreHeavinessRatio * total;
      assert.ok(
        Math.abs(product - explanation.runnerUpScore) < 1e-9,
        `ratio * total (${product}) should equal runnerUpScore (${explanation.runnerUpScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('54545454-4: for n=2 equals nonWinnerScoreHeavinessRatio', async () => {
  const agg = buildAgg('ccc4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreHeavinessRatio' in explanation &&
        'nonWinnerScoreHeavinessRatio' in explanation &&
        explanation.candidateCount === 2) {
      assert.ok(
        Math.abs(explanation.runnerUpScoreHeavinessRatio - explanation.nonWinnerScoreHeavinessRatio) < 1e-9,
        `for n=2, runnerUpScoreHeavinessRatio (${explanation.runnerUpScoreHeavinessRatio}) should equal nonWinnerScoreHeavinessRatio (${explanation.nonWinnerScoreHeavinessRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('54545454-5: absent on cast:no_match', async () => {
  const path = dlqPath('ccc5');
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
      !('runnerUpScoreHeavinessRatio' in parsed.explanation),
      `should be absent on no_match`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('54545454-6: absent when single candidate', async () => {
  const path = dlqPath('ccc6');
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
        !('runnerUpScoreHeavinessRatio' in explanation),
        `should be absent with single candidate`,
      );
    }
  } finally {
    await singleAgg.shutdown();
  }
});

test('54545454-7: always <= nonWinnerScoreHeavinessRatio', async () => {
  const agg = buildAgg('ccc7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreHeavinessRatio' in explanation && 'nonWinnerScoreHeavinessRatio' in explanation) {
      assert.ok(
        explanation.runnerUpScoreHeavinessRatio <= explanation.nonWinnerScoreHeavinessRatio + 1e-9,
        `runnerUpScoreHeavinessRatio (${explanation.runnerUpScoreHeavinessRatio}) should be <= nonWinnerScoreHeavinessRatio (${explanation.nonWinnerScoreHeavinessRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('54545454-8: tool description documents runnerUpScoreHeavinessRatio', async () => {
  const path = dlqPath('ccc8');
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
      cast.description?.includes('runnerUpScoreHeavinessRatio'),
      `cast description should mention runnerUpScoreHeavinessRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
