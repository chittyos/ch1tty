/**
 * SSSSSSSS: explanation.candidateScoreP90P10Ratio in ch1tty/cast when explain:true.
 *
 * candidateScoreP90P10Ratio: number — ratio of P90 to P10:
 * candidateScoreP90 / candidateScoreP10. The multiplicative 80th-percentile range.
 *
 * Present when: >= 2 candidates and candidateScoreP10 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP10 === 0.
 * Always >= 1 (P90 >= P10 by definition).
 * Always >= candidateScoreP75P25Ratio (P90/P10 >= P75/P25).
 * For n=2: (0.9*w + 0.1*r) / (0.1*w + 0.9*r).
 * Identity: candidateScoreP90P10Ratio * candidateScoreP10 === candidateScoreP90.
 *
 * Covered:
 *   SSSSSSSS-1: present when >= 2 candidates and candidateScoreP10 > 0
 *   SSSSSSSS-2: always >= 1 and finite when present
 *   SSSSSSSS-3: always >= candidateScoreP75P25Ratio when both present (P90/P10 >= P75/P25)
 *   SSSSSSSS-4: for n=2 equals (0.9*winner + 0.1*runnerUp) / (0.1*winner + 0.9*runnerUp)
 *   SSSSSSSS-5: absent on cast:no_match
 *   SSSSSSSS-6: absent when only 1 candidate
 *   SSSSSSSS-7: identity — candidateScoreP90P10Ratio * candidateScoreP10 === candidateScoreP90
 *   SSSSSSSS-8: tool description documents candidateScoreP90P10Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-ssssssss-${label}-${Date.now()}.jsonl`);
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

test('SSSSSSSS-1: present when >= 2 candidates and candidateScoreP10 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('s1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP10' in explanation && explanation.candidateScoreP10 > 0) {
      assert.ok('candidateScoreP90P10Ratio' in explanation,
        `candidateScoreP90P10Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreP90P10Ratio, 'number', 'candidateScoreP90P10Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('SSSSSSSS-2: always >= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('s2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP90P10Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP90P10Ratio),
        `candidateScoreP90P10Ratio should be finite, got ${explanation.candidateScoreP90P10Ratio}`,
      );
      assert.ok(
        explanation.candidateScoreP90P10Ratio >= 1 - 1e-9,
        `candidateScoreP90P10Ratio should be >= 1, got ${explanation.candidateScoreP90P10Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('SSSSSSSS-3: always >= candidateScoreP75P25Ratio when both present (P90/P10 >= P75/P25)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('s3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP90P10Ratio' in explanation && 'candidateScoreP75P25Ratio' in explanation) {
      assert.ok(
        explanation.candidateScoreP90P10Ratio >= explanation.candidateScoreP75P25Ratio - 1e-9,
        `candidateScoreP90P10Ratio (${explanation.candidateScoreP90P10Ratio}) should be >= candidateScoreP75P25Ratio (${explanation.candidateScoreP75P25Ratio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('SSSSSSSS-4: for n=2 equals (0.9*winner + 0.1*runnerUp) / (0.1*winner + 0.9*runnerUp)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('s4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP90P10Ratio' in explanation && explanation.candidateCount === 2) {
      const p90 = 0.9 * explanation.winnerScore + 0.1 * explanation.runnerUpScore;
      const p10 = 0.1 * explanation.winnerScore + 0.9 * explanation.runnerUpScore;
      if (p10 > 0) {
        const expected = p90 / p10;
        assert.ok(
          Math.abs(explanation.candidateScoreP90P10Ratio - expected) < 1e-9,
          `candidateScoreP90P10Ratio (${explanation.candidateScoreP90P10Ratio}) should equal (0.9w+0.1r)/(0.1w+0.9r) (${expected}) for n=2`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('SSSSSSSS-5: absent on cast:no_match', async () => {
  const path = dlqPath('s5');
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
      !('candidateScoreP90P10Ratio' in parsed.explanation),
      `candidateScoreP90P10Ratio should be absent on no_match, found: ${parsed.explanation.candidateScoreP90P10Ratio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('SSSSSSSS-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('s6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP90P10Ratio' in explanation),
      `candidateScoreP90P10Ratio should be absent with single candidate, found: ${explanation.candidateScoreP90P10Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('SSSSSSSS-7: identity — candidateScoreP90P10Ratio * candidateScoreP10 === candidateScoreP90', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('s7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP90P10Ratio' in explanation && 'candidateScoreP10' in explanation && 'candidateScoreP90' in explanation) {
      const product = explanation.candidateScoreP90P10Ratio * explanation.candidateScoreP10;
      assert.ok(
        Math.abs(product - explanation.candidateScoreP90) < 1e-9,
        `candidateScoreP90P10Ratio * candidateScoreP10 (${product}) should equal candidateScoreP90 (${explanation.candidateScoreP90})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('SSSSSSSS-8: tool description documents candidateScoreP90P10Ratio', async () => {
  const path = dlqPath('s8');
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
      cast.description?.includes('candidateScoreP90P10Ratio'),
      `cast description should mention candidateScoreP90P10Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
