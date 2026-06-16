/**
 * 13131313: explanation.candidateScoreGeometricMeanToHarmonicMeanRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreGeometricMeanToHarmonicMeanRatio: number — ratio of geometric mean to harmonic mean:
 * candidateScoreGeometricMean / candidateScoreHarmonicMean.
 *
 * Present when: >= 2 candidates, all scores > 0 (both GM and HM defined and > 0).
 * Absent when: no_match, single candidate, any score === 0.
 * Always >= 1 since GM >= HM always.
 * Exact inverse of candidateScoreHarmonicMeanToGeometricMeanRatio: product === 1.
 * For n=2: (w+r)/(2*sqrt(wr)) — same as candidateScoreMeanToGeometricMeanRatio for n=2.
 * Identity: candidateScoreGeometricMeanToHarmonicMeanRatio * candidateScoreHarmonicMean === candidateScoreGeometricMean.
 *
 * Covered:
 *   13131313-1: present when >= 2 candidates and both GM > 0 and HM > 0
 *   13131313-2: >= 1 and finite when present
 *   13131313-3: inverse of candidateScoreHarmonicMeanToGeometricMeanRatio — product === 1 when both present
 *   13131313-4: for n=2 equals (w+r)/(2*sqrt(wr))
 *   13131313-5: absent on cast:no_match
 *   13131313-6: absent when only 1 candidate
 *   13131313-7: identity — candidateScoreGeometricMeanToHarmonicMeanRatio * candidateScoreHarmonicMean === candidateScoreGeometricMean
 *   13131313-8: tool description documents candidateScoreGeometricMeanToHarmonicMeanRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-13131313-${label}-${Date.now()}.jsonl`);
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

test('13131313-1: present when >= 2 candidates and both GM > 0 and HM > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('nn1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreGeometricMean' in explanation && explanation.candidateScoreGeometricMean > 0 &&
        'candidateScoreHarmonicMean' in explanation && explanation.candidateScoreHarmonicMean > 0) {
      assert.ok('candidateScoreGeometricMeanToHarmonicMeanRatio' in explanation,
        `candidateScoreGeometricMeanToHarmonicMeanRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreGeometricMeanToHarmonicMeanRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('13131313-2: >= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('nn2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreGeometricMeanToHarmonicMeanRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreGeometricMeanToHarmonicMeanRatio),
        `should be finite, got ${explanation.candidateScoreGeometricMeanToHarmonicMeanRatio}`,
      );
      assert.ok(
        explanation.candidateScoreGeometricMeanToHarmonicMeanRatio >= 1 - 1e-9,
        `should be >= 1 (GM >= HM), got ${explanation.candidateScoreGeometricMeanToHarmonicMeanRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('13131313-3: inverse of candidateScoreHarmonicMeanToGeometricMeanRatio — product === 1 when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('nn3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreGeometricMeanToHarmonicMeanRatio' in explanation && 'candidateScoreHarmonicMeanToGeometricMeanRatio' in explanation) {
      const product = explanation.candidateScoreGeometricMeanToHarmonicMeanRatio * explanation.candidateScoreHarmonicMeanToGeometricMeanRatio;
      assert.ok(
        Math.abs(product - 1) < 1e-9,
        `candidateScoreGeometricMeanToHarmonicMeanRatio * candidateScoreHarmonicMeanToGeometricMeanRatio (${product}) should equal 1`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('13131313-4: for n=2 equals (w+r)/(2*sqrt(wr))', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('nn4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreGeometricMeanToHarmonicMeanRatio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0 && explanation.runnerUpScore > 0) {
      const w = explanation.winnerScore;
      const ru = explanation.runnerUpScore;
      const expected = (w + ru) / (2 * Math.sqrt(w * ru));
      assert.ok(
        Math.abs(explanation.candidateScoreGeometricMeanToHarmonicMeanRatio - expected) < 1e-9,
        `candidateScoreGeometricMeanToHarmonicMeanRatio (${explanation.candidateScoreGeometricMeanToHarmonicMeanRatio}) should equal (w+r)/(2*sqrt(wr)) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('13131313-5: absent on cast:no_match', async () => {
  const path = dlqPath('nn5');
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
      !('candidateScoreGeometricMeanToHarmonicMeanRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.candidateScoreGeometricMeanToHarmonicMeanRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('13131313-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('nn6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreGeometricMeanToHarmonicMeanRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.candidateScoreGeometricMeanToHarmonicMeanRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('13131313-7: identity — candidateScoreGeometricMeanToHarmonicMeanRatio * candidateScoreHarmonicMean === candidateScoreGeometricMean', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('nn7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreGeometricMeanToHarmonicMeanRatio' in explanation && 'candidateScoreHarmonicMean' in explanation && 'candidateScoreGeometricMean' in explanation) {
      const product = explanation.candidateScoreGeometricMeanToHarmonicMeanRatio * explanation.candidateScoreHarmonicMean;
      assert.ok(
        Math.abs(product - explanation.candidateScoreGeometricMean) < 1e-9,
        `candidateScoreGeometricMeanToHarmonicMeanRatio * candidateScoreHarmonicMean (${product}) should equal candidateScoreGeometricMean (${explanation.candidateScoreGeometricMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('13131313-8: tool description documents candidateScoreGeometricMeanToHarmonicMeanRatio', async () => {
  const path = dlqPath('nn8');
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
      cast.description?.includes('candidateScoreGeometricMeanToHarmonicMeanRatio'),
      `cast description should mention candidateScoreGeometricMeanToHarmonicMeanRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
