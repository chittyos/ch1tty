/**
 * 12121212: explanation.candidateScoreHarmonicMeanToGeometricMeanRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreHarmonicMeanToGeometricMeanRatio: number — ratio of harmonic mean to geometric mean:
 * candidateScoreHarmonicMean / candidateScoreGeometricMean.
 *
 * Present when: >= 2 candidates, all scores > 0 (both HM and GM defined and > 0).
 * Absent when: no_match, single candidate, any score === 0.
 * Always in (0, 1] since HM <= GM always.
 * Always >= candidateScoreHarmonicMeanToMeanRatio (since GM <= AM, HM/GM >= HM/AM).
 * For n=2: 2*sqrt(wr)/(w+r) — same as candidateScoreGeometricMeanToMeanRatio for n=2.
 * Identity: candidateScoreHarmonicMeanToGeometricMeanRatio * candidateScoreGeometricMean === candidateScoreHarmonicMean.
 *
 * Covered:
 *   12121212-1: present when >= 2 candidates and both HM > 0 and GM > 0
 *   12121212-2: in (0, 1] and finite when present
 *   12121212-3: >= candidateScoreHarmonicMeanToMeanRatio when both present (GM <= AM so HM/GM >= HM/AM)
 *   12121212-4: for n=2 equals 2*sqrt(wr)/(w+r)
 *   12121212-5: absent on cast:no_match
 *   12121212-6: absent when only 1 candidate
 *   12121212-7: identity — candidateScoreHarmonicMeanToGeometricMeanRatio * candidateScoreGeometricMean === candidateScoreHarmonicMean
 *   12121212-8: tool description documents candidateScoreHarmonicMeanToGeometricMeanRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-12121212-${label}-${Date.now()}.jsonl`);
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

test('12121212-1: present when >= 2 candidates and both HM > 0 and GM > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('mm1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreHarmonicMean' in explanation && explanation.candidateScoreHarmonicMean > 0 &&
        'candidateScoreGeometricMean' in explanation && explanation.candidateScoreGeometricMean > 0) {
      assert.ok('candidateScoreHarmonicMeanToGeometricMeanRatio' in explanation,
        `candidateScoreHarmonicMeanToGeometricMeanRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreHarmonicMeanToGeometricMeanRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('12121212-2: in (0, 1] and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('mm2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreHarmonicMeanToGeometricMeanRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreHarmonicMeanToGeometricMeanRatio),
        `should be finite, got ${explanation.candidateScoreHarmonicMeanToGeometricMeanRatio}`,
      );
      assert.ok(
        explanation.candidateScoreHarmonicMeanToGeometricMeanRatio > 0,
        `should be > 0, got ${explanation.candidateScoreHarmonicMeanToGeometricMeanRatio}`,
      );
      assert.ok(
        explanation.candidateScoreHarmonicMeanToGeometricMeanRatio <= 1 + 1e-9,
        `should be <= 1 (HM <= GM), got ${explanation.candidateScoreHarmonicMeanToGeometricMeanRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('12121212-3: >= candidateScoreHarmonicMeanToMeanRatio when both present (GM <= AM so HM/GM >= HM/AM)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('mm3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreHarmonicMeanToGeometricMeanRatio' in explanation && 'candidateScoreHarmonicMeanToMeanRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreHarmonicMeanToGeometricMeanRatio >= explanation.candidateScoreHarmonicMeanToMeanRatio - 1e-9,
        `candidateScoreHarmonicMeanToGeometricMeanRatio (${explanation.candidateScoreHarmonicMeanToGeometricMeanRatio}) should be >= candidateScoreHarmonicMeanToMeanRatio (${explanation.candidateScoreHarmonicMeanToMeanRatio}) since GM <= AM`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('12121212-4: for n=2 equals 2*sqrt(wr)/(w+r)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('mm4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreHarmonicMeanToGeometricMeanRatio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0 && explanation.runnerUpScore > 0) {
      const w = explanation.winnerScore;
      const ru = explanation.runnerUpScore;
      const expected = (2 * Math.sqrt(w * ru)) / (w + ru);
      assert.ok(
        Math.abs(explanation.candidateScoreHarmonicMeanToGeometricMeanRatio - expected) < 1e-9,
        `candidateScoreHarmonicMeanToGeometricMeanRatio (${explanation.candidateScoreHarmonicMeanToGeometricMeanRatio}) should equal 2*sqrt(wr)/(w+r) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('12121212-5: absent on cast:no_match', async () => {
  const path = dlqPath('mm5');
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
      !('candidateScoreHarmonicMeanToGeometricMeanRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.candidateScoreHarmonicMeanToGeometricMeanRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('12121212-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('mm6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreHarmonicMeanToGeometricMeanRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.candidateScoreHarmonicMeanToGeometricMeanRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('12121212-7: identity — candidateScoreHarmonicMeanToGeometricMeanRatio * candidateScoreGeometricMean === candidateScoreHarmonicMean', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('mm7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreHarmonicMeanToGeometricMeanRatio' in explanation && 'candidateScoreGeometricMean' in explanation && 'candidateScoreHarmonicMean' in explanation) {
      const product = explanation.candidateScoreHarmonicMeanToGeometricMeanRatio * explanation.candidateScoreGeometricMean;
      assert.ok(
        Math.abs(product - explanation.candidateScoreHarmonicMean) < 1e-9,
        `candidateScoreHarmonicMeanToGeometricMeanRatio * candidateScoreGeometricMean (${product}) should equal candidateScoreHarmonicMean (${explanation.candidateScoreHarmonicMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('12121212-8: tool description documents candidateScoreHarmonicMeanToGeometricMeanRatio', async () => {
  const path = dlqPath('mm8');
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
      cast.description?.includes('candidateScoreHarmonicMeanToGeometricMeanRatio'),
      `cast description should mention candidateScoreHarmonicMeanToGeometricMeanRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
