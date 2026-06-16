/**
 * 44444444: explanation.candidateScoreP10ToMeanRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreP10ToMeanRatio: number — ratio of P10 to mean score:
 * candidateScoreP10 / candidateScoreMean.
 *
 * Present when: >= 2 candidates and candidateScoreEntropyTotal > 0.
 * Absent when: no_match, single candidate, or all scores === 0.
 * Typically < 1 (P10 < mean in right-skewed distributions).
 * Always >= candidateScoreP10ToWinnerRatio when both present (mean <= winner).
 * Always <= candidateScoreP75ToMeanRatio when both present (P10 <= P75).
 * Identity: candidateScoreP10ToMeanRatio * candidateScoreMean === candidateScoreP10.
 * For n=2: 2*(0.1*w + 0.9*r) / (w+r).
 *
 * Covered:
 *   44444444-1: present when >= 2 candidates and candidateScoreEntropyTotal > 0
 *   44444444-2: > 0 and finite when present
 *   44444444-3: always <= candidateScoreP75ToMeanRatio when both present (P10 <= P75)
 *   44444444-4: for n=2 equals 2*(0.1*w + 0.9*r) / (w+r)
 *   44444444-5: absent on cast:no_match
 *   44444444-6: absent when only 1 candidate
 *   44444444-7: identity — candidateScoreP10ToMeanRatio * candidateScoreMean === candidateScoreP10
 *   44444444-8: tool description documents candidateScoreP10ToMeanRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-44444444-${label}-${Date.now()}.jsonl`);
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

test('44444444-1: present when >= 2 candidates and candidateScoreEntropyTotal > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('d1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if (explanation.candidateScoreMean > 0 && 'candidateScoreP10' in explanation) {
      assert.ok('candidateScoreP10ToMeanRatio' in explanation,
        `candidateScoreP10ToMeanRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreP10ToMeanRatio, 'number', 'candidateScoreP10ToMeanRatio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('44444444-2: > 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('d2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP10ToMeanRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP10ToMeanRatio),
        `candidateScoreP10ToMeanRatio should be finite, got ${explanation.candidateScoreP10ToMeanRatio}`,
      );
      assert.ok(
        explanation.candidateScoreP10ToMeanRatio > 0,
        `candidateScoreP10ToMeanRatio should be > 0, got ${explanation.candidateScoreP10ToMeanRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('44444444-3: always <= candidateScoreP75ToMeanRatio when both present (P10 <= P75)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('d3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP10ToMeanRatio' in explanation && 'candidateScoreP75ToMeanRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreP10ToMeanRatio <= explanation.candidateScoreP75ToMeanRatio + 1e-9,
        `candidateScoreP10ToMeanRatio (${explanation.candidateScoreP10ToMeanRatio}) should be <= candidateScoreP75ToMeanRatio (${explanation.candidateScoreP75ToMeanRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('44444444-4: for n=2 equals 2*(0.1*w + 0.9*r) / (w+r)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('d4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP10ToMeanRatio' in explanation && explanation.candidateCount === 2 && explanation.candidateScoreMean > 0) {
      const p10 = 0.1 * explanation.winnerScore + 0.9 * explanation.runnerUpScore;
      const mean = (explanation.winnerScore + explanation.runnerUpScore) / 2;
      const expected = p10 / mean;
      assert.ok(
        Math.abs(explanation.candidateScoreP10ToMeanRatio - expected) < 1e-9,
        `candidateScoreP10ToMeanRatio (${explanation.candidateScoreP10ToMeanRatio}) should equal 2*(0.1w+0.9r)/(w+r) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('44444444-5: absent on cast:no_match', async () => {
  const path = dlqPath('d5');
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
      !('candidateScoreP10ToMeanRatio' in parsed.explanation),
      `candidateScoreP10ToMeanRatio should be absent on no_match, found: ${parsed.explanation.candidateScoreP10ToMeanRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('44444444-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('d6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP10ToMeanRatio' in explanation),
      `candidateScoreP10ToMeanRatio should be absent with single candidate, found: ${explanation.candidateScoreP10ToMeanRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('44444444-7: identity — candidateScoreP10ToMeanRatio * candidateScoreMean === candidateScoreP10', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('d7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP10ToMeanRatio' in explanation && 'candidateScoreMean' in explanation && 'candidateScoreP10' in explanation) {
      const product = explanation.candidateScoreP10ToMeanRatio * explanation.candidateScoreMean;
      assert.ok(
        Math.abs(product - explanation.candidateScoreP10) < 1e-9,
        `candidateScoreP10ToMeanRatio * candidateScoreMean (${product}) should equal candidateScoreP10 (${explanation.candidateScoreP10})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('44444444-8: tool description documents candidateScoreP10ToMeanRatio', async () => {
  const path = dlqPath('d8');
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
      cast.description?.includes('candidateScoreP10ToMeanRatio'),
      `cast description should mention candidateScoreP10ToMeanRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
