/**
 * 77777777: explanation.candidateScoreMeanToP90Ratio in ch1tty/cast when explain:true.
 *
 * candidateScoreMeanToP90Ratio: number — ratio of mean to P90 score:
 * candidateScoreMean / candidateScoreP90.
 *
 * Present when: >= 2 candidates and candidateScoreP90 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP90 === 0.
 * Typically < 1 (mean < P90 in right-skewed distributions).
 * Exact inverse of candidateScoreP90ToMeanRatio: product === 1.
 * Identity: candidateScoreMeanToP90Ratio * candidateScoreP90 === candidateScoreMean.
 * For n=2: (w+r) / (2*(0.9*w + 0.1*r)).
 *
 * Covered:
 *   77777777-1: present when >= 2 candidates and candidateScoreP90 > 0
 *   77777777-2: > 0 and finite when present
 *   77777777-3: inverse of candidateScoreP90ToMeanRatio — product === 1 when both present
 *   77777777-4: for n=2 equals (w+r) / (2*(0.9*w + 0.1*r))
 *   77777777-5: absent on cast:no_match
 *   77777777-6: absent when only 1 candidate
 *   77777777-7: identity — candidateScoreMeanToP90Ratio * candidateScoreP90 === candidateScoreMean
 *   77777777-8: tool description documents candidateScoreMeanToP90Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-77777777-${label}-${Date.now()}.jsonl`);
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

test('77777777-1: present when >= 2 candidates and candidateScoreP90 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('g1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP90' in explanation && explanation.candidateScoreP90 > 0) {
      assert.ok('candidateScoreMeanToP90Ratio' in explanation,
        `candidateScoreMeanToP90Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreMeanToP90Ratio, 'number', 'candidateScoreMeanToP90Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('77777777-2: > 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('g2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToP90Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreMeanToP90Ratio),
        `candidateScoreMeanToP90Ratio should be finite, got ${explanation.candidateScoreMeanToP90Ratio}`,
      );
      assert.ok(
        explanation.candidateScoreMeanToP90Ratio > 0,
        `candidateScoreMeanToP90Ratio should be > 0, got ${explanation.candidateScoreMeanToP90Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('77777777-3: inverse of candidateScoreP90ToMeanRatio — product === 1 when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('g3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToP90Ratio' in explanation && 'candidateScoreP90ToMeanRatio' in explanation) {
      const product = explanation.candidateScoreMeanToP90Ratio * explanation.candidateScoreP90ToMeanRatio;
      assert.ok(
        Math.abs(product - 1) < 1e-9,
        `candidateScoreMeanToP90Ratio * candidateScoreP90ToMeanRatio (${product}) should equal 1`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('77777777-4: for n=2 equals (w+r) / (2*(0.9*w + 0.1*r))', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('g4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToP90Ratio' in explanation && explanation.candidateCount === 2 && explanation.candidateScoreP90 > 0) {
      const mean = (explanation.winnerScore + explanation.runnerUpScore) / 2;
      const p90 = 0.9 * explanation.winnerScore + 0.1 * explanation.runnerUpScore;
      const expected = mean / p90;
      assert.ok(
        Math.abs(explanation.candidateScoreMeanToP90Ratio - expected) < 1e-9,
        `candidateScoreMeanToP90Ratio (${explanation.candidateScoreMeanToP90Ratio}) should equal (w+r)/(2*(0.9w+0.1r)) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('77777777-5: absent on cast:no_match', async () => {
  const path = dlqPath('g5');
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
      !('candidateScoreMeanToP90Ratio' in parsed.explanation),
      `candidateScoreMeanToP90Ratio should be absent on no_match, found: ${parsed.explanation.candidateScoreMeanToP90Ratio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('77777777-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('g6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreMeanToP90Ratio' in explanation),
      `candidateScoreMeanToP90Ratio should be absent with single candidate, found: ${explanation.candidateScoreMeanToP90Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('77777777-7: identity — candidateScoreMeanToP90Ratio * candidateScoreP90 === candidateScoreMean', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('g7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToP90Ratio' in explanation && 'candidateScoreP90' in explanation && 'candidateScoreMean' in explanation) {
      const product = explanation.candidateScoreMeanToP90Ratio * explanation.candidateScoreP90;
      assert.ok(
        Math.abs(product - explanation.candidateScoreMean) < 1e-9,
        `candidateScoreMeanToP90Ratio * candidateScoreP90 (${product}) should equal candidateScoreMean (${explanation.candidateScoreMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('77777777-8: tool description documents candidateScoreMeanToP90Ratio', async () => {
  const path = dlqPath('g8');
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
      cast.description?.includes('candidateScoreMeanToP90Ratio'),
      `cast description should mention candidateScoreMeanToP90Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
