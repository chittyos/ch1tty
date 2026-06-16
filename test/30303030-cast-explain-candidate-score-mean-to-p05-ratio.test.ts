/**
 * 30303030: explanation.candidateScoreMeanToP05Ratio in ch1tty/cast when explain:true.
 *
 * candidateScoreMeanToP05Ratio: number — ratio of mean to P05 score:
 * candidateScoreMean / candidateScoreP05.
 *
 * Present when: >= 2 candidates and candidateScoreP05 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP05 === 0.
 * The largest of the mean/Px family (P05 is the smallest denominator).
 * Always >= candidateScoreMeanToP10Ratio when both present (P05 <= P10).
 * Exact inverse of candidateScoreP05ToMeanRatio: product === 1.
 * Identity: candidateScoreMeanToP05Ratio * candidateScoreP05 === candidateScoreMean.
 * For n=2: (w+r) / (2*(0.05*w + 0.95*r)).
 *
 * Covered:
 *   30303030-1: present when >= 2 candidates and candidateScoreP05 > 0
 *   30303030-2: > 0 and finite when present
 *   30303030-3: always >= candidateScoreMeanToP10Ratio when both present (P05 <= P10)
 *   30303030-4: for n=2 equals (w+r) / (2*(0.05*w + 0.95*r))
 *   30303030-5: absent on cast:no_match
 *   30303030-6: absent when only 1 candidate
 *   30303030-7: identity — candidateScoreMeanToP05Ratio * candidateScoreP05 === candidateScoreMean
 *   30303030-8: tool description documents candidateScoreMeanToP05Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-30303030-${label}-${Date.now()}.jsonl`);
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

test('30303030-1: present when >= 2 candidates and candidateScoreP05 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('l1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP05' in explanation && explanation.candidateScoreP05 > 0) {
      assert.ok('candidateScoreMeanToP05Ratio' in explanation,
        `candidateScoreMeanToP05Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreMeanToP05Ratio, 'number', 'candidateScoreMeanToP05Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('30303030-2: > 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('l2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToP05Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreMeanToP05Ratio),
        `candidateScoreMeanToP05Ratio should be finite, got ${explanation.candidateScoreMeanToP05Ratio}`,
      );
      assert.ok(
        explanation.candidateScoreMeanToP05Ratio > 0,
        `candidateScoreMeanToP05Ratio should be > 0, got ${explanation.candidateScoreMeanToP05Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('30303030-3: always >= candidateScoreMeanToP10Ratio when both present (P05 <= P10)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('l3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToP05Ratio' in explanation && 'candidateScoreMeanToP10Ratio' in explanation) {
      assert.ok(
        explanation.candidateScoreMeanToP05Ratio >= explanation.candidateScoreMeanToP10Ratio - 1e-9,
        `candidateScoreMeanToP05Ratio (${explanation.candidateScoreMeanToP05Ratio}) should be >= candidateScoreMeanToP10Ratio (${explanation.candidateScoreMeanToP10Ratio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('30303030-4: for n=2 equals (w+r) / (2*(0.05*w + 0.95*r))', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('l4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToP05Ratio' in explanation && explanation.candidateCount === 2 && explanation.candidateScoreP05 > 0) {
      const mean = (explanation.winnerScore + explanation.runnerUpScore) / 2;
      const p05 = 0.05 * explanation.winnerScore + 0.95 * explanation.runnerUpScore;
      const expected = mean / p05;
      assert.ok(
        Math.abs(explanation.candidateScoreMeanToP05Ratio - expected) < 1e-9,
        `candidateScoreMeanToP05Ratio (${explanation.candidateScoreMeanToP05Ratio}) should equal (w+r)/(2*(0.05w+0.95r)) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('30303030-5: absent on cast:no_match', async () => {
  const path = dlqPath('l5');
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
      !('candidateScoreMeanToP05Ratio' in parsed.explanation),
      `candidateScoreMeanToP05Ratio should be absent on no_match, found: ${parsed.explanation.candidateScoreMeanToP05Ratio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('30303030-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('l6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreMeanToP05Ratio' in explanation),
      `candidateScoreMeanToP05Ratio should be absent with single candidate, found: ${explanation.candidateScoreMeanToP05Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('30303030-7: identity — candidateScoreMeanToP05Ratio * candidateScoreP05 === candidateScoreMean', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('l7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToP05Ratio' in explanation && 'candidateScoreP05' in explanation && 'candidateScoreMean' in explanation) {
      const product = explanation.candidateScoreMeanToP05Ratio * explanation.candidateScoreP05;
      assert.ok(
        Math.abs(product - explanation.candidateScoreMean) < 1e-9,
        `candidateScoreMeanToP05Ratio * candidateScoreP05 (${product}) should equal candidateScoreMean (${explanation.candidateScoreMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('30303030-8: tool description documents candidateScoreMeanToP05Ratio', async () => {
  const path = dlqPath('l8');
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
      cast.description?.includes('candidateScoreMeanToP05Ratio'),
      `cast description should mention candidateScoreMeanToP05Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
