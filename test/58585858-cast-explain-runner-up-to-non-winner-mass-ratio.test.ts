/**
 * 58585858: explanation.runnerUpToNonWinnerMassRatio in ch1tty/cast when explain:true.
 *
 * runnerUpToNonWinnerMassRatio: number — runner-up score as fraction of total non-winner pool mass:
 * runnerUpScore / (candidateScoreEntropyTotal - winnerScore).
 *
 * Present when: >= 2 candidates, total > 0, non-winner mass > 0, and runnerUpScore > 0.
 * Absent when: no_match, single candidate, zero total, zero non-winner mass, or zero runner-up score.
 * Always in (0, 1].
 * For n=2: equals 1 (runner-up is the entire non-winner pool).
 * Always <= 1.
 * Identity: equals runnerUpScoreHeavinessRatio / nonWinnerScoreHeavinessRatio.
 *
 * Covered:
 *   58585858-1: present when >= 2 candidates, total > 0, non-winner mass > 0, runnerUpScore > 0
 *   58585858-2: always finite and in (0, 1]
 *   58585858-3: identity — equals runnerUpScoreHeavinessRatio / nonWinnerScoreHeavinessRatio
 *   58585858-4: for n=2 equals 1
 *   58585858-5: absent on cast:no_match
 *   58585858-6: absent when single candidate
 *   58585858-7: always <= 1
 *   58585858-8: tool description documents runnerUpToNonWinnerMassRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-58585858-${label}-${Date.now()}.jsonl`);
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

test('58585858-1: present when >= 2 candidates, total > 0, non-winner mass > 0, runnerUpScore > 0', async () => {
  const agg = buildAgg('ggg1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    const total = explanation.candidateScoreMean * explanation.candidateCount;
    const nonWinnerMass = total - explanation.winnerScore;
    if (explanation.candidateCount >= 2 && total > 0 && nonWinnerMass > 0 && explanation.runnerUpScore > 0) {
      assert.ok('runnerUpToNonWinnerMassRatio' in explanation,
        `runnerUpToNonWinnerMassRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.runnerUpToNonWinnerMassRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('58585858-2: always finite and in (0, 1]', async () => {
  const agg = buildAgg('ggg2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpToNonWinnerMassRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.runnerUpToNonWinnerMassRatio),
        `should be finite, got ${explanation.runnerUpToNonWinnerMassRatio}`,
      );
      assert.ok(
        explanation.runnerUpToNonWinnerMassRatio > 0,
        `should be > 0, got ${explanation.runnerUpToNonWinnerMassRatio}`,
      );
      assert.ok(
        explanation.runnerUpToNonWinnerMassRatio <= 1 + 1e-9,
        `should be <= 1, got ${explanation.runnerUpToNonWinnerMassRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('58585858-3: identity — equals runnerUpScoreHeavinessRatio / nonWinnerScoreHeavinessRatio', async () => {
  const agg = buildAgg('ggg3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpToNonWinnerMassRatio' in explanation &&
        'runnerUpScoreHeavinessRatio' in explanation &&
        'nonWinnerScoreHeavinessRatio' in explanation &&
        explanation.nonWinnerScoreHeavinessRatio > 0) {
      const expected = explanation.runnerUpScoreHeavinessRatio / explanation.nonWinnerScoreHeavinessRatio;
      assert.ok(
        Math.abs(explanation.runnerUpToNonWinnerMassRatio - expected) < 1e-9,
        `runnerUpToNonWinnerMassRatio (${explanation.runnerUpToNonWinnerMassRatio}) should equal runnerUpHeaviness/nonWinnerHeaviness (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('58585858-4: for n=2 equals 1', async () => {
  const agg = buildAgg('ggg4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpToNonWinnerMassRatio' in explanation && explanation.candidateCount === 2) {
      assert.ok(
        Math.abs(explanation.runnerUpToNonWinnerMassRatio - 1) < 1e-9,
        `for n=2, runnerUpToNonWinnerMassRatio (${explanation.runnerUpToNonWinnerMassRatio}) should equal 1`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('58585858-5: absent on cast:no_match', async () => {
  const path = dlqPath('ggg5');
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
      !('runnerUpToNonWinnerMassRatio' in parsed.explanation),
      `should be absent on no_match`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('58585858-6: absent when single candidate', async () => {
  const path = dlqPath('ggg6');
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
        !('runnerUpToNonWinnerMassRatio' in explanation),
        `should be absent with single candidate`,
      );
    }
  } finally {
    await singleAgg.shutdown();
  }
});

test('58585858-7: always <= 1', async () => {
  const agg = buildAgg('ggg7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpToNonWinnerMassRatio' in explanation) {
      assert.ok(
        explanation.runnerUpToNonWinnerMassRatio <= 1 + 1e-9,
        `runnerUpToNonWinnerMassRatio (${explanation.runnerUpToNonWinnerMassRatio}) should be <= 1`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('58585858-8: tool description documents runnerUpToNonWinnerMassRatio', async () => {
  const path = dlqPath('ggg8');
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
      cast.description?.includes('runnerUpToNonWinnerMassRatio'),
      `cast description should mention runnerUpToNonWinnerMassRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
