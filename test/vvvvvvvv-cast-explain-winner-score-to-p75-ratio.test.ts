/**
 * VVVVVVVV: explanation.winnerScoreToP75Ratio in ch1tty/cast when explain:true.
 *
 * winnerScoreToP75Ratio: number — ratio of winner score to the 75th percentile (Q3):
 * winnerScore / candidateScoreP75.
 *
 * Present when: >= 2 candidates and candidateScoreP75 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP75 === 0.
 * Always >= 1 (winner is max; P75 <= max).
 * Always >= winnerScoreToP90Ratio (P75 <= P90 so w/P75 >= w/P90).
 * For n=2: winnerScore / (0.75*winnerScore + 0.25*runnerUpScore).
 * Identity: winnerScoreToP75Ratio * candidateScoreP75 === winnerScore.
 *
 * Covered:
 *   VVVVVVVV-1: present when >= 2 candidates and candidateScoreP75 > 0
 *   VVVVVVVV-2: always >= 1 and finite when present
 *   VVVVVVVV-3: always >= winnerScoreToP90Ratio when both present (P75 <= P90)
 *   VVVVVVVV-4: for n=2 equals winnerScore / (0.75*winner + 0.25*runnerUp)
 *   VVVVVVVV-5: absent on cast:no_match
 *   VVVVVVVV-6: absent when only 1 candidate
 *   VVVVVVVV-7: identity — winnerScoreToP75Ratio * candidateScoreP75 === winnerScore
 *   VVVVVVVV-8: tool description documents winnerScoreToP75Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-vvvvvvvv-${label}-${Date.now()}.jsonl`);
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

test('VVVVVVVV-1: present when >= 2 candidates and candidateScoreP75 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('v1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP75' in explanation && explanation.candidateScoreP75 > 0) {
      assert.ok('winnerScoreToP75Ratio' in explanation,
        `winnerScoreToP75Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.winnerScoreToP75Ratio, 'number', 'winnerScoreToP75Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('VVVVVVVV-2: always >= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('v2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToP75Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.winnerScoreToP75Ratio),
        `winnerScoreToP75Ratio should be finite, got ${explanation.winnerScoreToP75Ratio}`,
      );
      assert.ok(
        explanation.winnerScoreToP75Ratio >= 1 - 1e-9,
        `winnerScoreToP75Ratio should be >= 1, got ${explanation.winnerScoreToP75Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('VVVVVVVV-3: always >= winnerScoreToP90Ratio when both present (P75 <= P90)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('v3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToP75Ratio' in explanation && 'winnerScoreToP90Ratio' in explanation) {
      assert.ok(
        explanation.winnerScoreToP75Ratio >= explanation.winnerScoreToP90Ratio - 1e-9,
        `winnerScoreToP75Ratio (${explanation.winnerScoreToP75Ratio}) should be >= winnerScoreToP90Ratio (${explanation.winnerScoreToP90Ratio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('VVVVVVVV-4: for n=2 equals winnerScore / (0.75*winner + 0.25*runnerUp)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('v4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToP75Ratio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0) {
      const p75 = 0.75 * explanation.winnerScore + 0.25 * explanation.runnerUpScore;
      if (p75 > 0) {
        const expected = explanation.winnerScore / p75;
        assert.ok(
          Math.abs(explanation.winnerScoreToP75Ratio - expected) < 1e-9,
          `winnerScoreToP75Ratio (${explanation.winnerScoreToP75Ratio}) should equal w/(0.75w+0.25r) (${expected}) for n=2`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('VVVVVVVV-5: absent on cast:no_match', async () => {
  const path = dlqPath('v5');
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
      !('winnerScoreToP75Ratio' in parsed.explanation),
      `winnerScoreToP75Ratio should be absent on no_match, found: ${parsed.explanation.winnerScoreToP75Ratio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('VVVVVVVV-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('v6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('winnerScoreToP75Ratio' in explanation),
      `winnerScoreToP75Ratio should be absent with single candidate, found: ${explanation.winnerScoreToP75Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('VVVVVVVV-7: identity — winnerScoreToP75Ratio * candidateScoreP75 === winnerScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('v7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToP75Ratio' in explanation && 'candidateScoreP75' in explanation) {
      const product = explanation.winnerScoreToP75Ratio * explanation.candidateScoreP75;
      assert.ok(
        Math.abs(product - explanation.winnerScore) < 1e-9,
        `winnerScoreToP75Ratio * candidateScoreP75 (${product}) should equal winnerScore (${explanation.winnerScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('VVVVVVVV-8: tool description documents winnerScoreToP75Ratio', async () => {
  const path = dlqPath('v8');
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
      cast.description?.includes('winnerScoreToP75Ratio'),
      `cast description should mention winnerScoreToP75Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
