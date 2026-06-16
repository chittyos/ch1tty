/**
 * QQQQQQQQ: explanation.candidateScoreP95MedianRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreP95MedianRatio: number — ratio of P95 to median (P50):
 * candidateScoreP95 / medianCandidateScore.
 *
 * Present when: >= 2 candidates and medianCandidateScore > 0.
 * Absent when: no_match, single candidate, or medianCandidateScore === 0.
 * Always >= 1 (P95 >= P50 by definition).
 * Always >= candidateScoreP90MedianRatio when both present (P95 >= P90).
 * Always <= winnerToMedianRatio when both present (P95 <= winnerScore).
 * Inverse of candidateScoreMedianToP95Ratio: product === 1 when both present.
 * For n=2: (0.95*w + 0.05*r) / (0.5*w + 0.5*r).
 * Identity: candidateScoreP95MedianRatio * medianCandidateScore === candidateScoreP95.
 *
 * Covered:
 *   QQQQQQQQ-1: present when >= 2 candidates and medianCandidateScore > 0
 *   QQQQQQQQ-2: always >= 1 and finite when present
 *   QQQQQQQQ-3: always >= candidateScoreP90MedianRatio when both present (P95 >= P90)
 *   QQQQQQQQ-4: for n=2 equals (0.95*w + 0.05*r) / (0.5*w + 0.5*r)
 *   QQQQQQQQ-5: absent on cast:no_match
 *   QQQQQQQQ-6: absent when only 1 candidate
 *   QQQQQQQQ-7: identity — candidateScoreP95MedianRatio * medianCandidateScore === candidateScoreP95
 *   QQQQQQQQ-8: tool description documents candidateScoreP95MedianRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-qqqqqqqq-${label}-${Date.now()}.jsonl`);
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

test('QQQQQQQQ-1: present when >= 2 candidates and medianCandidateScore > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('medianCandidateScore' in explanation && explanation.medianCandidateScore > 0 && 'candidateScoreP95' in explanation) {
      assert.ok('candidateScoreP95MedianRatio' in explanation,
        `candidateScoreP95MedianRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreP95MedianRatio, 'number', 'candidateScoreP95MedianRatio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQQQQ-2: always >= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP95MedianRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP95MedianRatio),
        `candidateScoreP95MedianRatio should be finite, got ${explanation.candidateScoreP95MedianRatio}`,
      );
      assert.ok(
        explanation.candidateScoreP95MedianRatio >= 1 - 1e-9,
        `candidateScoreP95MedianRatio should be >= 1, got ${explanation.candidateScoreP95MedianRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQQQQ-3: always >= candidateScoreP90MedianRatio when both present (P95 >= P90)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP95MedianRatio' in explanation && 'candidateScoreP90MedianRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreP95MedianRatio >= explanation.candidateScoreP90MedianRatio - 1e-9,
        `candidateScoreP95MedianRatio (${explanation.candidateScoreP95MedianRatio}) should be >= candidateScoreP90MedianRatio (${explanation.candidateScoreP90MedianRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQQQQ-4: for n=2 equals (0.95*w + 0.05*r) / (0.5*w + 0.5*r)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP95MedianRatio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0) {
      const p95 = 0.95 * explanation.winnerScore + 0.05 * explanation.runnerUpScore;
      const median = 0.5 * explanation.winnerScore + 0.5 * explanation.runnerUpScore;
      if (median > 0) {
        const expected = p95 / median;
        assert.ok(
          Math.abs(explanation.candidateScoreP95MedianRatio - expected) < 1e-9,
          `candidateScoreP95MedianRatio (${explanation.candidateScoreP95MedianRatio}) should equal (0.95w+0.05r)/(0.5w+0.5r) (${expected}) for n=2`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQQQQ-5: absent on cast:no_match', async () => {
  const path = dlqPath('q5');
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
      !('candidateScoreP95MedianRatio' in parsed.explanation),
      `candidateScoreP95MedianRatio should be absent on no_match, found: ${parsed.explanation.candidateScoreP95MedianRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('QQQQQQQQ-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP95MedianRatio' in explanation),
      `candidateScoreP95MedianRatio should be absent with single candidate, found: ${explanation.candidateScoreP95MedianRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQQQQ-7: identity — candidateScoreP95MedianRatio * medianCandidateScore === candidateScoreP95', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP95MedianRatio' in explanation && 'medianCandidateScore' in explanation && 'candidateScoreP95' in explanation) {
      const product = explanation.candidateScoreP95MedianRatio * explanation.medianCandidateScore;
      assert.ok(
        Math.abs(product - explanation.candidateScoreP95) < 1e-9,
        `candidateScoreP95MedianRatio * medianCandidateScore (${product}) should equal candidateScoreP95 (${explanation.candidateScoreP95})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQQQQ-8: tool description documents candidateScoreP95MedianRatio', async () => {
  const path = dlqPath('q8');
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
      cast.description?.includes('candidateScoreP95MedianRatio'),
      `cast description should mention candidateScoreP95MedianRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
