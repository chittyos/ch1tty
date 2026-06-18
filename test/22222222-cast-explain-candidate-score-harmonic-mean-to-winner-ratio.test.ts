/**
 * 22222222: explanation.candidateScoreHarmonicMeanToWinnerRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreHarmonicMeanToWinnerRatio: number — ratio of harmonic mean to winner score:
 * candidateScoreHarmonicMean / winnerScore.
 *
 * Present when: >= 2 candidates, all scores > 0 (HM defined), and winnerScore > 0.
 * Absent when: no_match, single candidate, any score === 0, winnerScore === 0.
 * Always in (0, 1]: HM <= GM <= AM <= winner always.
 * Exact inverse of winnerScoreToHarmonicMeanRatio: product === 1.
 * Always <= candidateScoreGeometricMeanToWinnerRatio: HM <= GM so HM/winner <= GM/winner.
 * For n=2: HM = 2wr/(w+r), winner = w; ratio = 2r/(w+r) === runnerUpScoreToMeanRatio for n=2.
 * Identity: candidateScoreHarmonicMeanToWinnerRatio * winnerScore === candidateScoreHarmonicMean.
 *
 * Covered:
 *   22222222-1: present when >= 2 candidates, all scores > 0, and winnerScore > 0
 *   22222222-2: always in (0, 1] when present
 *   22222222-3: inverse of winnerScoreToHarmonicMeanRatio — product === 1 when both present
 *   22222222-4: for n=2 equals 2r/(w+r)
 *   22222222-5: absent on cast:no_match
 *   22222222-6: absent when only 1 candidate
 *   22222222-7: identity — candidateScoreHarmonicMeanToWinnerRatio * winnerScore === candidateScoreHarmonicMean
 *   22222222-8: tool description documents candidateScoreHarmonicMeanToWinnerRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-22222222-${label}-${Date.now()}.jsonl`);
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

test('22222222-1: present when >= 2 candidates, all scores > 0, and winnerScore > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ww1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreHarmonicMean' in explanation && explanation.candidateScoreHarmonicMean > 0 &&
        'winnerScore' in explanation && explanation.winnerScore > 0) {
      assert.ok('candidateScoreHarmonicMeanToWinnerRatio' in explanation,
        `candidateScoreHarmonicMeanToWinnerRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreHarmonicMeanToWinnerRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('22222222-2: always in (0, 1] when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ww2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreHarmonicMeanToWinnerRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreHarmonicMeanToWinnerRatio),
        `should be finite, got ${explanation.candidateScoreHarmonicMeanToWinnerRatio}`,
      );
      assert.ok(
        explanation.candidateScoreHarmonicMeanToWinnerRatio > 0,
        `should be > 0, got ${explanation.candidateScoreHarmonicMeanToWinnerRatio}`,
      );
      assert.ok(
        explanation.candidateScoreHarmonicMeanToWinnerRatio <= 1,
        `should be <= 1, got ${explanation.candidateScoreHarmonicMeanToWinnerRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('22222222-3: inverse of winnerScoreToHarmonicMeanRatio — product === 1 when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ww3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreHarmonicMeanToWinnerRatio' in explanation && 'winnerScoreToHarmonicMeanRatio' in explanation) {
      const product = explanation.candidateScoreHarmonicMeanToWinnerRatio * explanation.winnerScoreToHarmonicMeanRatio;
      assert.ok(
        Math.abs(product - 1) < 1e-9,
        `candidateScoreHarmonicMeanToWinnerRatio * winnerScoreToHarmonicMeanRatio (${product}) should equal 1`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('22222222-4: for n=2 equals 2r/(w+r)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ww4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreHarmonicMeanToWinnerRatio' in explanation && explanation.candidateCount === 2 &&
        explanation.winnerScore > 0 && explanation.runnerUpScore > 0) {
      const w = explanation.winnerScore;
      const ru = explanation.runnerUpScore;
      const expected = (2 * ru) / (w + ru);
      assert.ok(
        Math.abs(explanation.candidateScoreHarmonicMeanToWinnerRatio - expected) < 1e-9,
        `candidateScoreHarmonicMeanToWinnerRatio (${explanation.candidateScoreHarmonicMeanToWinnerRatio}) should equal 2r/(w+r) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('22222222-5: absent on cast:no_match', async () => {
  const path = dlqPath('ww5');
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
      !('candidateScoreHarmonicMeanToWinnerRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.candidateScoreHarmonicMeanToWinnerRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('22222222-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ww6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreHarmonicMeanToWinnerRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.candidateScoreHarmonicMeanToWinnerRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('22222222-7: identity — candidateScoreHarmonicMeanToWinnerRatio * winnerScore === candidateScoreHarmonicMean', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ww7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreHarmonicMeanToWinnerRatio' in explanation &&
        'winnerScore' in explanation &&
        'candidateScoreHarmonicMean' in explanation) {
      const product = explanation.candidateScoreHarmonicMeanToWinnerRatio * explanation.winnerScore;
      assert.ok(
        Math.abs(product - explanation.candidateScoreHarmonicMean) < 1e-9,
        `candidateScoreHarmonicMeanToWinnerRatio * winnerScore (${product}) should equal candidateScoreHarmonicMean (${explanation.candidateScoreHarmonicMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('22222222-8: tool description documents candidateScoreHarmonicMeanToWinnerRatio', async () => {
  const path = dlqPath('ww8');
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
      cast.description?.includes('candidateScoreHarmonicMeanToWinnerRatio'),
      `cast description should mention candidateScoreHarmonicMeanToWinnerRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
