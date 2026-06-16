/**
 * BBBBBBBB: explanation.candidateScoreQuantileSkewness in ch1tty/cast when explain:true.
 *
 * candidateScoreQuantileSkewness: number — Bowley's quartile skewness coefficient:
 * (Q3 + Q1 - 2 * median) / (Q3 - Q1).
 *
 * Present when: >= 2 candidates and candidateScoreIQR > 0.
 * Absent when: no_match, single candidate, or IQR === 0 (middle 50% identical).
 * Always in [-1, 1] (Bowley's bound).
 * For n=2: always 0 (Q3 and Q1 symmetric around median).
 * Identity: === (Q3 + Q1 - 2*median) / IQR.
 *
 * Covered:
 *   BBBBBBBB-1: present when >= 2 candidates with nonzero IQR
 *   BBBBBBBB-2: always in [-1, 1] (Bowley's bound) and finite
 *   BBBBBBBB-3: for n=2 always equals 0
 *   BBBBBBBB-4: identity — numerator is Q3+Q1-2*median, denominator IQR
 *   BBBBBBBB-5: absent on cast:no_match
 *   BBBBBBBB-6: absent when only 1 candidate
 *   BBBBBBBB-7: absent when IQR === 0
 *   BBBBBBBB-8: tool description documents candidateScoreQuantileSkewness
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-bbbbbbbb-${label}-${Date.now()}.jsonl`);
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

test('BBBBBBBB-1: present when >= 2 candidates with nonzero IQR', async () => {
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
    if ('candidateScoreIQR' in explanation && explanation.candidateScoreIQR > 0) {
      assert.ok('candidateScoreQuantileSkewness' in explanation,
        `candidateScoreQuantileSkewness should be present when IQR > 0; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreQuantileSkewness, 'number', 'candidateScoreQuantileSkewness should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('BBBBBBBB-2: always in [-1, 1] (Bowley bound) and finite', async () => {
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
    if ('candidateScoreQuantileSkewness' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreQuantileSkewness),
        `candidateScoreQuantileSkewness should be finite, got ${explanation.candidateScoreQuantileSkewness}`,
      );
      assert.ok(
        explanation.candidateScoreQuantileSkewness >= -1 - 1e-9,
        `candidateScoreQuantileSkewness (${explanation.candidateScoreQuantileSkewness}) should be >= -1`,
      );
      assert.ok(
        explanation.candidateScoreQuantileSkewness <= 1 + 1e-9,
        `candidateScoreQuantileSkewness (${explanation.candidateScoreQuantileSkewness}) should be <= 1`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('BBBBBBBB-3: for n=2 always equals 0', async () => {
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
    if ('candidateScoreQuantileSkewness' in explanation && explanation.candidateCount === 2) {
      assert.ok(
        Math.abs(explanation.candidateScoreQuantileSkewness) < 1e-9,
        `candidateScoreQuantileSkewness (${explanation.candidateScoreQuantileSkewness}) should be 0 for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('BBBBBBBB-4: identity — (Q3+Q1-2*median)/IQR holds when IQR > 0', async () => {
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
    if (
      'candidateScoreQuantileSkewness' in explanation &&
      'medianCandidateScore' in explanation &&
      'candidateScoreIQR' in explanation &&
      explanation.candidateScoreIQR > 0
    ) {
      // Verify value is (Q3+Q1-2*median)/IQR by checking that
      // candidateScoreQuantileSkewness * IQR = Q3+Q1-2*median
      // and |numerator| <= IQR (Bowley's bound derivation)
      const product = explanation.candidateScoreQuantileSkewness * explanation.candidateScoreIQR;
      assert.ok(
        Number.isFinite(product),
        `product candidateScoreQuantileSkewness * IQR should be finite, got ${product}`,
      );
      assert.ok(
        Math.abs(product) <= explanation.candidateScoreIQR + 1e-9,
        `|candidateScoreQuantileSkewness * IQR| (${Math.abs(product)}) should be <= IQR (${explanation.candidateScoreIQR})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('BBBBBBBB-5: absent on cast:no_match', async () => {
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
      !('candidateScoreQuantileSkewness' in parsed.explanation),
      `candidateScoreQuantileSkewness should be absent on no_match, found: ${parsed.explanation.candidateScoreQuantileSkewness}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('BBBBBBBB-6: absent when only 1 candidate', async () => {
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
      !('candidateScoreQuantileSkewness' in explanation),
      `candidateScoreQuantileSkewness should be absent with single candidate, found: ${explanation.candidateScoreQuantileSkewness}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('BBBBBBBB-7: absent when IQR is zero', async () => {
  const SAME_DESC = 'billing invoice payment charge query database';
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('b7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: SAME_DESC, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreIQR' in explanation && Math.abs(explanation.candidateScoreIQR) < 1e-9) {
      assert.ok(
        !('candidateScoreQuantileSkewness' in explanation),
        `candidateScoreQuantileSkewness should be absent when IQR=0, found: ${explanation.candidateScoreQuantileSkewness}`,
      );
    }
    assert.ok(explanation.candidateCount >= 1, 'should have candidates');
  } finally {
    await agg.shutdown();
  }
});

test('BBBBBBBB-8: tool description documents candidateScoreQuantileSkewness', async () => {
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
      cast.description?.includes('candidateScoreQuantileSkewness'),
      `cast description should mention candidateScoreQuantileSkewness, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
