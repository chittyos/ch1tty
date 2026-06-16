/**
 * PPPPPPPP: explanation.candidateScoreTailAsymmetryRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreTailAsymmetryRatio: number — ratio of the 95th percentile to
 * the 5th percentile: candidateScoreP95 / candidateScoreP05.
 *
 * Present when: >= 2 candidates and candidateScoreP05 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP05 === 0.
 * Always >= 1 (P95 >= P05 by definition).
 * Equals winnerScoreToP05Ratio / winnerScoreToP95Ratio when both present.
 * For n=2: (0.95*w + 0.05*r) / (0.05*w + 0.95*r).
 * Identity: candidateScoreTailAsymmetryRatio === candidateScoreP95 / candidateScoreP05.
 *
 * Covered:
 *   PPPPPPPP-1: present when >= 2 candidates and candidateScoreP05 > 0
 *   PPPPPPPP-2: always >= 1 and finite when present
 *   PPPPPPPP-3: identity — equals candidateScoreP95 / candidateScoreP05
 *   PPPPPPPP-4: equals winnerScoreToP05Ratio / winnerScoreToP95Ratio when both present
 *   PPPPPPPP-5: absent on cast:no_match
 *   PPPPPPPP-6: absent when only 1 candidate
 *   PPPPPPPP-7: for n=2 equals (0.95*winner + 0.05*runnerUp) / (0.05*winner + 0.95*runnerUp)
 *   PPPPPPPP-8: tool description documents candidateScoreTailAsymmetryRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-pppppppp-${label}-${Date.now()}.jsonl`);
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

test('PPPPPPPP-1: present when >= 2 candidates and candidateScoreP05 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('p1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP05' in explanation && explanation.candidateScoreP05 > 0) {
      assert.ok('candidateScoreTailAsymmetryRatio' in explanation,
        `candidateScoreTailAsymmetryRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreTailAsymmetryRatio, 'number', 'candidateScoreTailAsymmetryRatio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('PPPPPPPP-2: always >= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('p2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreTailAsymmetryRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreTailAsymmetryRatio),
        `candidateScoreTailAsymmetryRatio should be finite, got ${explanation.candidateScoreTailAsymmetryRatio}`,
      );
      assert.ok(
        explanation.candidateScoreTailAsymmetryRatio >= 1 - 1e-9,
        `candidateScoreTailAsymmetryRatio should be >= 1, got ${explanation.candidateScoreTailAsymmetryRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('PPPPPPPP-3: identity — equals candidateScoreP95 / candidateScoreP05', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('p3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreTailAsymmetryRatio' in explanation && 'candidateScoreP95' in explanation && 'candidateScoreP05' in explanation && explanation.candidateScoreP05 > 0) {
      const expected = explanation.candidateScoreP95 / explanation.candidateScoreP05;
      assert.ok(
        Math.abs(explanation.candidateScoreTailAsymmetryRatio - expected) < 1e-9,
        `candidateScoreTailAsymmetryRatio (${explanation.candidateScoreTailAsymmetryRatio}) should equal P95/P05 (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('PPPPPPPP-4: equals winnerScoreToP05Ratio / winnerScoreToP95Ratio when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('p4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreTailAsymmetryRatio' in explanation && 'winnerScoreToP05Ratio' in explanation && 'winnerScoreToP95Ratio' in explanation && explanation.winnerScoreToP95Ratio > 0) {
      const expected = explanation.winnerScoreToP05Ratio / explanation.winnerScoreToP95Ratio;
      assert.ok(
        Math.abs(explanation.candidateScoreTailAsymmetryRatio - expected) < 1e-9,
        `candidateScoreTailAsymmetryRatio (${explanation.candidateScoreTailAsymmetryRatio}) should equal P05Ratio/P95Ratio (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('PPPPPPPP-5: absent on cast:no_match', async () => {
  const path = dlqPath('p5');
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
      !('candidateScoreTailAsymmetryRatio' in parsed.explanation),
      `candidateScoreTailAsymmetryRatio should be absent on no_match, found: ${parsed.explanation.candidateScoreTailAsymmetryRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('PPPPPPPP-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('p6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreTailAsymmetryRatio' in explanation),
      `candidateScoreTailAsymmetryRatio should be absent with single candidate, found: ${explanation.candidateScoreTailAsymmetryRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('PPPPPPPP-7: for n=2 equals (0.95*winner + 0.05*runnerUp) / (0.05*winner + 0.95*runnerUp)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('p7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreTailAsymmetryRatio' in explanation && explanation.candidateCount === 2) {
      const p95 = 0.95 * explanation.winnerScore + 0.05 * explanation.runnerUpScore;
      const p05 = 0.05 * explanation.winnerScore + 0.95 * explanation.runnerUpScore;
      if (p05 > 0) {
        const expected = p95 / p05;
        assert.ok(
          Math.abs(explanation.candidateScoreTailAsymmetryRatio - expected) < 1e-9,
          `candidateScoreTailAsymmetryRatio (${explanation.candidateScoreTailAsymmetryRatio}) should equal P95/P05 (${expected}) for n=2`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('PPPPPPPP-8: tool description documents candidateScoreTailAsymmetryRatio', async () => {
  const path = dlqPath('p8');
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
      cast.description?.includes('candidateScoreTailAsymmetryRatio'),
      `cast description should mention candidateScoreTailAsymmetryRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
