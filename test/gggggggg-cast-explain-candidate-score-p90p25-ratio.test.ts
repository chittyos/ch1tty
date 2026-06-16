/**
 * GGGGGGGG: explanation.candidateScoreP90P25Ratio in ch1tty/cast when explain:true.
 *
 * candidateScoreP90P25Ratio: number — ratio of P90 to P25 (Q1):
 * candidateScoreP90 / candidateScoreP25.
 *
 * Present when: >= 2 candidates and candidateScoreP25 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP25 === 0.
 * Always >= 1 (P90 >= P25 by definition).
 * Always <= candidateScoreP90P10Ratio (P90/P10) when both present (P25 >= P10).
 * Always >= candidateScoreP75P25Ratio (P75/P25) when both present (P90 >= P75).
 * For n=2: (0.9*w + 0.1*r) / (0.25*w + 0.75*r).
 * Identity: candidateScoreP90P25Ratio * candidateScoreP25 === candidateScoreP90.
 *
 * Covered:
 *   GGGGGGGG-1: present when >= 2 candidates and candidateScoreP25 > 0
 *   GGGGGGGG-2: always >= 1 and finite when present
 *   GGGGGGGG-3: always <= candidateScoreP90P10Ratio when both present (P25 >= P10)
 *   GGGGGGGG-4: for n=2 equals (0.9*w + 0.1*r) / (0.25*w + 0.75*r)
 *   GGGGGGGG-5: absent on cast:no_match
 *   GGGGGGGG-6: absent when only 1 candidate
 *   GGGGGGGG-7: identity — candidateScoreP90P25Ratio * candidateScoreP25 === candidateScoreP90
 *   GGGGGGGG-8: tool description documents candidateScoreP90P25Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-gggggggg-${label}-${Date.now()}.jsonl`);
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

test('GGGGGGGG-1: present when >= 2 candidates and candidateScoreP25 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('g1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP25' in explanation && explanation.candidateScoreP25 > 0 && 'candidateScoreP90' in explanation) {
      assert.ok('candidateScoreP90P25Ratio' in explanation,
        `candidateScoreP90P25Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreP90P25Ratio, 'number', 'candidateScoreP90P25Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('GGGGGGGG-2: always >= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('g2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP90P25Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP90P25Ratio),
        `candidateScoreP90P25Ratio should be finite, got ${explanation.candidateScoreP90P25Ratio}`,
      );
      assert.ok(
        explanation.candidateScoreP90P25Ratio >= 1 - 1e-9,
        `candidateScoreP90P25Ratio should be >= 1, got ${explanation.candidateScoreP90P25Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('GGGGGGGG-3: always <= candidateScoreP90P10Ratio when both present (P25 >= P10)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('g3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP90P25Ratio' in explanation && 'candidateScoreP90P10Ratio' in explanation) {
      assert.ok(
        explanation.candidateScoreP90P25Ratio <= explanation.candidateScoreP90P10Ratio + 1e-9,
        `candidateScoreP90P25Ratio (${explanation.candidateScoreP90P25Ratio}) should be <= candidateScoreP90P10Ratio (${explanation.candidateScoreP90P10Ratio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('GGGGGGGG-4: for n=2 equals (0.9*w + 0.1*r) / (0.25*w + 0.75*r)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('g4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP90P25Ratio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0) {
      const p90 = 0.9 * explanation.winnerScore + 0.1 * explanation.runnerUpScore;
      const p25 = 0.25 * explanation.winnerScore + 0.75 * explanation.runnerUpScore;
      if (p25 > 0) {
        const expected = p90 / p25;
        assert.ok(
          Math.abs(explanation.candidateScoreP90P25Ratio - expected) < 1e-9,
          `candidateScoreP90P25Ratio (${explanation.candidateScoreP90P25Ratio}) should equal (0.9w+0.1r)/(0.25w+0.75r) (${expected}) for n=2`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('GGGGGGGG-5: absent on cast:no_match', async () => {
  const path = dlqPath('g5');
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
      !('candidateScoreP90P25Ratio' in parsed.explanation),
      `candidateScoreP90P25Ratio should be absent on no_match, found: ${parsed.explanation.candidateScoreP90P25Ratio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('GGGGGGGG-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('g6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP90P25Ratio' in explanation),
      `candidateScoreP90P25Ratio should be absent with single candidate, found: ${explanation.candidateScoreP90P25Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GGGGGGGG-7: identity — candidateScoreP90P25Ratio * candidateScoreP25 === candidateScoreP90', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('g7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP90P25Ratio' in explanation && 'candidateScoreP25' in explanation && 'candidateScoreP90' in explanation) {
      const product = explanation.candidateScoreP90P25Ratio * explanation.candidateScoreP25;
      assert.ok(
        Math.abs(product - explanation.candidateScoreP90) < 1e-9,
        `candidateScoreP90P25Ratio * candidateScoreP25 (${product}) should equal candidateScoreP90 (${explanation.candidateScoreP90})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('GGGGGGGG-8: tool description documents candidateScoreP90P25Ratio', async () => {
  const path = dlqPath('g8');
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
      cast.description?.includes('candidateScoreP90P25Ratio'),
      `cast description should mention candidateScoreP90P25Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
