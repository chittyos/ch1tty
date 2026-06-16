/**
 * 22222222: explanation.candidateScoreP75ToMeanRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreP75ToMeanRatio: number — ratio of P75 (Q3) to mean score:
 * candidateScoreP75 / candidateScoreMean.
 *
 * Present when: >= 2 candidates and candidateScoreEntropyTotal > 0.
 * Absent when: no_match, single candidate, or all scores === 0.
 * Typically > 1 (P75 > mean in right-skewed distributions).
 * Always >= candidateScoreP75ToWinnerRatio when both present (mean <= winner).
 * Always <= candidateScoreP90ToMeanRatio when both present (P75 <= P90).
 * Identity: candidateScoreP75ToMeanRatio * candidateScoreMean === candidateScoreP75.
 * For n=2: 2*(0.75*w + 0.25*r) / (w+r).
 *
 * Covered:
 *   22222222-1: present when >= 2 candidates and candidateScoreEntropyTotal > 0
 *   22222222-2: > 0 and finite when present
 *   22222222-3: always <= candidateScoreP90ToMeanRatio when both present (P75 <= P90)
 *   22222222-4: for n=2 equals 2*(0.75*w + 0.25*r) / (w+r)
 *   22222222-5: absent on cast:no_match
 *   22222222-6: absent when only 1 candidate
 *   22222222-7: identity — candidateScoreP75ToMeanRatio * candidateScoreMean === candidateScoreP75
 *   22222222-8: tool description documents candidateScoreP75ToMeanRatio
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

test('22222222-1: present when >= 2 candidates and candidateScoreEntropyTotal > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('b1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if (explanation.candidateScoreMean > 0 && 'candidateScoreP75' in explanation) {
      assert.ok('candidateScoreP75ToMeanRatio' in explanation,
        `candidateScoreP75ToMeanRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreP75ToMeanRatio, 'number', 'candidateScoreP75ToMeanRatio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('22222222-2: > 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('b2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP75ToMeanRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP75ToMeanRatio),
        `candidateScoreP75ToMeanRatio should be finite, got ${explanation.candidateScoreP75ToMeanRatio}`,
      );
      assert.ok(
        explanation.candidateScoreP75ToMeanRatio > 0,
        `candidateScoreP75ToMeanRatio should be > 0, got ${explanation.candidateScoreP75ToMeanRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('22222222-3: always <= candidateScoreP90ToMeanRatio when both present (P75 <= P90)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('b3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP75ToMeanRatio' in explanation && 'candidateScoreP90ToMeanRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreP75ToMeanRatio <= explanation.candidateScoreP90ToMeanRatio + 1e-9,
        `candidateScoreP75ToMeanRatio (${explanation.candidateScoreP75ToMeanRatio}) should be <= candidateScoreP90ToMeanRatio (${explanation.candidateScoreP90ToMeanRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('22222222-4: for n=2 equals 2*(0.75*w + 0.25*r) / (w+r)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('b4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP75ToMeanRatio' in explanation && explanation.candidateCount === 2 && explanation.candidateScoreMean > 0) {
      const p75 = 0.75 * explanation.winnerScore + 0.25 * explanation.runnerUpScore;
      const mean = (explanation.winnerScore + explanation.runnerUpScore) / 2;
      const expected = p75 / mean;
      assert.ok(
        Math.abs(explanation.candidateScoreP75ToMeanRatio - expected) < 1e-9,
        `candidateScoreP75ToMeanRatio (${explanation.candidateScoreP75ToMeanRatio}) should equal 2*(0.75w+0.25r)/(w+r) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('22222222-5: absent on cast:no_match', async () => {
  const path = dlqPath('b5');
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
      !('candidateScoreP75ToMeanRatio' in parsed.explanation),
      `candidateScoreP75ToMeanRatio should be absent on no_match, found: ${parsed.explanation.candidateScoreP75ToMeanRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('22222222-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('b6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP75ToMeanRatio' in explanation),
      `candidateScoreP75ToMeanRatio should be absent with single candidate, found: ${explanation.candidateScoreP75ToMeanRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('22222222-7: identity — candidateScoreP75ToMeanRatio * candidateScoreMean === candidateScoreP75', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('b7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP75ToMeanRatio' in explanation && 'candidateScoreMean' in explanation && 'candidateScoreP75' in explanation) {
      const product = explanation.candidateScoreP75ToMeanRatio * explanation.candidateScoreMean;
      assert.ok(
        Math.abs(product - explanation.candidateScoreP75) < 1e-9,
        `candidateScoreP75ToMeanRatio * candidateScoreMean (${product}) should equal candidateScoreP75 (${explanation.candidateScoreP75})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('22222222-8: tool description documents candidateScoreP75ToMeanRatio', async () => {
  const path = dlqPath('b8');
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
      cast.description?.includes('candidateScoreP75ToMeanRatio'),
      `cast description should mention candidateScoreP75ToMeanRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
