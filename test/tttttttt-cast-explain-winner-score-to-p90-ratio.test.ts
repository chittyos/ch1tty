/**
 * TTTTTTTT: explanation.winnerScoreToP90Ratio in ch1tty/cast when explain:true.
 *
 * winnerScoreToP90Ratio: number — ratio of winner score to the 90th percentile:
 * winnerScore / candidateScoreP90.
 *
 * Present when: >= 2 candidates and candidateScoreP90 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP90 === 0.
 * Always >= 1 (winner is max; P90 <= max).
 * Always >= winnerScoreToP95Ratio (P90 <= P95 so w/P90 >= w/P95).
 * For n=2: winnerScore / (0.9*winnerScore + 0.1*runnerUpScore).
 * Identity: winnerScoreToP90Ratio * candidateScoreP90 === winnerScore.
 *
 * Covered:
 *   TTTTTTTT-1: present when >= 2 candidates and candidateScoreP90 > 0
 *   TTTTTTTT-2: always >= 1 and finite when present
 *   TTTTTTTT-3: always >= winnerScoreToP95Ratio when both present (P90 <= P95)
 *   TTTTTTTT-4: for n=2 equals winnerScore / (0.9*winner + 0.1*runnerUp)
 *   TTTTTTTT-5: absent on cast:no_match
 *   TTTTTTTT-6: absent when only 1 candidate
 *   TTTTTTTT-7: identity — winnerScoreToP90Ratio * candidateScoreP90 === winnerScore
 *   TTTTTTTT-8: tool description documents winnerScoreToP90Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-tttttttt-${label}-${Date.now()}.jsonl`);
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

test('TTTTTTTT-1: present when >= 2 candidates and candidateScoreP90 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP90' in explanation && explanation.candidateScoreP90 > 0) {
      assert.ok('winnerScoreToP90Ratio' in explanation,
        `winnerScoreToP90Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.winnerScoreToP90Ratio, 'number', 'winnerScoreToP90Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('TTTTTTTT-2: always >= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToP90Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.winnerScoreToP90Ratio),
        `winnerScoreToP90Ratio should be finite, got ${explanation.winnerScoreToP90Ratio}`,
      );
      assert.ok(
        explanation.winnerScoreToP90Ratio >= 1 - 1e-9,
        `winnerScoreToP90Ratio should be >= 1, got ${explanation.winnerScoreToP90Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('TTTTTTTT-3: always >= winnerScoreToP95Ratio when both present (P90 <= P95)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToP90Ratio' in explanation && 'winnerScoreToP95Ratio' in explanation) {
      assert.ok(
        explanation.winnerScoreToP90Ratio >= explanation.winnerScoreToP95Ratio - 1e-9,
        `winnerScoreToP90Ratio (${explanation.winnerScoreToP90Ratio}) should be >= winnerScoreToP95Ratio (${explanation.winnerScoreToP95Ratio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('TTTTTTTT-4: for n=2 equals winnerScore / (0.9*winner + 0.1*runnerUp)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToP90Ratio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0) {
      const p90 = 0.9 * explanation.winnerScore + 0.1 * explanation.runnerUpScore;
      if (p90 > 0) {
        const expected = explanation.winnerScore / p90;
        assert.ok(
          Math.abs(explanation.winnerScoreToP90Ratio - expected) < 1e-9,
          `winnerScoreToP90Ratio (${explanation.winnerScoreToP90Ratio}) should equal w/(0.9w+0.1r) (${expected}) for n=2`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('TTTTTTTT-5: absent on cast:no_match', async () => {
  const path = dlqPath('t5');
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
      !('winnerScoreToP90Ratio' in parsed.explanation),
      `winnerScoreToP90Ratio should be absent on no_match, found: ${parsed.explanation.winnerScoreToP90Ratio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('TTTTTTTT-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('winnerScoreToP90Ratio' in explanation),
      `winnerScoreToP90Ratio should be absent with single candidate, found: ${explanation.winnerScoreToP90Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('TTTTTTTT-7: identity — winnerScoreToP90Ratio * candidateScoreP90 === winnerScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToP90Ratio' in explanation && 'candidateScoreP90' in explanation) {
      const product = explanation.winnerScoreToP90Ratio * explanation.candidateScoreP90;
      assert.ok(
        Math.abs(product - explanation.winnerScore) < 1e-9,
        `winnerScoreToP90Ratio * candidateScoreP90 (${product}) should equal winnerScore (${explanation.winnerScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('TTTTTTTT-8: tool description documents winnerScoreToP90Ratio', async () => {
  const path = dlqPath('t8');
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
      cast.description?.includes('winnerScoreToP90Ratio'),
      `cast description should mention winnerScoreToP90Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
