/**
 * OOOOOOOO: explanation.winnerScoreToP05Ratio in ch1tty/cast when explain:true.
 *
 * winnerScoreToP05Ratio: number — ratio of winner score to the 5th percentile:
 * winnerScore / candidateScoreP05.
 *
 * Present when: >= 2 candidates and candidateScoreP05 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP05 === 0.
 * Always >= 1 (winner is max; P05 <= max).
 * Always >= winnerScoreToP95Ratio (P05 <= P95).
 * For n=2: winnerScore / (0.05*winnerScore + 0.95*runnerUpScore).
 * Identity: winnerScoreToP05Ratio * candidateScoreP05 === winnerScore.
 *
 * Covered:
 *   OOOOOOOO-1: present when >= 2 candidates and candidateScoreP05 > 0
 *   OOOOOOOO-2: always >= 1 and finite when present
 *   OOOOOOOO-3: always >= winnerScoreToP95Ratio when both present
 *   OOOOOOOO-4: for n=2 equals winnerScore / (0.05*winner + 0.95*runnerUp)
 *   OOOOOOOO-5: absent on cast:no_match
 *   OOOOOOOO-6: absent when only 1 candidate
 *   OOOOOOOO-7: identity — winnerScoreToP05Ratio * candidateScoreP05 === winnerScore
 *   OOOOOOOO-8: tool description documents winnerScoreToP05Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-oooooooo-${label}-${Date.now()}.jsonl`);
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

test('OOOOOOOO-1: present when >= 2 candidates and candidateScoreP05 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('o1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP05' in explanation && explanation.candidateScoreP05 > 0) {
      assert.ok('winnerScoreToP05Ratio' in explanation,
        `winnerScoreToP05Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.winnerScoreToP05Ratio, 'number', 'winnerScoreToP05Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('OOOOOOOO-2: always >= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('o2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToP05Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.winnerScoreToP05Ratio),
        `winnerScoreToP05Ratio should be finite, got ${explanation.winnerScoreToP05Ratio}`,
      );
      assert.ok(
        explanation.winnerScoreToP05Ratio >= 1 - 1e-9,
        `winnerScoreToP05Ratio should be >= 1, got ${explanation.winnerScoreToP05Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('OOOOOOOO-3: always >= winnerScoreToP95Ratio when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('o3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToP05Ratio' in explanation && 'winnerScoreToP95Ratio' in explanation) {
      assert.ok(
        explanation.winnerScoreToP05Ratio >= explanation.winnerScoreToP95Ratio - 1e-9,
        `winnerScoreToP05Ratio (${explanation.winnerScoreToP05Ratio}) should be >= winnerScoreToP95Ratio (${explanation.winnerScoreToP95Ratio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('OOOOOOOO-4: for n=2 equals winnerScore / (0.05*winner + 0.95*runnerUp)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('o4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToP05Ratio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0) {
      const p05 = 0.05 * explanation.winnerScore + 0.95 * explanation.runnerUpScore;
      if (p05 > 0) {
        const expected = explanation.winnerScore / p05;
        assert.ok(
          Math.abs(explanation.winnerScoreToP05Ratio - expected) < 1e-9,
          `winnerScoreToP05Ratio (${explanation.winnerScoreToP05Ratio}) should equal winnerScore/(0.05*w+0.95*r) (${expected}) for n=2`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('OOOOOOOO-5: absent on cast:no_match', async () => {
  const path = dlqPath('o5');
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
      !('winnerScoreToP05Ratio' in parsed.explanation),
      `winnerScoreToP05Ratio should be absent on no_match, found: ${parsed.explanation.winnerScoreToP05Ratio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('OOOOOOOO-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('o6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('winnerScoreToP05Ratio' in explanation),
      `winnerScoreToP05Ratio should be absent with single candidate, found: ${explanation.winnerScoreToP05Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('OOOOOOOO-7: identity — winnerScoreToP05Ratio * candidateScoreP05 === winnerScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('o7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToP05Ratio' in explanation && 'candidateScoreP05' in explanation) {
      const product = explanation.winnerScoreToP05Ratio * explanation.candidateScoreP05;
      assert.ok(
        Math.abs(product - explanation.winnerScore) < 1e-9,
        `winnerScoreToP05Ratio * candidateScoreP05 (${product}) should equal winnerScore (${explanation.winnerScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('OOOOOOOO-8: tool description documents winnerScoreToP05Ratio', async () => {
  const path = dlqPath('o8');
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
      cast.description?.includes('winnerScoreToP05Ratio'),
      `cast description should mention winnerScoreToP05Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
