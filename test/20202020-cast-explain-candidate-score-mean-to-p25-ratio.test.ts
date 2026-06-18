/**
 * 20202020: explanation.candidateScoreMeanToP25Ratio in ch1tty/cast when explain:true.
 *
 * candidateScoreMeanToP25Ratio: number — ratio of mean to P25 (Q1) score:
 * candidateScoreMean / candidateScoreP25.
 *
 * Present when: >= 2 candidates and candidateScoreP25 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP25 === 0.
 * Typically > 1 (mean > P25 in right-skewed distributions).
 * Always <= candidateScoreMeanToP10Ratio when both present (P25 >= P10).
 * Always >= candidateScoreMeanToP75Ratio when both present (P25 <= P75).
 * Exact inverse of candidateScoreP25ToMeanRatio: product === 1.
 * Identity: candidateScoreMeanToP25Ratio * candidateScoreP25 === candidateScoreMean.
 * For n=2: (w+r) / (2*(0.25*w + 0.75*r)).
 *
 * Covered:
 *   20202020-1: present when >= 2 candidates and candidateScoreP25 > 0
 *   20202020-2: > 0 and finite when present
 *   20202020-3: always <= candidateScoreMeanToP10Ratio when both present (P25 >= P10)
 *   20202020-4: for n=2 equals (w+r) / (2*(0.25*w + 0.75*r))
 *   20202020-5: absent on cast:no_match
 *   20202020-6: absent when only 1 candidate
 *   20202020-7: identity — candidateScoreMeanToP25Ratio * candidateScoreP25 === candidateScoreMean
 *   20202020-8: tool description documents candidateScoreMeanToP25Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-20202020-${label}-${Date.now()}.jsonl`);
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

test('20202020-1: present when >= 2 candidates and candidateScoreP25 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP25' in explanation && explanation.candidateScoreP25 > 0) {
      assert.ok('candidateScoreMeanToP25Ratio' in explanation,
        `candidateScoreMeanToP25Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreMeanToP25Ratio, 'number', 'candidateScoreMeanToP25Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('20202020-2: > 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToP25Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreMeanToP25Ratio),
        `candidateScoreMeanToP25Ratio should be finite, got ${explanation.candidateScoreMeanToP25Ratio}`,
      );
      assert.ok(
        explanation.candidateScoreMeanToP25Ratio > 0,
        `candidateScoreMeanToP25Ratio should be > 0, got ${explanation.candidateScoreMeanToP25Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('20202020-3: always <= candidateScoreMeanToP10Ratio when both present (P25 >= P10)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToP25Ratio' in explanation && 'candidateScoreMeanToP10Ratio' in explanation) {
      assert.ok(
        explanation.candidateScoreMeanToP25Ratio <= explanation.candidateScoreMeanToP10Ratio + 1e-9,
        `candidateScoreMeanToP25Ratio (${explanation.candidateScoreMeanToP25Ratio}) should be <= candidateScoreMeanToP10Ratio (${explanation.candidateScoreMeanToP10Ratio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('20202020-4: for n=2 equals (w+r) / (2*(0.25*w + 0.75*r))', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToP25Ratio' in explanation && explanation.candidateCount === 2 && explanation.candidateScoreP25 > 0) {
      const mean = (explanation.winnerScore + explanation.runnerUpScore) / 2;
      const p25 = 0.25 * explanation.winnerScore + 0.75 * explanation.runnerUpScore;
      const expected = mean / p25;
      assert.ok(
        Math.abs(explanation.candidateScoreMeanToP25Ratio - expected) < 1e-9,
        `candidateScoreMeanToP25Ratio (${explanation.candidateScoreMeanToP25Ratio}) should equal (w+r)/(2*(0.25w+0.75r)) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('20202020-5: absent on cast:no_match', async () => {
  const path = dlqPath('k5');
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
      !('candidateScoreMeanToP25Ratio' in parsed.explanation),
      `candidateScoreMeanToP25Ratio should be absent on no_match, found: ${parsed.explanation.candidateScoreMeanToP25Ratio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('20202020-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreMeanToP25Ratio' in explanation),
      `candidateScoreMeanToP25Ratio should be absent with single candidate, found: ${explanation.candidateScoreMeanToP25Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('20202020-7: identity — candidateScoreMeanToP25Ratio * candidateScoreP25 === candidateScoreMean', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToP25Ratio' in explanation && 'candidateScoreP25' in explanation && 'candidateScoreMean' in explanation) {
      const product = explanation.candidateScoreMeanToP25Ratio * explanation.candidateScoreP25;
      assert.ok(
        Math.abs(product - explanation.candidateScoreMean) < 1e-9,
        `candidateScoreMeanToP25Ratio * candidateScoreP25 (${product}) should equal candidateScoreMean (${explanation.candidateScoreMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('20202020-8: tool description documents candidateScoreMeanToP25Ratio', async () => {
  const path = dlqPath('k8');
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
      cast.description?.includes('candidateScoreMeanToP25Ratio'),
      `cast description should mention candidateScoreMeanToP25Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
