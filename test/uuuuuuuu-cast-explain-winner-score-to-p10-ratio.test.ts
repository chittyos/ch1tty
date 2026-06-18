/**
 * UUUUUUUU: explanation.winnerScoreToP10Ratio in ch1tty/cast when explain:true.
 *
 * winnerScoreToP10Ratio: number — ratio of winner score to the 10th percentile:
 * winnerScore / candidateScoreP10.
 *
 * Present when: >= 2 candidates and candidateScoreP10 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP10 === 0.
 * Always >= 1 (winner is max; P10 <= max).
 * Always >= winnerScoreToP90Ratio (P10 <= P90 so w/P10 >= w/P90).
 * For n=2: winnerScore / (0.1*winnerScore + 0.9*runnerUpScore).
 * Identity: winnerScoreToP10Ratio * candidateScoreP10 === winnerScore.
 *
 * Covered:
 *   UUUUUUUU-1: present when >= 2 candidates and candidateScoreP10 > 0
 *   UUUUUUUU-2: always >= 1 and finite when present
 *   UUUUUUUU-3: always >= winnerScoreToP90Ratio when both present (P10 <= P90)
 *   UUUUUUUU-4: for n=2 equals winnerScore / (0.1*winner + 0.9*runnerUp)
 *   UUUUUUUU-5: absent on cast:no_match
 *   UUUUUUUU-6: absent when only 1 candidate
 *   UUUUUUUU-7: identity — winnerScoreToP10Ratio * candidateScoreP10 === winnerScore
 *   UUUUUUUU-8: tool description documents winnerScoreToP10Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-uuuuuuuu-${label}-${Date.now()}.jsonl`);
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

test('UUUUUUUU-1: present when >= 2 candidates and candidateScoreP10 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('u1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP10' in explanation && explanation.candidateScoreP10 > 0) {
      assert.ok('winnerScoreToP10Ratio' in explanation,
        `winnerScoreToP10Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.winnerScoreToP10Ratio, 'number', 'winnerScoreToP10Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('UUUUUUUU-2: always >= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('u2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToP10Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.winnerScoreToP10Ratio),
        `winnerScoreToP10Ratio should be finite, got ${explanation.winnerScoreToP10Ratio}`,
      );
      assert.ok(
        explanation.winnerScoreToP10Ratio >= 1 - 1e-9,
        `winnerScoreToP10Ratio should be >= 1, got ${explanation.winnerScoreToP10Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('UUUUUUUU-3: always >= winnerScoreToP90Ratio when both present (P10 <= P90)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('u3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToP10Ratio' in explanation && 'winnerScoreToP90Ratio' in explanation) {
      assert.ok(
        explanation.winnerScoreToP10Ratio >= explanation.winnerScoreToP90Ratio - 1e-9,
        `winnerScoreToP10Ratio (${explanation.winnerScoreToP10Ratio}) should be >= winnerScoreToP90Ratio (${explanation.winnerScoreToP90Ratio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('UUUUUUUU-4: for n=2 equals winnerScore / (0.1*winner + 0.9*runnerUp)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('u4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToP10Ratio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0) {
      const p10 = 0.1 * explanation.winnerScore + 0.9 * explanation.runnerUpScore;
      if (p10 > 0) {
        const expected = explanation.winnerScore / p10;
        assert.ok(
          Math.abs(explanation.winnerScoreToP10Ratio - expected) < 1e-9,
          `winnerScoreToP10Ratio (${explanation.winnerScoreToP10Ratio}) should equal w/(0.1w+0.9r) (${expected}) for n=2`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('UUUUUUUU-5: absent on cast:no_match', async () => {
  const path = dlqPath('u5');
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
      !('winnerScoreToP10Ratio' in parsed.explanation),
      `winnerScoreToP10Ratio should be absent on no_match, found: ${parsed.explanation.winnerScoreToP10Ratio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('UUUUUUUU-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('u6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('winnerScoreToP10Ratio' in explanation),
      `winnerScoreToP10Ratio should be absent with single candidate, found: ${explanation.winnerScoreToP10Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('UUUUUUUU-7: identity — winnerScoreToP10Ratio * candidateScoreP10 === winnerScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('u7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToP10Ratio' in explanation && 'candidateScoreP10' in explanation) {
      const product = explanation.winnerScoreToP10Ratio * explanation.candidateScoreP10;
      assert.ok(
        Math.abs(product - explanation.winnerScore) < 1e-9,
        `winnerScoreToP10Ratio * candidateScoreP10 (${product}) should equal winnerScore (${explanation.winnerScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('UUUUUUUU-8: tool description documents winnerScoreToP10Ratio', async () => {
  const path = dlqPath('u8');
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
      cast.description?.includes('winnerScoreToP10Ratio'),
      `cast description should mention winnerScoreToP10Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
