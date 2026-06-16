/**
 * 33333333: explanation.candidateScoreP95ToMeanRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreP95ToMeanRatio: number — ratio of P95 to mean score:
 * candidateScoreP95 / candidateScoreMean.
 *
 * Present when: >= 2 candidates and candidateScoreEntropyTotal > 0.
 * Absent when: no_match, single candidate, or all scores === 0.
 * Typically > 1 (P95 > mean in right-skewed distributions).
 * Always >= candidateScoreP90ToMeanRatio when both present (P95 >= P90).
 * Always >= candidateScoreP95ToWinnerRatio when both present (mean <= winner).
 * Identity: candidateScoreP95ToMeanRatio * candidateScoreMean === candidateScoreP95.
 * For n=2: 2*(0.95*w + 0.05*r) / (w+r).
 *
 * Covered:
 *   33333333-1: present when >= 2 candidates and candidateScoreEntropyTotal > 0
 *   33333333-2: > 0 and finite when present
 *   33333333-3: always >= candidateScoreP90ToMeanRatio when both present (P95 >= P90)
 *   33333333-4: for n=2 equals 2*(0.95*w + 0.05*r) / (w+r)
 *   33333333-5: absent on cast:no_match
 *   33333333-6: absent when only 1 candidate
 *   33333333-7: identity — candidateScoreP95ToMeanRatio * candidateScoreMean === candidateScoreP95
 *   33333333-8: tool description documents candidateScoreP95ToMeanRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-33333333-${label}-${Date.now()}.jsonl`);
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

test('33333333-1: present when >= 2 candidates and candidateScoreEntropyTotal > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('c1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if (explanation.candidateScoreMean > 0 && 'candidateScoreP95' in explanation) {
      assert.ok('candidateScoreP95ToMeanRatio' in explanation,
        `candidateScoreP95ToMeanRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreP95ToMeanRatio, 'number', 'candidateScoreP95ToMeanRatio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('33333333-2: > 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('c2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP95ToMeanRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP95ToMeanRatio),
        `candidateScoreP95ToMeanRatio should be finite, got ${explanation.candidateScoreP95ToMeanRatio}`,
      );
      assert.ok(
        explanation.candidateScoreP95ToMeanRatio > 0,
        `candidateScoreP95ToMeanRatio should be > 0, got ${explanation.candidateScoreP95ToMeanRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('33333333-3: always >= candidateScoreP90ToMeanRatio when both present (P95 >= P90)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('c3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP95ToMeanRatio' in explanation && 'candidateScoreP90ToMeanRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreP95ToMeanRatio >= explanation.candidateScoreP90ToMeanRatio - 1e-9,
        `candidateScoreP95ToMeanRatio (${explanation.candidateScoreP95ToMeanRatio}) should be >= candidateScoreP90ToMeanRatio (${explanation.candidateScoreP90ToMeanRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('33333333-4: for n=2 equals 2*(0.95*w + 0.05*r) / (w+r)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('c4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP95ToMeanRatio' in explanation && explanation.candidateCount === 2 && explanation.candidateScoreMean > 0) {
      const p95 = 0.95 * explanation.winnerScore + 0.05 * explanation.runnerUpScore;
      const mean = (explanation.winnerScore + explanation.runnerUpScore) / 2;
      const expected = p95 / mean;
      assert.ok(
        Math.abs(explanation.candidateScoreP95ToMeanRatio - expected) < 1e-9,
        `candidateScoreP95ToMeanRatio (${explanation.candidateScoreP95ToMeanRatio}) should equal 2*(0.95w+0.05r)/(w+r) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('33333333-5: absent on cast:no_match', async () => {
  const path = dlqPath('c5');
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
      !('candidateScoreP95ToMeanRatio' in parsed.explanation),
      `candidateScoreP95ToMeanRatio should be absent on no_match, found: ${parsed.explanation.candidateScoreP95ToMeanRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('33333333-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('c6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP95ToMeanRatio' in explanation),
      `candidateScoreP95ToMeanRatio should be absent with single candidate, found: ${explanation.candidateScoreP95ToMeanRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('33333333-7: identity — candidateScoreP95ToMeanRatio * candidateScoreMean === candidateScoreP95', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('c7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP95ToMeanRatio' in explanation && 'candidateScoreMean' in explanation && 'candidateScoreP95' in explanation) {
      const product = explanation.candidateScoreP95ToMeanRatio * explanation.candidateScoreMean;
      assert.ok(
        Math.abs(product - explanation.candidateScoreP95) < 1e-9,
        `candidateScoreP95ToMeanRatio * candidateScoreMean (${product}) should equal candidateScoreP95 (${explanation.candidateScoreP95})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('33333333-8: tool description documents candidateScoreP95ToMeanRatio', async () => {
  const path = dlqPath('c8');
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
      cast.description?.includes('candidateScoreP95ToMeanRatio'),
      `cast description should mention candidateScoreP95ToMeanRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
