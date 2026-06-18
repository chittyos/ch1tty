/**
 * 99999999: explanation.candidateScoreMeanToP95Ratio in ch1tty/cast when explain:true.
 *
 * candidateScoreMeanToP95Ratio: number — ratio of mean to P95 score:
 * candidateScoreMean / candidateScoreP95.
 *
 * Present when: >= 2 candidates and candidateScoreP95 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP95 === 0.
 * Typically well below 1 (mean << P95 in right-skewed distributions).
 * Smallest of the mean/Px family (P95 is the largest denominator).
 * Always <= candidateScoreMeanToP90Ratio when both present (P95 >= P90).
 * Exact inverse of candidateScoreP95ToMeanRatio: product === 1.
 * Identity: candidateScoreMeanToP95Ratio * candidateScoreP95 === candidateScoreMean.
 * For n=2: (w+r) / (2*(0.95*w + 0.05*r)).
 *
 * Covered:
 *   99999999-1: present when >= 2 candidates and candidateScoreP95 > 0
 *   99999999-2: > 0 and finite when present
 *   99999999-3: always <= candidateScoreMeanToP90Ratio when both present (P95 >= P90)
 *   99999999-4: for n=2 equals (w+r) / (2*(0.95*w + 0.05*r))
 *   99999999-5: absent on cast:no_match
 *   99999999-6: absent when only 1 candidate
 *   99999999-7: identity — candidateScoreMeanToP95Ratio * candidateScoreP95 === candidateScoreMean
 *   99999999-8: tool description documents candidateScoreMeanToP95Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-99999999-${label}-${Date.now()}.jsonl`);
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

test('99999999-1: present when >= 2 candidates and candidateScoreP95 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('i1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP95' in explanation && explanation.candidateScoreP95 > 0) {
      assert.ok('candidateScoreMeanToP95Ratio' in explanation,
        `candidateScoreMeanToP95Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreMeanToP95Ratio, 'number', 'candidateScoreMeanToP95Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('99999999-2: > 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('i2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToP95Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreMeanToP95Ratio),
        `candidateScoreMeanToP95Ratio should be finite, got ${explanation.candidateScoreMeanToP95Ratio}`,
      );
      assert.ok(
        explanation.candidateScoreMeanToP95Ratio > 0,
        `candidateScoreMeanToP95Ratio should be > 0, got ${explanation.candidateScoreMeanToP95Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('99999999-3: always <= candidateScoreMeanToP90Ratio when both present (P95 >= P90)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('i3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToP95Ratio' in explanation && 'candidateScoreMeanToP90Ratio' in explanation) {
      assert.ok(
        explanation.candidateScoreMeanToP95Ratio <= explanation.candidateScoreMeanToP90Ratio + 1e-9,
        `candidateScoreMeanToP95Ratio (${explanation.candidateScoreMeanToP95Ratio}) should be <= candidateScoreMeanToP90Ratio (${explanation.candidateScoreMeanToP90Ratio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('99999999-4: for n=2 equals (w+r) / (2*(0.95*w + 0.05*r))', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('i4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToP95Ratio' in explanation && explanation.candidateCount === 2 && explanation.candidateScoreP95 > 0) {
      const mean = (explanation.winnerScore + explanation.runnerUpScore) / 2;
      const p95 = 0.95 * explanation.winnerScore + 0.05 * explanation.runnerUpScore;
      const expected = mean / p95;
      assert.ok(
        Math.abs(explanation.candidateScoreMeanToP95Ratio - expected) < 1e-9,
        `candidateScoreMeanToP95Ratio (${explanation.candidateScoreMeanToP95Ratio}) should equal (w+r)/(2*(0.95w+0.05r)) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('99999999-5: absent on cast:no_match', async () => {
  const path = dlqPath('i5');
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
      !('candidateScoreMeanToP95Ratio' in parsed.explanation),
      `candidateScoreMeanToP95Ratio should be absent on no_match, found: ${parsed.explanation.candidateScoreMeanToP95Ratio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('99999999-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('i6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreMeanToP95Ratio' in explanation),
      `candidateScoreMeanToP95Ratio should be absent with single candidate, found: ${explanation.candidateScoreMeanToP95Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('99999999-7: identity — candidateScoreMeanToP95Ratio * candidateScoreP95 === candidateScoreMean', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('i7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToP95Ratio' in explanation && 'candidateScoreP95' in explanation && 'candidateScoreMean' in explanation) {
      const product = explanation.candidateScoreMeanToP95Ratio * explanation.candidateScoreP95;
      assert.ok(
        Math.abs(product - explanation.candidateScoreMean) < 1e-9,
        `candidateScoreMeanToP95Ratio * candidateScoreP95 (${product}) should equal candidateScoreMean (${explanation.candidateScoreMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('99999999-8: tool description documents candidateScoreMeanToP95Ratio', async () => {
  const path = dlqPath('i8');
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
      cast.description?.includes('candidateScoreMeanToP95Ratio'),
      `cast description should mention candidateScoreMeanToP95Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
