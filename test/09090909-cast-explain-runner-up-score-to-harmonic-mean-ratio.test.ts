/**
 * 09090909: explanation.runnerUpScoreToHarmonicMeanRatio in ch1tty/cast when explain:true.
 *
 * runnerUpScoreToHarmonicMeanRatio: number — ratio of runner-up score to full-pool harmonic mean:
 * runnerUpScore / candidateScoreHarmonicMean.
 *
 * Present when: >= 2 candidates and candidateScoreHarmonicMean > 0 (all scores > 0).
 * Absent when: no_match, single candidate, any score === 0.
 * Always <= winnerScoreToHarmonicMeanRatio (runner-up <= winner).
 * For n=2: (w+r)/(2w) — same as candidateScoreMedianToWinnerRatio for n=2.
 * Identity: runnerUpScoreToHarmonicMeanRatio * candidateScoreHarmonicMean === runnerUpScore.
 *
 * Covered:
 *   09090909-1: present when >= 2 candidates and candidateScoreHarmonicMean > 0
 *   09090909-2: > 0 and finite when present
 *   09090909-3: <= winnerScoreToHarmonicMeanRatio when both present
 *   09090909-4: for n=2 equals (w+r)/(2w)
 *   09090909-5: absent on cast:no_match
 *   09090909-6: absent when only 1 candidate
 *   09090909-7: identity — runnerUpScoreToHarmonicMeanRatio * candidateScoreHarmonicMean === runnerUpScore
 *   09090909-8: tool description documents runnerUpScoreToHarmonicMeanRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-09090909-${label}-${Date.now()}.jsonl`);
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

test('09090909-1: present when >= 2 candidates and candidateScoreHarmonicMean > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('jj1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreHarmonicMean' in explanation && explanation.candidateScoreHarmonicMean > 0) {
      assert.ok('runnerUpScoreToHarmonicMeanRatio' in explanation,
        `runnerUpScoreToHarmonicMeanRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.runnerUpScoreToHarmonicMeanRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('09090909-2: > 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('jj2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToHarmonicMeanRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.runnerUpScoreToHarmonicMeanRatio),
        `should be finite, got ${explanation.runnerUpScoreToHarmonicMeanRatio}`,
      );
      assert.ok(
        explanation.runnerUpScoreToHarmonicMeanRatio > 0,
        `should be > 0, got ${explanation.runnerUpScoreToHarmonicMeanRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('09090909-3: <= winnerScoreToHarmonicMeanRatio when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('jj3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToHarmonicMeanRatio' in explanation && 'winnerScoreToHarmonicMeanRatio' in explanation) {
      assert.ok(
        explanation.runnerUpScoreToHarmonicMeanRatio <= explanation.winnerScoreToHarmonicMeanRatio + 1e-9,
        `runnerUpScoreToHarmonicMeanRatio (${explanation.runnerUpScoreToHarmonicMeanRatio}) should be <= winnerScoreToHarmonicMeanRatio (${explanation.winnerScoreToHarmonicMeanRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('09090909-4: for n=2 equals (w+r)/(2w)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('jj4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToHarmonicMeanRatio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0) {
      const w = explanation.winnerScore;
      const ru = explanation.runnerUpScore;
      const expected = (w + ru) / (2 * w);
      assert.ok(
        Math.abs(explanation.runnerUpScoreToHarmonicMeanRatio - expected) < 1e-9,
        `runnerUpScoreToHarmonicMeanRatio (${explanation.runnerUpScoreToHarmonicMeanRatio}) should equal (w+r)/(2w) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('09090909-5: absent on cast:no_match', async () => {
  const path = dlqPath('jj5');
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
      !('runnerUpScoreToHarmonicMeanRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.runnerUpScoreToHarmonicMeanRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('09090909-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('jj6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('runnerUpScoreToHarmonicMeanRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.runnerUpScoreToHarmonicMeanRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('09090909-7: identity — runnerUpScoreToHarmonicMeanRatio * candidateScoreHarmonicMean === runnerUpScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('jj7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToHarmonicMeanRatio' in explanation && 'candidateScoreHarmonicMean' in explanation && 'runnerUpScore' in explanation) {
      const product = explanation.runnerUpScoreToHarmonicMeanRatio * explanation.candidateScoreHarmonicMean;
      assert.ok(
        Math.abs(product - explanation.runnerUpScore) < 1e-9,
        `runnerUpScoreToHarmonicMeanRatio * candidateScoreHarmonicMean (${product}) should equal runnerUpScore (${explanation.runnerUpScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('09090909-8: tool description documents runnerUpScoreToHarmonicMeanRatio', async () => {
  const path = dlqPath('jj8');
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
      cast.description?.includes('runnerUpScoreToHarmonicMeanRatio'),
      `cast description should mention runnerUpScoreToHarmonicMeanRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
