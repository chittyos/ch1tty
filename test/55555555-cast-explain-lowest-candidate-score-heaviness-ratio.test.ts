/**
 * 55555555: explanation.lowestCandidateScoreHeavinessRatio in ch1tty/cast when explain:true.
 *
 * lowestCandidateScoreHeavinessRatio: number — lowest candidate score as fraction of total score mass:
 * lowestCandidateScore / candidateScoreEntropyTotal.
 *
 * Present when: >= 2 candidates, total > 0, and lowestCandidateScore > 0.
 * Absent when: no_match, single candidate, zero total, or zero lowest score.
 * Always in (0, 1).
 * For n=2: equals runnerUpScoreHeavinessRatio.
 * Always <= runnerUpScoreHeavinessRatio.
 * Identity: ratio * total === lowestCandidateScore.
 *
 * Covered:
 *   55555555-1: present when >= 2 candidates, total > 0, and lowestScore > 0
 *   55555555-2: always finite and in (0, 1)
 *   55555555-3: identity — ratio * total === lowestCandidateScore
 *   55555555-4: for n=2 equals runnerUpScoreHeavinessRatio
 *   55555555-5: absent on cast:no_match
 *   55555555-6: absent when single candidate
 *   55555555-7: always <= runnerUpScoreHeavinessRatio
 *   55555555-8: tool description documents lowestCandidateScoreHeavinessRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-55555555-${label}-${Date.now()}.jsonl`);
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

test('55555555-1: present when >= 2 candidates, total > 0, and lowestScore > 0', async () => {
  const agg = buildAgg('ddd1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    const total = explanation.candidateScoreMean * explanation.candidateCount;
    if (explanation.candidateCount >= 2 && total > 0 && explanation.lowestCandidateScore > 0) {
      assert.ok('lowestCandidateScoreHeavinessRatio' in explanation,
        `lowestCandidateScoreHeavinessRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.lowestCandidateScoreHeavinessRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('55555555-2: always finite and in (0, 1)', async () => {
  const agg = buildAgg('ddd2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('lowestCandidateScoreHeavinessRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.lowestCandidateScoreHeavinessRatio),
        `should be finite, got ${explanation.lowestCandidateScoreHeavinessRatio}`,
      );
      assert.ok(
        explanation.lowestCandidateScoreHeavinessRatio > 0,
        `should be > 0, got ${explanation.lowestCandidateScoreHeavinessRatio}`,
      );
      assert.ok(
        explanation.lowestCandidateScoreHeavinessRatio < 1,
        `should be < 1, got ${explanation.lowestCandidateScoreHeavinessRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('55555555-3: identity — ratio * total === lowestCandidateScore', async () => {
  const agg = buildAgg('ddd3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('lowestCandidateScoreHeavinessRatio' in explanation &&
        'lowestCandidateScore' in explanation &&
        'candidateScoreMean' in explanation &&
        'candidateCount' in explanation) {
      const total = explanation.candidateScoreMean * explanation.candidateCount;
      const product = explanation.lowestCandidateScoreHeavinessRatio * total;
      assert.ok(
        Math.abs(product - explanation.lowestCandidateScore) < 1e-9,
        `ratio * total (${product}) should equal lowestCandidateScore (${explanation.lowestCandidateScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('55555555-4: for n=2 equals runnerUpScoreHeavinessRatio', async () => {
  const agg = buildAgg('ddd4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('lowestCandidateScoreHeavinessRatio' in explanation &&
        'runnerUpScoreHeavinessRatio' in explanation &&
        explanation.candidateCount === 2) {
      assert.ok(
        Math.abs(explanation.lowestCandidateScoreHeavinessRatio - explanation.runnerUpScoreHeavinessRatio) < 1e-9,
        `for n=2, lowestCandidateScoreHeavinessRatio (${explanation.lowestCandidateScoreHeavinessRatio}) should equal runnerUpScoreHeavinessRatio (${explanation.runnerUpScoreHeavinessRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('55555555-5: absent on cast:no_match', async () => {
  const path = dlqPath('ddd5');
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
      !('lowestCandidateScoreHeavinessRatio' in parsed.explanation),
      `should be absent on no_match`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('55555555-6: absent when single candidate', async () => {
  const path = dlqPath('ddd6');
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
        !('lowestCandidateScoreHeavinessRatio' in explanation),
        `should be absent with single candidate`,
      );
    }
  } finally {
    await singleAgg.shutdown();
  }
});

test('55555555-7: always <= runnerUpScoreHeavinessRatio', async () => {
  const agg = buildAgg('ddd7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('lowestCandidateScoreHeavinessRatio' in explanation && 'runnerUpScoreHeavinessRatio' in explanation) {
      assert.ok(
        explanation.lowestCandidateScoreHeavinessRatio <= explanation.runnerUpScoreHeavinessRatio + 1e-9,
        `lowestCandidateScoreHeavinessRatio (${explanation.lowestCandidateScoreHeavinessRatio}) should be <= runnerUpScoreHeavinessRatio (${explanation.runnerUpScoreHeavinessRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('55555555-8: tool description documents lowestCandidateScoreHeavinessRatio', async () => {
  const path = dlqPath('ddd8');
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
      cast.description?.includes('lowestCandidateScoreHeavinessRatio'),
      `cast description should mention lowestCandidateScoreHeavinessRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
