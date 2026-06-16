/**
 * 26262626: explanation.candidateScoreLowestToHarmonicMeanRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreLowestToHarmonicMeanRatio: number — ratio of lowest candidate score to harmonic mean:
 * lowestCandidateScore / candidateScoreHarmonicMean.
 *
 * Present when: >= 2 candidates, all scores > 0 (HM defined), candidateScoreHarmonicMean > 0.
 * Absent when: no_match, single candidate, any score === 0.
 * Always in (0, 1]: HM >= min for positive values; equality when all scores identical.
 * Always >= candidateScoreLowestToGeometricMeanRatio: HM <= GM so lowest/HM >= lowest/GM.
 * For n=2: lowest = r; HM = 2wr/(w+r); ratio = (w+r)/(2w).
 * Identity: candidateScoreLowestToHarmonicMeanRatio * candidateScoreHarmonicMean === lowestCandidateScore.
 *
 * Covered:
 *   26262626-1: present when >= 2 candidates, all scores > 0, candidateScoreHarmonicMean > 0
 *   26262626-2: always in (0, 1] when present
 *   26262626-3: always >= candidateScoreLowestToGeometricMeanRatio when both present
 *   26262626-4: for n=2 equals (w+r)/(2w)
 *   26262626-5: absent on cast:no_match
 *   26262626-6: absent when only 1 candidate
 *   26262626-7: identity — candidateScoreLowestToHarmonicMeanRatio * candidateScoreHarmonicMean === lowestCandidateScore
 *   26262626-8: tool description documents candidateScoreLowestToHarmonicMeanRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-26262626-${label}-${Date.now()}.jsonl`);
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

test('26262626-1: present when >= 2 candidates, all scores > 0, candidateScoreHarmonicMean > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('aaa1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreHarmonicMean' in explanation && explanation.candidateScoreHarmonicMean > 0) {
      assert.ok('candidateScoreLowestToHarmonicMeanRatio' in explanation,
        `candidateScoreLowestToHarmonicMeanRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreLowestToHarmonicMeanRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('26262626-2: always in (0, 1] when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('aaa2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreLowestToHarmonicMeanRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreLowestToHarmonicMeanRatio),
        `should be finite, got ${explanation.candidateScoreLowestToHarmonicMeanRatio}`,
      );
      assert.ok(
        explanation.candidateScoreLowestToHarmonicMeanRatio > 0,
        `should be > 0, got ${explanation.candidateScoreLowestToHarmonicMeanRatio}`,
      );
      assert.ok(
        explanation.candidateScoreLowestToHarmonicMeanRatio <= 1,
        `should be <= 1, got ${explanation.candidateScoreLowestToHarmonicMeanRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('26262626-3: always >= candidateScoreLowestToGeometricMeanRatio when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('aaa3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreLowestToHarmonicMeanRatio' in explanation && 'candidateScoreLowestToGeometricMeanRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreLowestToHarmonicMeanRatio >= explanation.candidateScoreLowestToGeometricMeanRatio - 1e-9,
        `candidateScoreLowestToHarmonicMeanRatio (${explanation.candidateScoreLowestToHarmonicMeanRatio}) should be >= candidateScoreLowestToGeometricMeanRatio (${explanation.candidateScoreLowestToGeometricMeanRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('26262626-4: for n=2 equals (w+r)/(2w)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('aaa4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreLowestToHarmonicMeanRatio' in explanation && explanation.candidateCount === 2 &&
        explanation.winnerScore > 0 && explanation.runnerUpScore > 0) {
      const w = explanation.winnerScore;
      const ru = explanation.runnerUpScore;
      const expected = (w + ru) / (2 * w);
      assert.ok(
        Math.abs(explanation.candidateScoreLowestToHarmonicMeanRatio - expected) < 1e-9,
        `candidateScoreLowestToHarmonicMeanRatio (${explanation.candidateScoreLowestToHarmonicMeanRatio}) should equal (w+r)/(2w) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('26262626-5: absent on cast:no_match', async () => {
  const path = dlqPath('aaa5');
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
      !('candidateScoreLowestToHarmonicMeanRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.candidateScoreLowestToHarmonicMeanRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('26262626-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('aaa6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreLowestToHarmonicMeanRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.candidateScoreLowestToHarmonicMeanRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('26262626-7: identity — candidateScoreLowestToHarmonicMeanRatio * candidateScoreHarmonicMean === lowestCandidateScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('aaa7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreLowestToHarmonicMeanRatio' in explanation &&
        'candidateScoreHarmonicMean' in explanation &&
        'lowestCandidateScore' in explanation) {
      const product = explanation.candidateScoreLowestToHarmonicMeanRatio * explanation.candidateScoreHarmonicMean;
      assert.ok(
        Math.abs(product - explanation.lowestCandidateScore) < 1e-9,
        `candidateScoreLowestToHarmonicMeanRatio * candidateScoreHarmonicMean (${product}) should equal lowestCandidateScore (${explanation.lowestCandidateScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('26262626-8: tool description documents candidateScoreLowestToHarmonicMeanRatio', async () => {
  const path = dlqPath('aaa8');
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
      cast.description?.includes('candidateScoreLowestToHarmonicMeanRatio'),
      `cast description should mention candidateScoreLowestToHarmonicMeanRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
