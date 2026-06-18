/**
 * 11111111: explanation.candidateScoreMeanToHarmonicMeanRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreMeanToHarmonicMeanRatio: number — ratio of arithmetic mean to harmonic mean:
 * candidateScoreMean / candidateScoreHarmonicMean.
 *
 * Present when: >= 2 candidates, all scores > 0.
 * Absent when: no_match, single candidate, any score === 0.
 * Always >= 1 by AM-HM inequality (AM >= HM always).
 * Exact inverse of candidateScoreHarmonicMeanToMeanRatio: product === 1.
 * Always <= candidateScoreMeanToGeometricMeanRatio (AM/HM >= AM/GM since HM <= GM).
 * Identity: candidateScoreMeanToHarmonicMeanRatio * candidateScoreHarmonicMean === candidateScoreMean.
 * For n=2: (w+r)^2/(4wr).
 *
 * Covered:
 *   11111111-1: present when >= 2 candidates and candidateScoreHarmonicMean > 0
 *   11111111-2: >= 1 and finite when present
 *   11111111-3: inverse of candidateScoreHarmonicMeanToMeanRatio — product === 1 when both present
 *   11111111-4: for n=2 equals (w+r)^2/(4wr)
 *   11111111-5: absent on cast:no_match
 *   11111111-6: absent when only 1 candidate
 *   11111111-7: identity — candidateScoreMeanToHarmonicMeanRatio * candidateScoreHarmonicMean === candidateScoreMean
 *   11111111-8: tool description documents candidateScoreMeanToHarmonicMeanRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-11111111-${label}-${Date.now()}.jsonl`);
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

test('11111111-1: present when >= 2 candidates and candidateScoreHarmonicMean > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ll1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreHarmonicMean' in explanation && explanation.candidateScoreHarmonicMean > 0) {
      assert.ok('candidateScoreMeanToHarmonicMeanRatio' in explanation,
        `candidateScoreMeanToHarmonicMeanRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreMeanToHarmonicMeanRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('11111111-2: >= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ll2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToHarmonicMeanRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreMeanToHarmonicMeanRatio),
        `should be finite, got ${explanation.candidateScoreMeanToHarmonicMeanRatio}`,
      );
      assert.ok(
        explanation.candidateScoreMeanToHarmonicMeanRatio >= 1 - 1e-9,
        `should be >= 1 (AM >= HM), got ${explanation.candidateScoreMeanToHarmonicMeanRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('11111111-3: inverse of candidateScoreHarmonicMeanToMeanRatio — product === 1 when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ll3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToHarmonicMeanRatio' in explanation && 'candidateScoreHarmonicMeanToMeanRatio' in explanation) {
      const product = explanation.candidateScoreMeanToHarmonicMeanRatio * explanation.candidateScoreHarmonicMeanToMeanRatio;
      assert.ok(
        Math.abs(product - 1) < 1e-9,
        `candidateScoreMeanToHarmonicMeanRatio * candidateScoreHarmonicMeanToMeanRatio (${product}) should equal 1`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('11111111-4: for n=2 equals (w+r)^2/(4wr)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ll4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToHarmonicMeanRatio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0 && explanation.runnerUpScore > 0) {
      const w = explanation.winnerScore;
      const ru = explanation.runnerUpScore;
      const expected = ((w + ru) ** 2) / (4 * w * ru);
      assert.ok(
        Math.abs(explanation.candidateScoreMeanToHarmonicMeanRatio - expected) < 1e-9,
        `candidateScoreMeanToHarmonicMeanRatio (${explanation.candidateScoreMeanToHarmonicMeanRatio}) should equal (w+r)^2/(4wr) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('11111111-5: absent on cast:no_match', async () => {
  const path = dlqPath('ll5');
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
      !('candidateScoreMeanToHarmonicMeanRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.candidateScoreMeanToHarmonicMeanRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('11111111-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ll6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreMeanToHarmonicMeanRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.candidateScoreMeanToHarmonicMeanRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('11111111-7: identity — candidateScoreMeanToHarmonicMeanRatio * candidateScoreHarmonicMean === candidateScoreMean', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ll7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToHarmonicMeanRatio' in explanation && 'candidateScoreHarmonicMean' in explanation && 'candidateScoreMean' in explanation) {
      const product = explanation.candidateScoreMeanToHarmonicMeanRatio * explanation.candidateScoreHarmonicMean;
      assert.ok(
        Math.abs(product - explanation.candidateScoreMean) < 1e-9,
        `candidateScoreMeanToHarmonicMeanRatio * candidateScoreHarmonicMean (${product}) should equal candidateScoreMean (${explanation.candidateScoreMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('11111111-8: tool description documents candidateScoreMeanToHarmonicMeanRatio', async () => {
  const path = dlqPath('ll8');
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
      cast.description?.includes('candidateScoreMeanToHarmonicMeanRatio'),
      `cast description should mention candidateScoreMeanToHarmonicMeanRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
