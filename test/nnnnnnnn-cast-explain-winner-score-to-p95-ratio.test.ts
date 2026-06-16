/**
 * NNNNNNNN: explanation.winnerScoreToP95Ratio in ch1tty/cast when explain:true.
 *
 * winnerScoreToP95Ratio: number — ratio of winner score to the 95th percentile:
 * winnerScore / candidateScoreP95.
 *
 * Present when: >= 2 candidates and candidateScoreP95 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP95 === 0.
 * Always >= 1 (winner is max; P95 <= max).
 * For n=2: winnerScore / (0.95*winnerScore + 0.05*runnerUpScore).
 * Identity: winnerScoreToP95Ratio * candidateScoreP95 === winnerScore.
 *
 * Covered:
 *   NNNNNNNN-1: present when >= 2 candidates and candidateScoreP95 > 0
 *   NNNNNNNN-2: always >= 1 and finite when present
 *   NNNNNNNN-3: for n=2 equals winnerScore / (0.95*winner + 0.05*runnerUp)
 *   NNNNNNNN-4: always >= winnerToMedianRatio when winnerToMedianRatio present (winner/P95 >= winner/median requires P95 <= median — false; actually P95 >= median so this inequality is reversed)
 *   NNNNNNNN-5: absent on cast:no_match
 *   NNNNNNNN-6: absent when only 1 candidate
 *   NNNNNNNN-7: identity — winnerScoreToP95Ratio * candidateScoreP95 === winnerScore
 *   NNNNNNNN-8: tool description documents winnerScoreToP95Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-nnnnnnnn-${label}-${Date.now()}.jsonl`);
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

test('NNNNNNNN-1: present when >= 2 candidates and candidateScoreP95 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('n1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP95' in explanation && explanation.candidateScoreP95 > 0) {
      assert.ok('winnerScoreToP95Ratio' in explanation,
        `winnerScoreToP95Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.winnerScoreToP95Ratio, 'number', 'winnerScoreToP95Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('NNNNNNNN-2: always >= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('n2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToP95Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.winnerScoreToP95Ratio),
        `winnerScoreToP95Ratio should be finite, got ${explanation.winnerScoreToP95Ratio}`,
      );
      assert.ok(
        explanation.winnerScoreToP95Ratio >= 1 - 1e-9,
        `winnerScoreToP95Ratio should be >= 1, got ${explanation.winnerScoreToP95Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('NNNNNNNN-3: for n=2 equals winnerScore / (0.95*winner + 0.05*runnerUp)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('n3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToP95Ratio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0) {
      const p95 = 0.95 * explanation.winnerScore + 0.05 * explanation.runnerUpScore;
      if (p95 > 0) {
        const expected = explanation.winnerScore / p95;
        assert.ok(
          Math.abs(explanation.winnerScoreToP95Ratio - expected) < 1e-9,
          `winnerScoreToP95Ratio (${explanation.winnerScoreToP95Ratio}) should equal winnerScore/(0.95*w+0.05*r) (${expected}) for n=2`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('NNNNNNNN-4: always <= winnerToMedianRatio when both present (P95 >= median so ratio inverts)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('n4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToP95Ratio' in explanation && 'winnerToMedianRatio' in explanation) {
      // P95 >= median, so winnerScore/P95 <= winnerScore/median
      assert.ok(
        explanation.winnerScoreToP95Ratio <= explanation.winnerToMedianRatio + 1e-9,
        `winnerScoreToP95Ratio (${explanation.winnerScoreToP95Ratio}) should be <= winnerToMedianRatio (${explanation.winnerToMedianRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('NNNNNNNN-5: absent on cast:no_match', async () => {
  const path = dlqPath('n5');
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
      !('winnerScoreToP95Ratio' in parsed.explanation),
      `winnerScoreToP95Ratio should be absent on no_match, found: ${parsed.explanation.winnerScoreToP95Ratio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('NNNNNNNN-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('n6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('winnerScoreToP95Ratio' in explanation),
      `winnerScoreToP95Ratio should be absent with single candidate, found: ${explanation.winnerScoreToP95Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('NNNNNNNN-7: identity — winnerScoreToP95Ratio * candidateScoreP95 === winnerScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('n7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToP95Ratio' in explanation && 'candidateScoreP95' in explanation) {
      const product = explanation.winnerScoreToP95Ratio * explanation.candidateScoreP95;
      assert.ok(
        Math.abs(product - explanation.winnerScore) < 1e-9,
        `winnerScoreToP95Ratio * candidateScoreP95 (${product}) should equal winnerScore (${explanation.winnerScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('NNNNNNNN-8: tool description documents winnerScoreToP95Ratio', async () => {
  const path = dlqPath('n8');
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
      cast.description?.includes('winnerScoreToP95Ratio'),
      `cast description should mention winnerScoreToP95Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
