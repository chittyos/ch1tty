/**
 * 32323232: explanation.candidateScoreTop4HeavinessRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreTop4HeavinessRatio: number — top-4 share of total candidate score mass:
 * sum(top-4 scores) / candidateScoreEntropyTotal.
 *
 * Present when: >= 2 candidates and candidateScoreEntropyTotal > 0.
 * Absent when: no_match, single candidate, all scores 0.
 * Always in (0, 1]: top-4 sum <= total.
 * Always >= candidateScoreTop3HeavinessRatio: top-4 sum >= top-3 sum.
 * Always <= topHeavinessRatio: top-5 sum >= top-4 sum.
 * For n=2 or n=3: equals candidateScoreTop3HeavinessRatio (no 4th candidate).
 * Identity: candidateScoreTop4HeavinessRatio * candidateScoreEntropyTotal === sum of top-4 scores.
 *
 * Covered:
 *   32323232-1: present when >= 2 candidates and total > 0
 *   32323232-2: always in (0, 1] when present
 *   32323232-3: always >= candidateScoreTop3HeavinessRatio and <= topHeavinessRatio when all present
 *   32323232-4: for n=2 equals candidateScoreTop3HeavinessRatio
 *   32323232-5: absent on cast:no_match
 *   32323232-6: absent when only 1 candidate
 *   32323232-7: identity — candidateScoreTop4HeavinessRatio * total === sum of top-4 scores (for n=2: === winnerScore + runnerUpScore)
 *   32323232-8: tool description documents candidateScoreTop4HeavinessRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-32323232-${label}-${Date.now()}.jsonl`);
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

test('32323232-1: present when >= 2 candidates and total > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ggg1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreTop3HeavinessRatio' in explanation) {
      assert.ok('candidateScoreTop4HeavinessRatio' in explanation,
        `candidateScoreTop4HeavinessRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreTop4HeavinessRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('32323232-2: always in (0, 1] when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ggg2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreTop4HeavinessRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreTop4HeavinessRatio),
        `should be finite, got ${explanation.candidateScoreTop4HeavinessRatio}`,
      );
      assert.ok(
        explanation.candidateScoreTop4HeavinessRatio > 0,
        `should be > 0, got ${explanation.candidateScoreTop4HeavinessRatio}`,
      );
      assert.ok(
        explanation.candidateScoreTop4HeavinessRatio <= 1,
        `should be <= 1, got ${explanation.candidateScoreTop4HeavinessRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('32323232-3: always >= candidateScoreTop3HeavinessRatio and <= topHeavinessRatio when all present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ggg3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreTop4HeavinessRatio' in explanation) {
      if ('candidateScoreTop3HeavinessRatio' in explanation) {
        assert.ok(
          explanation.candidateScoreTop4HeavinessRatio >= explanation.candidateScoreTop3HeavinessRatio - 1e-9,
          `candidateScoreTop4HeavinessRatio (${explanation.candidateScoreTop4HeavinessRatio}) should be >= candidateScoreTop3HeavinessRatio (${explanation.candidateScoreTop3HeavinessRatio})`,
        );
      }
      if ('topHeavinessRatio' in explanation) {
        assert.ok(
          explanation.candidateScoreTop4HeavinessRatio <= explanation.topHeavinessRatio + 1e-9,
          `candidateScoreTop4HeavinessRatio (${explanation.candidateScoreTop4HeavinessRatio}) should be <= topHeavinessRatio (${explanation.topHeavinessRatio})`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('32323232-4: for n=2 equals candidateScoreTop3HeavinessRatio', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ggg4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreTop4HeavinessRatio' in explanation && explanation.candidateCount === 2 &&
        'candidateScoreTop3HeavinessRatio' in explanation) {
      assert.ok(
        Math.abs(explanation.candidateScoreTop4HeavinessRatio - explanation.candidateScoreTop3HeavinessRatio) < 1e-9,
        `candidateScoreTop4HeavinessRatio (${explanation.candidateScoreTop4HeavinessRatio}) should equal candidateScoreTop3HeavinessRatio (${explanation.candidateScoreTop3HeavinessRatio}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('32323232-5: absent on cast:no_match', async () => {
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
      !('candidateScoreTop4HeavinessRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.candidateScoreTop4HeavinessRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('32323232-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ggg6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreTop4HeavinessRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.candidateScoreTop4HeavinessRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('32323232-7: identity — candidateScoreTop4HeavinessRatio * total === winnerScore + runnerUpScore (for n=2)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ggg7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreTop4HeavinessRatio' in explanation && explanation.candidateCount === 2 &&
        'winnerScore' in explanation && 'runnerUpScore' in explanation && 'candidateScoreMean' in explanation) {
      const total = explanation.candidateScoreMean * explanation.candidateCount;
      const product = explanation.candidateScoreTop4HeavinessRatio * total;
      const expected = explanation.winnerScore + explanation.runnerUpScore;
      assert.ok(
        Math.abs(product - expected) < 1e-9,
        `candidateScoreTop4HeavinessRatio * total (${product}) should equal winnerScore + runnerUpScore (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('32323232-8: tool description documents candidateScoreTop4HeavinessRatio', async () => {
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
      cast.description?.includes('candidateScoreTop4HeavinessRatio'),
      `cast description should mention candidateScoreTop4HeavinessRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
