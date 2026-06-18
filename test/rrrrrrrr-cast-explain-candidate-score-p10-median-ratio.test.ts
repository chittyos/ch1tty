/**
 * RRRRRRRR: explanation.candidateScoreP10MedianRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreP10MedianRatio: number — ratio of P10 to median (P50):
 * candidateScoreP10 / medianCandidateScore.
 *
 * Present when: >= 2 candidates and medianCandidateScore > 0.
 * Absent when: no_match, single candidate, or medianCandidateScore === 0.
 * Always <= 1 (P10 <= P50 by definition).
 * Always >= candidateScoreP05MedianRatio when both present (P10 >= P05).
 * Always <= candidateScoreP25MedianRatio when both present (P10 <= P25).
 * Inverse of candidateScoreMedianToP10Ratio: product === 1 when both present.
 * For n=2: (0.1*w + 0.9*r) / (0.5*w + 0.5*r).
 * Identity: candidateScoreP10MedianRatio * medianCandidateScore === candidateScoreP10.
 *
 * Covered:
 *   RRRRRRRR-1: present when >= 2 candidates and medianCandidateScore > 0
 *   RRRRRRRR-2: always <= 1 and finite when present
 *   RRRRRRRR-3: always >= candidateScoreP05MedianRatio when both present (P10 >= P05)
 *   RRRRRRRR-4: for n=2 equals (0.1*w + 0.9*r) / (0.5*w + 0.5*r)
 *   RRRRRRRR-5: absent on cast:no_match
 *   RRRRRRRR-6: absent when only 1 candidate
 *   RRRRRRRR-7: identity — candidateScoreP10MedianRatio * medianCandidateScore === candidateScoreP10
 *   RRRRRRRR-8: tool description documents candidateScoreP10MedianRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-rrrrrrrr-${label}-${Date.now()}.jsonl`);
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

test('RRRRRRRR-1: present when >= 2 candidates and medianCandidateScore > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('r1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('medianCandidateScore' in explanation && explanation.medianCandidateScore > 0 && 'candidateScoreP10' in explanation) {
      assert.ok('candidateScoreP10MedianRatio' in explanation,
        `candidateScoreP10MedianRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreP10MedianRatio, 'number', 'candidateScoreP10MedianRatio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('RRRRRRRR-2: always <= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('r2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP10MedianRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP10MedianRatio),
        `candidateScoreP10MedianRatio should be finite, got ${explanation.candidateScoreP10MedianRatio}`,
      );
      assert.ok(
        explanation.candidateScoreP10MedianRatio <= 1 + 1e-9,
        `candidateScoreP10MedianRatio should be <= 1, got ${explanation.candidateScoreP10MedianRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('RRRRRRRR-3: always >= candidateScoreP05MedianRatio when both present (P10 >= P05)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('r3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP10MedianRatio' in explanation && 'candidateScoreP05MedianRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreP10MedianRatio >= explanation.candidateScoreP05MedianRatio - 1e-9,
        `candidateScoreP10MedianRatio (${explanation.candidateScoreP10MedianRatio}) should be >= candidateScoreP05MedianRatio (${explanation.candidateScoreP05MedianRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('RRRRRRRR-4: for n=2 equals (0.1*w + 0.9*r) / (0.5*w + 0.5*r)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('r4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP10MedianRatio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0) {
      const p10 = 0.1 * explanation.winnerScore + 0.9 * explanation.runnerUpScore;
      const median = 0.5 * explanation.winnerScore + 0.5 * explanation.runnerUpScore;
      if (median > 0) {
        const expected = p10 / median;
        assert.ok(
          Math.abs(explanation.candidateScoreP10MedianRatio - expected) < 1e-9,
          `candidateScoreP10MedianRatio (${explanation.candidateScoreP10MedianRatio}) should equal (0.1w+0.9r)/(0.5w+0.5r) (${expected}) for n=2`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('RRRRRRRR-5: absent on cast:no_match', async () => {
  const path = dlqPath('r5');
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
      !('candidateScoreP10MedianRatio' in parsed.explanation),
      `candidateScoreP10MedianRatio should be absent on no_match, found: ${parsed.explanation.candidateScoreP10MedianRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('RRRRRRRR-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('r6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP10MedianRatio' in explanation),
      `candidateScoreP10MedianRatio should be absent with single candidate, found: ${explanation.candidateScoreP10MedianRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('RRRRRRRR-7: identity — candidateScoreP10MedianRatio * medianCandidateScore === candidateScoreP10', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('r7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP10MedianRatio' in explanation && 'medianCandidateScore' in explanation && 'candidateScoreP10' in explanation) {
      const product = explanation.candidateScoreP10MedianRatio * explanation.medianCandidateScore;
      assert.ok(
        Math.abs(product - explanation.candidateScoreP10) < 1e-9,
        `candidateScoreP10MedianRatio * medianCandidateScore (${product}) should equal candidateScoreP10 (${explanation.candidateScoreP10})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('RRRRRRRR-8: tool description documents candidateScoreP10MedianRatio', async () => {
  const path = dlqPath('r8');
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
      cast.description?.includes('candidateScoreP10MedianRatio'),
      `cast description should mention candidateScoreP10MedianRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
