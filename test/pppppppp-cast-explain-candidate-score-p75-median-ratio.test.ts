/**
 * PPPPPPPP: explanation.candidateScoreP75MedianRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreP75MedianRatio: number — ratio of P75 (Q3) to median (P50):
 * candidateScoreP75 / medianCandidateScore.
 *
 * Present when: >= 2 candidates and medianCandidateScore > 0.
 * Absent when: no_match, single candidate, or medianCandidateScore === 0.
 * Always >= 1 (P75 >= P50 by definition).
 * Always <= candidateScoreP90MedianRatio when both present (P75 <= P90).
 * Always <= winnerToMedianRatio when both present (P75 <= winnerScore).
 * Inverse of candidateScoreMedianToP75Ratio: product === 1 when both present.
 * For n=2: (0.75*w + 0.25*r) / (0.5*w + 0.5*r).
 * Identity: candidateScoreP75MedianRatio * medianCandidateScore === candidateScoreP75.
 *
 * Covered:
 *   PPPPPPPP-1: present when >= 2 candidates and medianCandidateScore > 0
 *   PPPPPPPP-2: always >= 1 and finite when present
 *   PPPPPPPP-3: always <= candidateScoreP90MedianRatio when both present (P75 <= P90)
 *   PPPPPPPP-4: for n=2 equals (0.75*w + 0.25*r) / (0.5*w + 0.5*r)
 *   PPPPPPPP-5: absent on cast:no_match
 *   PPPPPPPP-6: absent when only 1 candidate
 *   PPPPPPPP-7: identity — candidateScoreP75MedianRatio * medianCandidateScore === candidateScoreP75
 *   PPPPPPPP-8: tool description documents candidateScoreP75MedianRatio
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

test('PPPPPPPP-1: present when >= 2 candidates and medianCandidateScore > 0', async () => {
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
    if ('medianCandidateScore' in explanation && explanation.medianCandidateScore > 0 && 'candidateScoreP75' in explanation) {
      assert.ok('candidateScoreP75MedianRatio' in explanation,
        `candidateScoreP75MedianRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreP75MedianRatio, 'number', 'candidateScoreP75MedianRatio should be a number');
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
    if ('candidateScoreP75MedianRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP75MedianRatio),
        `candidateScoreP75MedianRatio should be finite, got ${explanation.candidateScoreP75MedianRatio}`,
      );
      assert.ok(
        explanation.candidateScoreP75MedianRatio >= 1 - 1e-9,
        `candidateScoreP75MedianRatio should be >= 1, got ${explanation.candidateScoreP75MedianRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('PPPPPPPP-3: always <= candidateScoreP90MedianRatio when both present (P75 <= P90)', async () => {
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
    if ('candidateScoreP75MedianRatio' in explanation && 'candidateScoreP90MedianRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreP75MedianRatio <= explanation.candidateScoreP90MedianRatio + 1e-9,
        `candidateScoreP75MedianRatio (${explanation.candidateScoreP75MedianRatio}) should be <= candidateScoreP90MedianRatio (${explanation.candidateScoreP90MedianRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('PPPPPPPP-4: for n=2 equals (0.75*w + 0.25*r) / (0.5*w + 0.5*r)', async () => {
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
    if ('candidateScoreP75MedianRatio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0) {
      const p75 = 0.75 * explanation.winnerScore + 0.25 * explanation.runnerUpScore;
      const median = 0.5 * explanation.winnerScore + 0.5 * explanation.runnerUpScore;
      if (median > 0) {
        const expected = p75 / median;
        assert.ok(
          Math.abs(explanation.candidateScoreP75MedianRatio - expected) < 1e-9,
          `candidateScoreP75MedianRatio (${explanation.candidateScoreP75MedianRatio}) should equal (0.75w+0.25r)/(0.5w+0.5r) (${expected}) for n=2`,
        );
      }
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
      !('candidateScoreP75MedianRatio' in parsed.explanation),
      `candidateScoreP75MedianRatio should be absent on no_match, found: ${parsed.explanation.candidateScoreP75MedianRatio}`,
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
      !('candidateScoreP75MedianRatio' in explanation),
      `candidateScoreP75MedianRatio should be absent with single candidate, found: ${explanation.candidateScoreP75MedianRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('PPPPPPPP-7: identity — candidateScoreP75MedianRatio * medianCandidateScore === candidateScoreP75', async () => {
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
    if ('candidateScoreP75MedianRatio' in explanation && 'medianCandidateScore' in explanation && 'candidateScoreP75' in explanation) {
      const product = explanation.candidateScoreP75MedianRatio * explanation.medianCandidateScore;
      assert.ok(
        Math.abs(product - explanation.candidateScoreP75) < 1e-9,
        `candidateScoreP75MedianRatio * medianCandidateScore (${product}) should equal candidateScoreP75 (${explanation.candidateScoreP75})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('PPPPPPPP-8: tool description documents candidateScoreP75MedianRatio', async () => {
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
      cast.description?.includes('candidateScoreP75MedianRatio'),
      `cast description should mention candidateScoreP75MedianRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
