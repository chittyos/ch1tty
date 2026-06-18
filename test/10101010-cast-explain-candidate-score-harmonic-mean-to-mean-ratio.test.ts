/**
 * 10101010: explanation.candidateScoreHarmonicMeanToMeanRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreHarmonicMeanToMeanRatio: number — ratio of harmonic mean to arithmetic mean:
 * candidateScoreHarmonicMean / candidateScoreMean.
 *
 * Present when: >= 2 candidates, all scores > 0, and candidateScoreMean > 0.
 * Absent when: no_match, single candidate, any score === 0, or mean === 0.
 * Always in (0, 1] by AM-HM inequality (AM >= HM always).
 * Always <= candidateScoreGeometricMeanToMeanRatio (HM <= GM <= AM, so HM/AM <= GM/AM).
 * Identity: candidateScoreHarmonicMeanToMeanRatio * candidateScoreMean === candidateScoreHarmonicMean.
 * For n=2: 4wr/(w+r)^2.
 *
 * Covered:
 *   10101010-1: present when >= 2 candidates, all scores > 0, and candidateScoreMean > 0
 *   10101010-2: in (0, 1] and finite when present
 *   10101010-3: <= candidateScoreGeometricMeanToMeanRatio when both present (HM <= GM)
 *   10101010-4: for n=2 equals 4wr/(w+r)^2
 *   10101010-5: absent on cast:no_match
 *   10101010-6: absent when only 1 candidate
 *   10101010-7: identity — candidateScoreHarmonicMeanToMeanRatio * candidateScoreMean === candidateScoreHarmonicMean
 *   10101010-8: tool description documents candidateScoreHarmonicMeanToMeanRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-10101010-${label}-${Date.now()}.jsonl`);
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

test('10101010-1: present when >= 2 candidates, all scores > 0, and candidateScoreMean > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('kk1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreHarmonicMean' in explanation && explanation.candidateScoreHarmonicMean > 0 && explanation.candidateScoreMean > 0) {
      assert.ok('candidateScoreHarmonicMeanToMeanRatio' in explanation,
        `candidateScoreHarmonicMeanToMeanRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreHarmonicMeanToMeanRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('10101010-2: in (0, 1] and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('kk2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreHarmonicMeanToMeanRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreHarmonicMeanToMeanRatio),
        `should be finite, got ${explanation.candidateScoreHarmonicMeanToMeanRatio}`,
      );
      assert.ok(
        explanation.candidateScoreHarmonicMeanToMeanRatio > 0,
        `should be > 0, got ${explanation.candidateScoreHarmonicMeanToMeanRatio}`,
      );
      assert.ok(
        explanation.candidateScoreHarmonicMeanToMeanRatio <= 1 + 1e-9,
        `should be <= 1 (AM >= HM), got ${explanation.candidateScoreHarmonicMeanToMeanRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('10101010-3: <= candidateScoreGeometricMeanToMeanRatio when both present (HM <= GM)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('kk3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreHarmonicMeanToMeanRatio' in explanation && 'candidateScoreGeometricMeanToMeanRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreHarmonicMeanToMeanRatio <= explanation.candidateScoreGeometricMeanToMeanRatio + 1e-9,
        `candidateScoreHarmonicMeanToMeanRatio (${explanation.candidateScoreHarmonicMeanToMeanRatio}) should be <= candidateScoreGeometricMeanToMeanRatio (${explanation.candidateScoreGeometricMeanToMeanRatio}) since HM <= GM`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('10101010-4: for n=2 equals 4wr/(w+r)^2', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('kk4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreHarmonicMeanToMeanRatio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0 && explanation.runnerUpScore > 0) {
      const w = explanation.winnerScore;
      const ru = explanation.runnerUpScore;
      const expected = (4 * w * ru) / ((w + ru) ** 2);
      assert.ok(
        Math.abs(explanation.candidateScoreHarmonicMeanToMeanRatio - expected) < 1e-9,
        `candidateScoreHarmonicMeanToMeanRatio (${explanation.candidateScoreHarmonicMeanToMeanRatio}) should equal 4wr/(w+r)^2 (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('10101010-5: absent on cast:no_match', async () => {
  const path = dlqPath('kk5');
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
      !('candidateScoreHarmonicMeanToMeanRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.candidateScoreHarmonicMeanToMeanRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('10101010-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('kk6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreHarmonicMeanToMeanRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.candidateScoreHarmonicMeanToMeanRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('10101010-7: identity — candidateScoreHarmonicMeanToMeanRatio * candidateScoreMean === candidateScoreHarmonicMean', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('kk7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreHarmonicMeanToMeanRatio' in explanation && 'candidateScoreMean' in explanation && 'candidateScoreHarmonicMean' in explanation) {
      const product = explanation.candidateScoreHarmonicMeanToMeanRatio * explanation.candidateScoreMean;
      assert.ok(
        Math.abs(product - explanation.candidateScoreHarmonicMean) < 1e-9,
        `candidateScoreHarmonicMeanToMeanRatio * candidateScoreMean (${product}) should equal candidateScoreHarmonicMean (${explanation.candidateScoreHarmonicMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('10101010-8: tool description documents candidateScoreHarmonicMeanToMeanRatio', async () => {
  const path = dlqPath('kk8');
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
      cast.description?.includes('candidateScoreHarmonicMeanToMeanRatio'),
      `cast description should mention candidateScoreHarmonicMeanToMeanRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
