/**
 * 30303030: explanation.runnerUpLowestGapToSpreadRatio in ch1tty/cast when explain:true.
 *
 * runnerUpLowestGapToSpreadRatio: number — runner-up-to-lowest gap as fraction of full spread:
 * (runnerUpScore - lowestCandidateScore) / candidateScoreSpread.
 *
 * Present when: >= 2 candidates and candidateScoreSpread > 0.
 * Absent when: no_match, single candidate, or spread === 0.
 * Always in [0, 1]: runner-up-to-lowest gap <= full spread.
 * For n=2: always === 0 (runnerUp === lowest).
 * Sum identity: winnerRunnerUpGapToSpreadRatio + runnerUpLowestGapToSpreadRatio === 1.
 * Identity: runnerUpLowestGapToSpreadRatio * candidateScoreSpread === runnerUpScore - lowestCandidateScore.
 *
 * Covered:
 *   30303030-1: present when >= 2 candidates and spread > 0
 *   30303030-2: always in [0, 1] when present
 *   30303030-3: sum with winnerRunnerUpGapToSpreadRatio === 1 when both present
 *   30303030-4: for n=2 equals 0
 *   30303030-5: absent on cast:no_match
 *   30303030-6: absent when only 1 candidate
 *   30303030-7: identity — runnerUpLowestGapToSpreadRatio * spread === runnerUpScore - lowestCandidateScore
 *   30303030-8: tool description documents runnerUpLowestGapToSpreadRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-30303030-${label}-${Date.now()}.jsonl`);
}

const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe Payments', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.test/mcp',
};
const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.test/mcp',
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

test('30303030-1: present when >= 2 candidates and spread > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('eee1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreSpread' in explanation && explanation.candidateScoreSpread > 0) {
      assert.ok('runnerUpLowestGapToSpreadRatio' in explanation,
        `runnerUpLowestGapToSpreadRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.runnerUpLowestGapToSpreadRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('30303030-2: always in [0, 1] when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('eee2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpLowestGapToSpreadRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.runnerUpLowestGapToSpreadRatio),
        `should be finite, got ${explanation.runnerUpLowestGapToSpreadRatio}`,
      );
      assert.ok(
        explanation.runnerUpLowestGapToSpreadRatio >= 0,
        `should be >= 0, got ${explanation.runnerUpLowestGapToSpreadRatio}`,
      );
      assert.ok(
        explanation.runnerUpLowestGapToSpreadRatio <= 1,
        `should be <= 1, got ${explanation.runnerUpLowestGapToSpreadRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('30303030-3: sum with winnerRunnerUpGapToSpreadRatio === 1 when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('eee3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpLowestGapToSpreadRatio' in explanation && 'winnerRunnerUpGapToSpreadRatio' in explanation) {
      const sum = explanation.runnerUpLowestGapToSpreadRatio + explanation.winnerRunnerUpGapToSpreadRatio;
      assert.ok(
        Math.abs(sum - 1) < 1e-9,
        `runnerUpLowestGapToSpreadRatio + winnerRunnerUpGapToSpreadRatio (${sum}) should equal 1`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('30303030-4: for n=2 equals 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('eee4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpLowestGapToSpreadRatio' in explanation && explanation.candidateCount === 2) {
      assert.ok(
        Math.abs(explanation.runnerUpLowestGapToSpreadRatio - 0) < 1e-9,
        `runnerUpLowestGapToSpreadRatio (${explanation.runnerUpLowestGapToSpreadRatio}) should equal 0 for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('30303030-5: absent on cast:no_match', async () => {
  const path = dlqPath('eee5');
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
      !('runnerUpLowestGapToSpreadRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.runnerUpLowestGapToSpreadRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('30303030-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('eee6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('runnerUpLowestGapToSpreadRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.runnerUpLowestGapToSpreadRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('30303030-7: identity — runnerUpLowestGapToSpreadRatio * spread === runnerUpScore - lowestCandidateScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('eee7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpLowestGapToSpreadRatio' in explanation &&
        'candidateScoreSpread' in explanation &&
        'runnerUpScore' in explanation &&
        'lowestCandidateScore' in explanation) {
      const product = explanation.runnerUpLowestGapToSpreadRatio * explanation.candidateScoreSpread;
      const expected = explanation.runnerUpScore - explanation.lowestCandidateScore;
      assert.ok(
        Math.abs(product - expected) < 1e-9,
        `runnerUpLowestGapToSpreadRatio * spread (${product}) should equal runnerUpScore - lowestCandidateScore (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('30303030-8: tool description documents runnerUpLowestGapToSpreadRatio', async () => {
  const path = dlqPath('eee8');
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
      cast.description?.includes('runnerUpLowestGapToSpreadRatio'),
      `cast description should mention runnerUpLowestGapToSpreadRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
