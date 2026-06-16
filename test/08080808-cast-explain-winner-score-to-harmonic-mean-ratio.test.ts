/**
 * 08080808: explanation.winnerScoreToHarmonicMeanRatio in ch1tty/cast when explain:true.
 *
 * winnerScoreToHarmonicMeanRatio: number — ratio of winner score to full-pool harmonic mean:
 * winnerScore / candidateScoreHarmonicMean.
 *
 * Present when: >= 2 candidates and candidateScoreHarmonicMean > 0 (all scores > 0).
 * Absent when: no_match, single candidate, any score === 0.
 * Always >= winnerScoreToGeometricMeanRatio (HM <= GM, so winner/HM >= winner/GM).
 * Always >= 1 (winner >= harmonic mean always).
 * Identity: winnerScoreToHarmonicMeanRatio * candidateScoreHarmonicMean === winnerScore.
 * For n=2: (w+r)/(2r) — same as candidateScoreMeanToRunnerUpRatio for n=2.
 *
 * Covered:
 *   08080808-1: present when >= 2 candidates and candidateScoreHarmonicMean > 0
 *   08080808-2: >= 1 and finite when present
 *   08080808-3: >= winnerScoreToGeometricMeanRatio when both present (HM <= GM)
 *   08080808-4: for n=2 equals (w+r)/(2r)
 *   08080808-5: absent on cast:no_match
 *   08080808-6: absent when only 1 candidate
 *   08080808-7: identity — winnerScoreToHarmonicMeanRatio * candidateScoreHarmonicMean === winnerScore
 *   08080808-8: tool description documents winnerScoreToHarmonicMeanRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-08080808-${label}-${Date.now()}.jsonl`);
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

test('08080808-1: present when >= 2 candidates and candidateScoreHarmonicMean > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ii1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreHarmonicMean' in explanation && explanation.candidateScoreHarmonicMean > 0) {
      assert.ok('winnerScoreToHarmonicMeanRatio' in explanation,
        `winnerScoreToHarmonicMeanRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.winnerScoreToHarmonicMeanRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('08080808-2: >= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ii2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToHarmonicMeanRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.winnerScoreToHarmonicMeanRatio),
        `should be finite, got ${explanation.winnerScoreToHarmonicMeanRatio}`,
      );
      assert.ok(
        explanation.winnerScoreToHarmonicMeanRatio >= 1 - 1e-9,
        `should be >= 1 (winner >= harmonic mean), got ${explanation.winnerScoreToHarmonicMeanRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('08080808-3: >= winnerScoreToGeometricMeanRatio when both present (HM <= GM)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ii3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToHarmonicMeanRatio' in explanation && 'winnerScoreToGeometricMeanRatio' in explanation) {
      assert.ok(
        explanation.winnerScoreToHarmonicMeanRatio >= explanation.winnerScoreToGeometricMeanRatio - 1e-9,
        `winnerScoreToHarmonicMeanRatio (${explanation.winnerScoreToHarmonicMeanRatio}) should be >= winnerScoreToGeometricMeanRatio (${explanation.winnerScoreToGeometricMeanRatio}) since HM <= GM`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('08080808-4: for n=2 equals (w+r)/(2r)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ii4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToHarmonicMeanRatio' in explanation && explanation.candidateCount === 2 && explanation.runnerUpScore > 0) {
      const w = explanation.winnerScore;
      const ru = explanation.runnerUpScore;
      const expected = (w + ru) / (2 * ru);
      assert.ok(
        Math.abs(explanation.winnerScoreToHarmonicMeanRatio - expected) < 1e-9,
        `winnerScoreToHarmonicMeanRatio (${explanation.winnerScoreToHarmonicMeanRatio}) should equal (w+r)/(2r) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('08080808-5: absent on cast:no_match', async () => {
  const path = dlqPath('ii5');
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
      !('winnerScoreToHarmonicMeanRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.winnerScoreToHarmonicMeanRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('08080808-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ii6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('winnerScoreToHarmonicMeanRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.winnerScoreToHarmonicMeanRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('08080808-7: identity — winnerScoreToHarmonicMeanRatio * candidateScoreHarmonicMean === winnerScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ii7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToHarmonicMeanRatio' in explanation && 'candidateScoreHarmonicMean' in explanation && 'winnerScore' in explanation) {
      const product = explanation.winnerScoreToHarmonicMeanRatio * explanation.candidateScoreHarmonicMean;
      assert.ok(
        Math.abs(product - explanation.winnerScore) < 1e-9,
        `winnerScoreToHarmonicMeanRatio * candidateScoreHarmonicMean (${product}) should equal winnerScore (${explanation.winnerScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('08080808-8: tool description documents winnerScoreToHarmonicMeanRatio', async () => {
  const path = dlqPath('ii8');
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
      cast.description?.includes('winnerScoreToHarmonicMeanRatio'),
      `cast description should mention winnerScoreToHarmonicMeanRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
