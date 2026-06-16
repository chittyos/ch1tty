/**
 * WWWWWWWW: explanation.winnerScoreToP25Ratio in ch1tty/cast when explain:true.
 *
 * winnerScoreToP25Ratio: number — ratio of winner score to the 25th percentile (Q1):
 * winnerScore / candidateScoreP25.
 *
 * Present when: >= 2 candidates and candidateScoreP25 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP25 === 0.
 * Always >= 1 (winner is max; P25 <= max).
 * Always >= winnerScoreToP75Ratio (P25 <= P75 so w/P25 >= w/P75).
 * For n=2: winnerScore / (0.25*winnerScore + 0.75*runnerUpScore).
 * Identity: winnerScoreToP25Ratio * candidateScoreP25 === winnerScore.
 *
 * Covered:
 *   WWWWWWWW-1: present when >= 2 candidates and candidateScoreP25 > 0
 *   WWWWWWWW-2: always >= 1 and finite when present
 *   WWWWWWWW-3: always >= winnerScoreToP75Ratio when both present (P25 <= P75)
 *   WWWWWWWW-4: for n=2 equals winnerScore / (0.25*winner + 0.75*runnerUp)
 *   WWWWWWWW-5: absent on cast:no_match
 *   WWWWWWWW-6: absent when only 1 candidate
 *   WWWWWWWW-7: identity — winnerScoreToP25Ratio * candidateScoreP25 === winnerScore
 *   WWWWWWWW-8: tool description documents winnerScoreToP25Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-wwwwwwww-${label}-${Date.now()}.jsonl`);
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

test('WWWWWWWW-1: present when >= 2 candidates and candidateScoreP25 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP25' in explanation && explanation.candidateScoreP25 > 0) {
      assert.ok('winnerScoreToP25Ratio' in explanation,
        `winnerScoreToP25Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.winnerScoreToP25Ratio, 'number', 'winnerScoreToP25Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('WWWWWWWW-2: always >= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToP25Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.winnerScoreToP25Ratio),
        `winnerScoreToP25Ratio should be finite, got ${explanation.winnerScoreToP25Ratio}`,
      );
      assert.ok(
        explanation.winnerScoreToP25Ratio >= 1 - 1e-9,
        `winnerScoreToP25Ratio should be >= 1, got ${explanation.winnerScoreToP25Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('WWWWWWWW-3: always >= winnerScoreToP75Ratio when both present (P25 <= P75)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToP25Ratio' in explanation && 'winnerScoreToP75Ratio' in explanation) {
      assert.ok(
        explanation.winnerScoreToP25Ratio >= explanation.winnerScoreToP75Ratio - 1e-9,
        `winnerScoreToP25Ratio (${explanation.winnerScoreToP25Ratio}) should be >= winnerScoreToP75Ratio (${explanation.winnerScoreToP75Ratio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('WWWWWWWW-4: for n=2 equals winnerScore / (0.25*winner + 0.75*runnerUp)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToP25Ratio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0) {
      const p25 = 0.25 * explanation.winnerScore + 0.75 * explanation.runnerUpScore;
      if (p25 > 0) {
        const expected = explanation.winnerScore / p25;
        assert.ok(
          Math.abs(explanation.winnerScoreToP25Ratio - expected) < 1e-9,
          `winnerScoreToP25Ratio (${explanation.winnerScoreToP25Ratio}) should equal w/(0.25w+0.75r) (${expected}) for n=2`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('WWWWWWWW-5: absent on cast:no_match', async () => {
  const path = dlqPath('w5');
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
      !('winnerScoreToP25Ratio' in parsed.explanation),
      `winnerScoreToP25Ratio should be absent on no_match, found: ${parsed.explanation.winnerScoreToP25Ratio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('WWWWWWWW-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('winnerScoreToP25Ratio' in explanation),
      `winnerScoreToP25Ratio should be absent with single candidate, found: ${explanation.winnerScoreToP25Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('WWWWWWWW-7: identity — winnerScoreToP25Ratio * candidateScoreP25 === winnerScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToP25Ratio' in explanation && 'candidateScoreP25' in explanation) {
      const product = explanation.winnerScoreToP25Ratio * explanation.candidateScoreP25;
      assert.ok(
        Math.abs(product - explanation.winnerScore) < 1e-9,
        `winnerScoreToP25Ratio * candidateScoreP25 (${product}) should equal winnerScore (${explanation.winnerScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('WWWWWWWW-8: tool description documents winnerScoreToP25Ratio', async () => {
  const path = dlqPath('w8');
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
      cast.description?.includes('winnerScoreToP25Ratio'),
      `cast description should mention winnerScoreToP25Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
