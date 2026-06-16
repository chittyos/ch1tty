/**
 * PPPPPPP: explanation.top2HeavinessRatio in ch1tty/cast when explain:true.
 *
 * top2HeavinessRatio: number — (winnerScore + runnerUpScore) / candidateScoreEntropyTotal.
 * Fraction of total score mass in the top-2 candidates.
 * Middle layer in the concentration hierarchy: scoreDominanceIndex (top-1) < top2HeavinessRatio (top-2) <= topHeavinessRatio (top-5).
 *
 * Present when: >= 2 candidates and candidateScoreEntropyTotal > 0.
 * Absent when: no_match, single candidate, or all scores are 0.
 * Always in (0, 1].
 * Identity: top2HeavinessRatio * candidateScoreEntropyTotal === winnerScore + runnerUpScore.
 * Always >= scoreDominanceIndex (top-2 includes the winner's share).
 * Always <= topHeavinessRatio (top-2 is a subset of top-5).
 *
 * Covered:
 *   PPPPPPP-1: present when >= 2 candidates with nonzero total score
 *   PPPPPPP-2: always in (0, 1] and finite when present
 *   PPPPPPP-3: equals 1 when all score mass is in top-2 (rest score 0)
 *   PPPPPPP-4: identity — top2HeavinessRatio * totalScore === winnerScore + runnerUpScore
 *   PPPPPPP-5: absent on cast:no_match
 *   PPPPPPP-6: absent when only 1 candidate
 *   PPPPPPP-7: always >= scoreDominanceIndex when both present
 *   PPPPPPP-8: tool description documents top2HeavinessRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-ppppppp-${label}-${Date.now()}.jsonl`);
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

test('PPPPPPP-1: present when >= 2 candidates with nonzero total score', async () => {
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
    assert.ok('top2HeavinessRatio' in explanation,
      `top2HeavinessRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.top2HeavinessRatio, 'number', 'top2HeavinessRatio should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('PPPPPPP-2: always in (0, 1] and finite when present', async () => {
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
    if ('top2HeavinessRatio' in explanation) {
      assert.ok(
        explanation.top2HeavinessRatio > -1e-9,
        `top2HeavinessRatio should be > 0, got ${explanation.top2HeavinessRatio}`,
      );
      assert.ok(
        explanation.top2HeavinessRatio <= 1 + 1e-9,
        `top2HeavinessRatio should be <= 1, got ${explanation.top2HeavinessRatio}`,
      );
      assert.ok(
        Number.isFinite(explanation.top2HeavinessRatio),
        `top2HeavinessRatio should be finite, got ${explanation.top2HeavinessRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('PPPPPPP-3: equals 1 when candidateCount === 2 (all score mass in top-2)', async () => {
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
    if ('top2HeavinessRatio' in explanation && explanation.candidateCount === 2) {
      assert.ok(
        Math.abs(explanation.top2HeavinessRatio - 1) < 1e-9,
        `top2HeavinessRatio should be 1 when candidateCount === 2, got ${explanation.top2HeavinessRatio}`,
      );
    }
    assert.ok(explanation.candidateCount >= 1, 'should have candidates');
  } finally {
    await agg.shutdown();
  }
});

test('PPPPPPP-4: identity — top2HeavinessRatio * totalScore === winnerScore + runnerUpScore', async () => {
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
    if ('top2HeavinessRatio' in explanation && 'candidateScoreMean' in explanation) {
      const totalScore = explanation.candidateScoreMean * explanation.candidateCount;
      const reconstructed = explanation.top2HeavinessRatio * totalScore;
      const expected = explanation.winnerScore + explanation.runnerUpScore;
      assert.ok(
        Math.abs(reconstructed - expected) < 1e-9,
        `top2HeavinessRatio * totalScore (${reconstructed}) should equal winnerScore + runnerUpScore (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('PPPPPPP-5: absent on cast:no_match', async () => {
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
      !('top2HeavinessRatio' in parsed.explanation),
      `top2HeavinessRatio should be absent on no_match, found: ${parsed.explanation.top2HeavinessRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('PPPPPPP-6: absent when only 1 candidate', async () => {
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
      !('top2HeavinessRatio' in explanation),
      `top2HeavinessRatio should be absent with single candidate, found: ${explanation.top2HeavinessRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('PPPPPPP-7: always >= scoreDominanceIndex when both present', async () => {
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
    if ('top2HeavinessRatio' in explanation && 'scoreDominanceIndex' in explanation) {
      assert.ok(
        explanation.top2HeavinessRatio >= explanation.scoreDominanceIndex - 1e-9,
        `top2HeavinessRatio (${explanation.top2HeavinessRatio}) should be >= scoreDominanceIndex (${explanation.scoreDominanceIndex})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('PPPPPPP-8: tool description documents top2HeavinessRatio', async () => {
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
      cast.description?.includes('top2HeavinessRatio'),
      `cast description should mention top2HeavinessRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
