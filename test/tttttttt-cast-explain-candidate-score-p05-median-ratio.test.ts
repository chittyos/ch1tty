/**
 * TTTTTTTT: explanation.candidateScoreP05MedianRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreP05MedianRatio: number — ratio of P05 to median (P50):
 * candidateScoreP05 / medianCandidateScore.
 *
 * Present when: >= 2 candidates and medianCandidateScore > 0.
 * Absent when: no_match, single candidate, or medianCandidateScore === 0.
 * Always <= 1 (P05 <= P50 by definition).
 * Always <= candidateScoreP10MedianRatio when both present (P05 <= P10).
 * Inverse of candidateScoreMedianToP05Ratio: product === 1 when both present.
 * For n=2: (0.05*w + 0.95*r) / (0.5*w + 0.5*r).
 * Identity: candidateScoreP05MedianRatio * medianCandidateScore === candidateScoreP05.
 *
 * Covered:
 *   TTTTTTTT-1: present when >= 2 candidates and medianCandidateScore > 0
 *   TTTTTTTT-2: always <= 1 and finite when present
 *   TTTTTTTT-3: always <= candidateScoreP10MedianRatio when both present (P05 <= P10)
 *   TTTTTTTT-4: for n=2 equals (0.05*w + 0.95*r) / (0.5*w + 0.5*r)
 *   TTTTTTTT-5: absent on cast:no_match
 *   TTTTTTTT-6: absent when only 1 candidate
 *   TTTTTTTT-7: identity — candidateScoreP05MedianRatio * medianCandidateScore === candidateScoreP05
 *   TTTTTTTT-8: tool description documents candidateScoreP05MedianRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-tttttttt-${label}-${Date.now()}.jsonl`);
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

test('TTTTTTTT-1: present when >= 2 candidates and medianCandidateScore > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('medianCandidateScore' in explanation && explanation.medianCandidateScore > 0 && 'candidateScoreP05' in explanation) {
      assert.ok('candidateScoreP05MedianRatio' in explanation,
        `candidateScoreP05MedianRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreP05MedianRatio, 'number', 'candidateScoreP05MedianRatio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('TTTTTTTT-2: always <= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP05MedianRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP05MedianRatio),
        `candidateScoreP05MedianRatio should be finite, got ${explanation.candidateScoreP05MedianRatio}`,
      );
      assert.ok(
        explanation.candidateScoreP05MedianRatio <= 1 + 1e-9,
        `candidateScoreP05MedianRatio should be <= 1, got ${explanation.candidateScoreP05MedianRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('TTTTTTTT-3: always <= candidateScoreP10MedianRatio when both present (P05 <= P10)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP05MedianRatio' in explanation && 'candidateScoreP10MedianRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreP05MedianRatio <= explanation.candidateScoreP10MedianRatio + 1e-9,
        `candidateScoreP05MedianRatio (${explanation.candidateScoreP05MedianRatio}) should be <= candidateScoreP10MedianRatio (${explanation.candidateScoreP10MedianRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('TTTTTTTT-4: for n=2 equals (0.05*w + 0.95*r) / (0.5*w + 0.5*r)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP05MedianRatio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0) {
      const p05 = 0.05 * explanation.winnerScore + 0.95 * explanation.runnerUpScore;
      const median = 0.5 * explanation.winnerScore + 0.5 * explanation.runnerUpScore;
      if (median > 0) {
        const expected = p05 / median;
        assert.ok(
          Math.abs(explanation.candidateScoreP05MedianRatio - expected) < 1e-9,
          `candidateScoreP05MedianRatio (${explanation.candidateScoreP05MedianRatio}) should equal (0.05w+0.95r)/(0.5w+0.5r) (${expected}) for n=2`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('TTTTTTTT-5: absent on cast:no_match', async () => {
  const path = dlqPath('t5');
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
      !('candidateScoreP05MedianRatio' in parsed.explanation),
      `candidateScoreP05MedianRatio should be absent on no_match, found: ${parsed.explanation.candidateScoreP05MedianRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('TTTTTTTT-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP05MedianRatio' in explanation),
      `candidateScoreP05MedianRatio should be absent with single candidate, found: ${explanation.candidateScoreP05MedianRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('TTTTTTTT-7: identity — candidateScoreP05MedianRatio * medianCandidateScore === candidateScoreP05', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP05MedianRatio' in explanation && 'medianCandidateScore' in explanation && 'candidateScoreP05' in explanation) {
      const product = explanation.candidateScoreP05MedianRatio * explanation.medianCandidateScore;
      assert.ok(
        Math.abs(product - explanation.candidateScoreP05) < 1e-9,
        `candidateScoreP05MedianRatio * medianCandidateScore (${product}) should equal candidateScoreP05 (${explanation.candidateScoreP05})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('TTTTTTTT-8: tool description documents candidateScoreP05MedianRatio', async () => {
  const path = dlqPath('t8');
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
      cast.description?.includes('candidateScoreP05MedianRatio'),
      `cast description should mention candidateScoreP05MedianRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
