/**
 * QQQQQQQQ: explanation.candidateScoreP75P25Ratio in ch1tty/cast when explain:true.
 *
 * candidateScoreP75P25Ratio: number — ratio of Q3 to Q1:
 * candidateScoreP75 / candidateScoreP25. The multiplicative IQR.
 *
 * Present when: >= 2 candidates and candidateScoreP25 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP25 === 0.
 * Always >= 1 (Q3 >= Q1 by definition).
 * Always <= candidateScoreTailAsymmetryRatio (quartile ratio <= tail ratio).
 * For n=2: (0.75*w + 0.25*r) / (0.25*w + 0.75*r).
 * Identity: candidateScoreP75P25Ratio * candidateScoreP25 === candidateScoreP75.
 *
 * Covered:
 *   QQQQQQQQ-1: present when >= 2 candidates and candidateScoreP25 > 0
 *   QQQQQQQQ-2: always >= 1 and finite when present
 *   QQQQQQQQ-3: always <= candidateScoreTailAsymmetryRatio when both present
 *   QQQQQQQQ-4: for n=2 equals (0.75*winner + 0.25*runnerUp) / (0.25*winner + 0.75*runnerUp)
 *   QQQQQQQQ-5: absent on cast:no_match
 *   QQQQQQQQ-6: absent when only 1 candidate
 *   QQQQQQQQ-7: identity — candidateScoreP75P25Ratio * candidateScoreP25 === candidateScoreP75
 *   QQQQQQQQ-8: tool description documents candidateScoreP75P25Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-qqqqqqqq-${label}-${Date.now()}.jsonl`);
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

test('QQQQQQQQ-1: present when >= 2 candidates and candidateScoreP25 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP25' in explanation && explanation.candidateScoreP25 > 0) {
      assert.ok('candidateScoreP75P25Ratio' in explanation,
        `candidateScoreP75P25Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreP75P25Ratio, 'number', 'candidateScoreP75P25Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQQQQ-2: always >= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP75P25Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP75P25Ratio),
        `candidateScoreP75P25Ratio should be finite, got ${explanation.candidateScoreP75P25Ratio}`,
      );
      assert.ok(
        explanation.candidateScoreP75P25Ratio >= 1 - 1e-9,
        `candidateScoreP75P25Ratio should be >= 1, got ${explanation.candidateScoreP75P25Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQQQQ-3: always <= candidateScoreTailAsymmetryRatio when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP75P25Ratio' in explanation && 'candidateScoreTailAsymmetryRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreP75P25Ratio <= explanation.candidateScoreTailAsymmetryRatio + 1e-9,
        `candidateScoreP75P25Ratio (${explanation.candidateScoreP75P25Ratio}) should be <= candidateScoreTailAsymmetryRatio (${explanation.candidateScoreTailAsymmetryRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQQQQ-4: for n=2 equals (0.75*winner + 0.25*runnerUp) / (0.25*winner + 0.75*runnerUp)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP75P25Ratio' in explanation && explanation.candidateCount === 2) {
      const q3 = 0.75 * explanation.winnerScore + 0.25 * explanation.runnerUpScore;
      const q1 = 0.25 * explanation.winnerScore + 0.75 * explanation.runnerUpScore;
      if (q1 > 0) {
        const expected = q3 / q1;
        assert.ok(
          Math.abs(explanation.candidateScoreP75P25Ratio - expected) < 1e-9,
          `candidateScoreP75P25Ratio (${explanation.candidateScoreP75P25Ratio}) should equal Q3/Q1 (${expected}) for n=2`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQQQQ-5: absent on cast:no_match', async () => {
  const path = dlqPath('q5');
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
      !('candidateScoreP75P25Ratio' in parsed.explanation),
      `candidateScoreP75P25Ratio should be absent on no_match, found: ${parsed.explanation.candidateScoreP75P25Ratio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('QQQQQQQQ-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP75P25Ratio' in explanation),
      `candidateScoreP75P25Ratio should be absent with single candidate, found: ${explanation.candidateScoreP75P25Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQQQQ-7: identity — candidateScoreP75P25Ratio * candidateScoreP25 === candidateScoreP75', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP75P25Ratio' in explanation && 'candidateScoreP25' in explanation && 'candidateScoreP75' in explanation) {
      const product = explanation.candidateScoreP75P25Ratio * explanation.candidateScoreP25;
      assert.ok(
        Math.abs(product - explanation.candidateScoreP75) < 1e-9,
        `candidateScoreP75P25Ratio * candidateScoreP25 (${product}) should equal candidateScoreP75 (${explanation.candidateScoreP75})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQQQQ-8: tool description documents candidateScoreP75P25Ratio', async () => {
  const path = dlqPath('q8');
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
      cast.description?.includes('candidateScoreP75P25Ratio'),
      `cast description should mention candidateScoreP75P25Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
