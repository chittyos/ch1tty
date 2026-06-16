/**
 * RRRRRRRR: explanation.candidateScoreMedianToP90Ratio in ch1tty/cast when explain:true.
 *
 * candidateScoreMedianToP90Ratio: number — ratio of median to 90th percentile:
 * medianCandidateScore / candidateScoreP90.
 *
 * Present when: >= 2 candidates, medianCandidateScore defined, candidateScoreP90 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP90 === 0.
 * Always in (0, 1] (median <= P90).
 * For n=2: (winnerScore + runnerUpScore) / (2 * (0.9*winner + 0.1*runnerUp)).
 * Identity: candidateScoreMedianToP90Ratio * candidateScoreP90 === medianCandidateScore.
 *
 * Covered:
 *   RRRRRRRR-1: present when >= 2 candidates and candidateScoreP90 > 0
 *   RRRRRRRR-2: always in (0, 1] and finite when present
 *   RRRRRRRR-3: always <= medianToMeanRatio when both present (P90 >= mean)
 *   RRRRRRRR-4: for n=2 equals (w+r) / (2*(0.9w + 0.1r))
 *   RRRRRRRR-5: absent on cast:no_match
 *   RRRRRRRR-6: absent when only 1 candidate
 *   RRRRRRRR-7: identity — candidateScoreMedianToP90Ratio * candidateScoreP90 === medianCandidateScore
 *   RRRRRRRR-8: tool description documents candidateScoreMedianToP90Ratio
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

test('RRRRRRRR-1: present when >= 2 candidates and candidateScoreP90 > 0', async () => {
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
    if ('candidateScoreP90' in explanation && explanation.candidateScoreP90 > 0 && 'medianCandidateScore' in explanation) {
      assert.ok('candidateScoreMedianToP90Ratio' in explanation,
        `candidateScoreMedianToP90Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreMedianToP90Ratio, 'number', 'candidateScoreMedianToP90Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('RRRRRRRR-2: always in (0, 1] and finite when present', async () => {
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
    if ('candidateScoreMedianToP90Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreMedianToP90Ratio),
        `candidateScoreMedianToP90Ratio should be finite, got ${explanation.candidateScoreMedianToP90Ratio}`,
      );
      assert.ok(
        explanation.candidateScoreMedianToP90Ratio > -1e-9,
        `candidateScoreMedianToP90Ratio should be > 0, got ${explanation.candidateScoreMedianToP90Ratio}`,
      );
      assert.ok(
        explanation.candidateScoreMedianToP90Ratio <= 1 + 1e-9,
        `candidateScoreMedianToP90Ratio should be <= 1, got ${explanation.candidateScoreMedianToP90Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('RRRRRRRR-3: always <= medianToMeanRatio when both present (P90 >= mean)', async () => {
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
    if ('candidateScoreMedianToP90Ratio' in explanation && 'medianToMeanRatio' in explanation) {
      // P90 >= mean (90th percentile >= average), so median/P90 <= median/mean
      assert.ok(
        explanation.candidateScoreMedianToP90Ratio <= explanation.medianToMeanRatio + 1e-9,
        `candidateScoreMedianToP90Ratio (${explanation.candidateScoreMedianToP90Ratio}) should be <= medianToMeanRatio (${explanation.medianToMeanRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('RRRRRRRR-4: for n=2 equals (w+r) / (2*(0.9*w + 0.1*r))', async () => {
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
    if ('candidateScoreMedianToP90Ratio' in explanation && explanation.candidateCount === 2) {
      const p90 = 0.9 * explanation.winnerScore + 0.1 * explanation.runnerUpScore;
      if (p90 > 0) {
        const median = (explanation.winnerScore + explanation.runnerUpScore) / 2;
        const expected = median / p90;
        assert.ok(
          Math.abs(explanation.candidateScoreMedianToP90Ratio - expected) < 1e-9,
          `candidateScoreMedianToP90Ratio (${explanation.candidateScoreMedianToP90Ratio}) should equal (w+r)/(2*(0.9w+0.1r)) (${expected}) for n=2`,
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
      !('candidateScoreMedianToP90Ratio' in parsed.explanation),
      `candidateScoreMedianToP90Ratio should be absent on no_match, found: ${parsed.explanation.candidateScoreMedianToP90Ratio}`,
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
      !('candidateScoreMedianToP90Ratio' in explanation),
      `candidateScoreMedianToP90Ratio should be absent with single candidate, found: ${explanation.candidateScoreMedianToP90Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('RRRRRRRR-7: identity — candidateScoreMedianToP90Ratio * candidateScoreP90 === medianCandidateScore', async () => {
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
    if ('candidateScoreMedianToP90Ratio' in explanation && 'candidateScoreP90' in explanation && 'medianCandidateScore' in explanation) {
      const product = explanation.candidateScoreMedianToP90Ratio * explanation.candidateScoreP90;
      assert.ok(
        Math.abs(product - explanation.medianCandidateScore) < 1e-9,
        `candidateScoreMedianToP90Ratio * candidateScoreP90 (${product}) should equal medianCandidateScore (${explanation.medianCandidateScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('RRRRRRRR-8: tool description documents candidateScoreMedianToP90Ratio', async () => {
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
      cast.description?.includes('candidateScoreMedianToP90Ratio'),
      `cast description should mention candidateScoreMedianToP90Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
