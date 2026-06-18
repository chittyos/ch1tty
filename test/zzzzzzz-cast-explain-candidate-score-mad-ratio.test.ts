/**
 * ZZZZZZZ: explanation.candidateScoreMADRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreMADRatio: number — MAD normalised by the mean: candidateScoreMAD / candidateScoreMean.
 * Scale-free relative dispersion measure; MAD-based analogue of coefficient of variation.
 *
 * Present when: >= 2 candidates and candidateScoreMean > 0.
 * Absent when: no_match, single candidate, or all scores zero.
 * Always >= 0.
 * Equals 0 when all scores identical (MAD = 0).
 * Always <= candidateScoreCoefficientOfVariation (MAD <= stdDev => MADRatio <= CV).
 * For n=2: candidateScoreMADRatio = winnerRunnerUpGap / (winnerScore + runnerUpScore).
 * Identity: candidateScoreMADRatio === candidateScoreMAD / candidateScoreMean.
 *
 * Covered:
 *   ZZZZZZZ-1: present when >= 2 candidates with nonzero mean
 *   ZZZZZZZ-2: always >= 0 and finite when present
 *   ZZZZZZZ-3: equals 0 when all scores identical
 *   ZZZZZZZ-4: for n=2 equals winnerRunnerUpGap / (winnerScore + runnerUpScore)
 *   ZZZZZZZ-5: absent on cast:no_match
 *   ZZZZZZZ-6: absent when only 1 candidate
 *   ZZZZZZZ-7: always <= candidateScoreCoefficientOfVariation when both present
 *   ZZZZZZZ-8: tool description documents candidateScoreMADRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-zzzzzzz-${label}-${Date.now()}.jsonl`);
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

test('ZZZZZZZ-1: present when >= 2 candidates with nonzero mean', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    assert.ok('candidateScoreMADRatio' in explanation,
      `candidateScoreMADRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.candidateScoreMADRatio, 'number', 'candidateScoreMADRatio should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZZZZ-2: always >= 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMADRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreMADRatio >= -1e-9,
        `candidateScoreMADRatio should be >= 0, got ${explanation.candidateScoreMADRatio}`,
      );
      assert.ok(
        Number.isFinite(explanation.candidateScoreMADRatio),
        `candidateScoreMADRatio should be finite, got ${explanation.candidateScoreMADRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZZZZ-3: equals 0 when all scores identical', async () => {
  const SAME_DESC = 'billing invoice payment charge query database';
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: SAME_DESC, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMADRatio' in explanation && 'candidateScoreSpread' in explanation) {
      if (Math.abs(explanation.candidateScoreSpread) < 1e-9) {
        assert.ok(
          explanation.candidateScoreMADRatio < 1e-9,
          `candidateScoreMADRatio (${explanation.candidateScoreMADRatio}) should be 0 when all scores identical`,
        );
      }
    }
    assert.ok(explanation.candidateCount >= 1, 'should have candidates');
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZZZZ-4: for n=2 equals winnerRunnerUpGap / (winnerScore + runnerUpScore)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if (
      'candidateScoreMADRatio' in explanation &&
      'winnerRunnerUpGap' in explanation &&
      'winnerScore' in explanation &&
      'runnerUpScore' in explanation &&
      explanation.candidateCount === 2
    ) {
      const sum = explanation.winnerScore + explanation.runnerUpScore;
      if (sum > 0) {
        const expected = explanation.winnerRunnerUpGap / sum;
        assert.ok(
          Math.abs(explanation.candidateScoreMADRatio - expected) < 1e-9,
          `candidateScoreMADRatio (${explanation.candidateScoreMADRatio}) should equal winnerRunnerUpGap/(winnerScore+runnerUpScore) (${expected}) when n=2`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZZZZ-5: absent on cast:no_match', async () => {
  const path = dlqPath('z5');
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
      !('candidateScoreMADRatio' in parsed.explanation),
      `candidateScoreMADRatio should be absent on no_match, found: ${parsed.explanation.candidateScoreMADRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('ZZZZZZZ-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreMADRatio' in explanation),
      `candidateScoreMADRatio should be absent with single candidate, found: ${explanation.candidateScoreMADRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZZZZ-7: always <= candidateScoreCoefficientOfVariation when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMADRatio' in explanation && 'candidateScoreCoefficientOfVariation' in explanation) {
      assert.ok(
        explanation.candidateScoreMADRatio <= explanation.candidateScoreCoefficientOfVariation + 1e-9,
        `candidateScoreMADRatio (${explanation.candidateScoreMADRatio}) should be <= candidateScoreCoefficientOfVariation (${explanation.candidateScoreCoefficientOfVariation})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZZZZ-8: tool description documents candidateScoreMADRatio', async () => {
  const path = dlqPath('z8');
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
      cast.description?.includes('candidateScoreMADRatio'),
      `cast description should mention candidateScoreMADRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
