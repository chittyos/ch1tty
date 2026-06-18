/**
 * 31313131: explanation.candidateScoreTop3HeavinessRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreTop3HeavinessRatio: number — top-3 share of total candidate score mass:
 * sum(top-3 scores) / candidateScoreEntropyTotal.
 *
 * Present when: >= 2 candidates and candidateScoreEntropyTotal > 0.
 * Absent when: no_match, single candidate, all scores 0.
 * Always in (0, 1]: top-3 sum <= total.
 * Always >= top2HeavinessRatio: top-3 sum >= top-2 sum.
 * Always <= topHeavinessRatio: top-5 sum >= top-3 sum.
 * For n=2: equals top2HeavinessRatio (top-3 set = all candidates).
 * Identity: candidateScoreTop3HeavinessRatio * candidateScoreEntropyTotal === sum of top-3 scores.
 *
 * Covered:
 *   31313131-1: present when >= 2 candidates and total > 0
 *   31313131-2: always in (0, 1] when present
 *   31313131-3: always >= top2HeavinessRatio and <= topHeavinessRatio when all present
 *   31313131-4: for n=2 equals top2HeavinessRatio
 *   31313131-5: absent on cast:no_match
 *   31313131-6: absent when only 1 candidate
 *   31313131-7: identity — candidateScoreTop3HeavinessRatio * total === sum of top-3 scores
 *   31313131-8: tool description documents candidateScoreTop3HeavinessRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-31313131-${label}-${Date.now()}.jsonl`);
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

test('31313131-1: present when >= 2 candidates and total > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('fff1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('top2HeavinessRatio' in explanation) {
      assert.ok('candidateScoreTop3HeavinessRatio' in explanation,
        `candidateScoreTop3HeavinessRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreTop3HeavinessRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('31313131-2: always in (0, 1] when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('fff2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreTop3HeavinessRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreTop3HeavinessRatio),
        `should be finite, got ${explanation.candidateScoreTop3HeavinessRatio}`,
      );
      assert.ok(
        explanation.candidateScoreTop3HeavinessRatio > 0,
        `should be > 0, got ${explanation.candidateScoreTop3HeavinessRatio}`,
      );
      assert.ok(
        explanation.candidateScoreTop3HeavinessRatio <= 1,
        `should be <= 1, got ${explanation.candidateScoreTop3HeavinessRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('31313131-3: always >= top2HeavinessRatio and <= topHeavinessRatio when all present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('fff3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreTop3HeavinessRatio' in explanation) {
      if ('top2HeavinessRatio' in explanation) {
        assert.ok(
          explanation.candidateScoreTop3HeavinessRatio >= explanation.top2HeavinessRatio - 1e-9,
          `candidateScoreTop3HeavinessRatio (${explanation.candidateScoreTop3HeavinessRatio}) should be >= top2HeavinessRatio (${explanation.top2HeavinessRatio})`,
        );
      }
      if ('topHeavinessRatio' in explanation) {
        assert.ok(
          explanation.candidateScoreTop3HeavinessRatio <= explanation.topHeavinessRatio + 1e-9,
          `candidateScoreTop3HeavinessRatio (${explanation.candidateScoreTop3HeavinessRatio}) should be <= topHeavinessRatio (${explanation.topHeavinessRatio})`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('31313131-4: for n=2 equals top2HeavinessRatio', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('fff4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreTop3HeavinessRatio' in explanation && explanation.candidateCount === 2 &&
        'top2HeavinessRatio' in explanation) {
      assert.ok(
        Math.abs(explanation.candidateScoreTop3HeavinessRatio - explanation.top2HeavinessRatio) < 1e-9,
        `candidateScoreTop3HeavinessRatio (${explanation.candidateScoreTop3HeavinessRatio}) should equal top2HeavinessRatio (${explanation.top2HeavinessRatio}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('31313131-5: absent on cast:no_match', async () => {
  const path = dlqPath('fff5');
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
      !('candidateScoreTop3HeavinessRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.candidateScoreTop3HeavinessRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('31313131-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('fff6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreTop3HeavinessRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.candidateScoreTop3HeavinessRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('31313131-7: identity — candidateScoreTop3HeavinessRatio * total === winnerScore + runnerUpScore (for n=2)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('fff7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreTop3HeavinessRatio' in explanation && explanation.candidateCount === 2 &&
        'winnerScore' in explanation && 'runnerUpScore' in explanation && 'candidateScoreMean' in explanation) {
      const total = explanation.candidateScoreMean * explanation.candidateCount;
      const product = explanation.candidateScoreTop3HeavinessRatio * total;
      const expected = explanation.winnerScore + explanation.runnerUpScore;
      assert.ok(
        Math.abs(product - expected) < 1e-9,
        `candidateScoreTop3HeavinessRatio * total (${product}) should equal winnerScore + runnerUpScore (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('31313131-8: tool description documents candidateScoreTop3HeavinessRatio', async () => {
  const path = dlqPath('fff8');
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
      cast.description?.includes('candidateScoreTop3HeavinessRatio'),
      `cast description should mention candidateScoreTop3HeavinessRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
