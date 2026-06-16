/**
 * OOOOOOOO: explanation.candidateScoreP90MedianRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreP90MedianRatio: number — ratio of P90 to median (P50):
 * candidateScoreP90 / medianCandidateScore.
 *
 * Present when: >= 2 candidates and medianCandidateScore > 0.
 * Absent when: no_match, single candidate, or medianCandidateScore === 0.
 * Always >= 1 (P90 >= P50 by definition).
 * Always >= candidateScoreP75MedianRatio when both present (P90 >= P75).
 * Always <= winnerToMedianRatio when both present (P90 <= winnerScore).
 * Inverse of candidateScoreMedianToP90Ratio: product === 1 when both present.
 * For n=2: (0.9*w + 0.1*r) / (0.5*w + 0.5*r).
 * Identity: candidateScoreP90MedianRatio * medianCandidateScore === candidateScoreP90.
 *
 * Covered:
 *   OOOOOOOO-1: present when >= 2 candidates and medianCandidateScore > 0
 *   OOOOOOOO-2: always >= 1 and finite when present
 *   OOOOOOOO-3: always <= winnerToMedianRatio when both present (P90 <= winnerScore)
 *   OOOOOOOO-4: for n=2 equals (0.9*w + 0.1*r) / (0.5*w + 0.5*r)
 *   OOOOOOOO-5: absent on cast:no_match
 *   OOOOOOOO-6: absent when only 1 candidate
 *   OOOOOOOO-7: identity — candidateScoreP90MedianRatio * medianCandidateScore === candidateScoreP90
 *   OOOOOOOO-8: tool description documents candidateScoreP90MedianRatio
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

test('OOOOOOOO-1: present when >= 2 candidates and medianCandidateScore > 0', async () => {
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
    if ('medianCandidateScore' in explanation && explanation.medianCandidateScore > 0 && 'candidateScoreP90' in explanation) {
      assert.ok('candidateScoreP90MedianRatio' in explanation,
        `candidateScoreP90MedianRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreP90MedianRatio, 'number', 'candidateScoreP90MedianRatio should be a number');
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
    if ('candidateScoreP90MedianRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP90MedianRatio),
        `candidateScoreP90MedianRatio should be finite, got ${explanation.candidateScoreP90MedianRatio}`,
      );
      assert.ok(
        explanation.candidateScoreP90MedianRatio >= 1 - 1e-9,
        `candidateScoreP90MedianRatio should be >= 1, got ${explanation.candidateScoreP90MedianRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('OOOOOOOO-3: always <= winnerToMedianRatio when both present (P90 <= winnerScore)', async () => {
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
    if ('candidateScoreP90MedianRatio' in explanation && 'winnerToMedianRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreP90MedianRatio <= explanation.winnerToMedianRatio + 1e-9,
        `candidateScoreP90MedianRatio (${explanation.candidateScoreP90MedianRatio}) should be <= winnerToMedianRatio (${explanation.winnerToMedianRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('OOOOOOOO-4: for n=2 equals (0.9*w + 0.1*r) / (0.5*w + 0.5*r)', async () => {
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
    if ('candidateScoreP90MedianRatio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0) {
      const p90 = 0.9 * explanation.winnerScore + 0.1 * explanation.runnerUpScore;
      const median = 0.5 * explanation.winnerScore + 0.5 * explanation.runnerUpScore;
      if (median > 0) {
        const expected = p90 / median;
        assert.ok(
          Math.abs(explanation.candidateScoreP90MedianRatio - expected) < 1e-9,
          `candidateScoreP90MedianRatio (${explanation.candidateScoreP90MedianRatio}) should equal (0.9w+0.1r)/(0.5w+0.5r) (${expected}) for n=2`,
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
      !('candidateScoreP90MedianRatio' in parsed.explanation),
      `candidateScoreP90MedianRatio should be absent on no_match, found: ${parsed.explanation.candidateScoreP90MedianRatio}`,
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
      !('candidateScoreP90MedianRatio' in explanation),
      `candidateScoreP90MedianRatio should be absent with single candidate, found: ${explanation.candidateScoreP90MedianRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('OOOOOOOO-7: identity — candidateScoreP90MedianRatio * medianCandidateScore === candidateScoreP90', async () => {
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
    if ('candidateScoreP90MedianRatio' in explanation && 'medianCandidateScore' in explanation && 'candidateScoreP90' in explanation) {
      const product = explanation.candidateScoreP90MedianRatio * explanation.medianCandidateScore;
      assert.ok(
        Math.abs(product - explanation.candidateScoreP90) < 1e-9,
        `candidateScoreP90MedianRatio * medianCandidateScore (${product}) should equal candidateScoreP90 (${explanation.candidateScoreP90})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('OOOOOOOO-8: tool description documents candidateScoreP90MedianRatio', async () => {
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
      cast.description?.includes('candidateScoreP90MedianRatio'),
      `cast description should mention candidateScoreP90MedianRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
