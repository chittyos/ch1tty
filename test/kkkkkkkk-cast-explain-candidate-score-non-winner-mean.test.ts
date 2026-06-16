/**
 * KKKKKKKK: explanation.candidateScoreNonWinnerMean in ch1tty/cast when explain:true.
 *
 * candidateScoreNonWinnerMean: number — arithmetic mean of all candidate
 * scores excluding the winner: (sum - winnerScore) / (n - 1).
 *
 * Present when: >= 2 candidates (always — at least one non-winner exists).
 * Absent when: no_match or single candidate.
 * Always >= 0.
 * Always <= candidateScoreMean (removing the maximum can't increase the average).
 * Always <= winnerScore.
 * For n=2: equals runnerUpScore exactly.
 * Identity: winnerScore + candidateScoreNonWinnerMean * (n-1) === candidateScoreMean * n.
 *
 * Covered:
 *   KKKKKKKK-1: present when >= 2 candidates
 *   KKKKKKKK-2: always >= 0 and finite when present
 *   KKKKKKKK-3: always <= candidateScoreMean
 *   KKKKKKKK-4: for n=2 equals runnerUpScore
 *   KKKKKKKK-5: absent on cast:no_match
 *   KKKKKKKK-6: absent when only 1 candidate
 *   KKKKKKKK-7: identity — winnerScore + nonWinnerMean*(n-1) === mean*n
 *   KKKKKKKK-8: tool description documents candidateScoreNonWinnerMean
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-kkkkkkkk-${label}-${Date.now()}.jsonl`);
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

test('KKKKKKKK-1: present when >= 2 candidates', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    assert.ok('candidateScoreNonWinnerMean' in explanation,
      `candidateScoreNonWinnerMean should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.candidateScoreNonWinnerMean, 'number', 'candidateScoreNonWinnerMean should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKKKK-2: always >= 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerMean' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreNonWinnerMean),
        `candidateScoreNonWinnerMean should be finite, got ${explanation.candidateScoreNonWinnerMean}`,
      );
      assert.ok(
        explanation.candidateScoreNonWinnerMean >= -1e-9,
        `candidateScoreNonWinnerMean should be >= 0, got ${explanation.candidateScoreNonWinnerMean}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKKKK-3: always <= candidateScoreMean', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerMean' in explanation && 'candidateScoreMean' in explanation) {
      assert.ok(
        explanation.candidateScoreNonWinnerMean <= explanation.candidateScoreMean + 1e-9,
        `candidateScoreNonWinnerMean (${explanation.candidateScoreNonWinnerMean}) should be <= candidateScoreMean (${explanation.candidateScoreMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKKKK-4: for n=2 equals runnerUpScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerMean' in explanation && explanation.candidateCount === 2) {
      assert.ok(
        Math.abs(explanation.candidateScoreNonWinnerMean - explanation.runnerUpScore) < 1e-9,
        `candidateScoreNonWinnerMean (${explanation.candidateScoreNonWinnerMean}) should equal runnerUpScore (${explanation.runnerUpScore}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKKKK-5: absent on cast:no_match', async () => {
  const path = dlqPath('k5');
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
      !('candidateScoreNonWinnerMean' in parsed.explanation),
      `candidateScoreNonWinnerMean should be absent on no_match, found: ${parsed.explanation.candidateScoreNonWinnerMean}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('KKKKKKKK-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreNonWinnerMean' in explanation),
      `candidateScoreNonWinnerMean should be absent with single candidate, found: ${explanation.candidateScoreNonWinnerMean}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKKKK-7: identity — winnerScore + nonWinnerMean*(n-1) === mean*n', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerMean' in explanation && 'winnerScore' in explanation && 'candidateScoreMean' in explanation) {
      const n = explanation.candidateCount;
      const lhs = explanation.winnerScore + explanation.candidateScoreNonWinnerMean * (n - 1);
      const rhs = explanation.candidateScoreMean * n;
      assert.ok(
        Math.abs(lhs - rhs) < 1e-9,
        `winnerScore + nonWinnerMean*(n-1) (${lhs}) should equal candidateScoreMean*n (${rhs})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKKKK-8: tool description documents candidateScoreNonWinnerMean', async () => {
  const path = dlqPath('k8');
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
      cast.description?.includes('candidateScoreNonWinnerMean'),
      `cast description should mention candidateScoreNonWinnerMean, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
