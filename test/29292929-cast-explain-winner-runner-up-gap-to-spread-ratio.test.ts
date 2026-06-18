/**
 * 29292929: explanation.winnerRunnerUpGapToSpreadRatio in ch1tty/cast when explain:true.
 *
 * winnerRunnerUpGapToSpreadRatio: number — the winner-runner-up gap as a fraction of full spread:
 * winnerRunnerUpGap / candidateScoreSpread = (winner - runnerUp) / (winner - lowest).
 *
 * Present when: >= 2 candidates and candidateScoreSpread > 0 (not all candidates tied).
 * Absent when: no_match, single candidate, or spread === 0.
 * Always in (0, 1]: top-2 gap <= full range; equality when runnerUp === lowest.
 * For n=2: always === 1 (runnerUp === lowest, so gap === spread).
 * Complement: (1 - ratio) * spread === runnerUpScore - lowestCandidateScore.
 * Identity: winnerRunnerUpGapToSpreadRatio * candidateScoreSpread === winnerRunnerUpGap.
 *
 * Covered:
 *   29292929-1: present when >= 2 candidates and spread > 0
 *   29292929-2: always in (0, 1] when present
 *   29292929-3: complement identity — (1 - ratio) * spread === runnerUpScore - lowestCandidateScore
 *   29292929-4: for n=2 equals 1
 *   29292929-5: absent on cast:no_match
 *   29292929-6: absent when only 1 candidate
 *   29292929-7: identity — winnerRunnerUpGapToSpreadRatio * candidateScoreSpread === winnerRunnerUpGap
 *   29292929-8: tool description documents winnerRunnerUpGapToSpreadRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-29292929-${label}-${Date.now()}.jsonl`);
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

test('29292929-1: present when >= 2 candidates and spread > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ddd1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreSpread' in explanation && explanation.candidateScoreSpread > 0) {
      assert.ok('winnerRunnerUpGapToSpreadRatio' in explanation,
        `winnerRunnerUpGapToSpreadRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.winnerRunnerUpGapToSpreadRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('29292929-2: always in (0, 1] when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ddd2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerRunnerUpGapToSpreadRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.winnerRunnerUpGapToSpreadRatio),
        `should be finite, got ${explanation.winnerRunnerUpGapToSpreadRatio}`,
      );
      assert.ok(
        explanation.winnerRunnerUpGapToSpreadRatio > 0,
        `should be > 0, got ${explanation.winnerRunnerUpGapToSpreadRatio}`,
      );
      assert.ok(
        explanation.winnerRunnerUpGapToSpreadRatio <= 1,
        `should be <= 1, got ${explanation.winnerRunnerUpGapToSpreadRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('29292929-3: complement — (1 - ratio) * spread === runnerUpScore - lowestCandidateScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ddd3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerRunnerUpGapToSpreadRatio' in explanation &&
        'candidateScoreSpread' in explanation &&
        'runnerUpScore' in explanation &&
        'lowestCandidateScore' in explanation) {
      const complement = (1 - explanation.winnerRunnerUpGapToSpreadRatio) * explanation.candidateScoreSpread;
      const expected = explanation.runnerUpScore - explanation.lowestCandidateScore;
      assert.ok(
        Math.abs(complement - expected) < 1e-9,
        `(1 - ratio) * spread (${complement}) should equal runnerUpScore - lowestCandidateScore (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('29292929-4: for n=2 equals 1', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ddd4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerRunnerUpGapToSpreadRatio' in explanation && explanation.candidateCount === 2) {
      assert.ok(
        Math.abs(explanation.winnerRunnerUpGapToSpreadRatio - 1) < 1e-9,
        `winnerRunnerUpGapToSpreadRatio (${explanation.winnerRunnerUpGapToSpreadRatio}) should equal 1 for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('29292929-5: absent on cast:no_match', async () => {
  const path = dlqPath('ddd5');
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
      !('winnerRunnerUpGapToSpreadRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.winnerRunnerUpGapToSpreadRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('29292929-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ddd6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('winnerRunnerUpGapToSpreadRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.winnerRunnerUpGapToSpreadRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('29292929-7: identity — winnerRunnerUpGapToSpreadRatio * candidateScoreSpread === winnerRunnerUpGap', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ddd7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerRunnerUpGapToSpreadRatio' in explanation &&
        'candidateScoreSpread' in explanation &&
        'winnerRunnerUpGap' in explanation) {
      const product = explanation.winnerRunnerUpGapToSpreadRatio * explanation.candidateScoreSpread;
      assert.ok(
        Math.abs(product - explanation.winnerRunnerUpGap) < 1e-9,
        `winnerRunnerUpGapToSpreadRatio * candidateScoreSpread (${product}) should equal winnerRunnerUpGap (${explanation.winnerRunnerUpGap})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('29292929-8: tool description documents winnerRunnerUpGapToSpreadRatio', async () => {
  const path = dlqPath('ddd8');
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
      cast.description?.includes('winnerRunnerUpGapToSpreadRatio'),
      `cast description should mention winnerRunnerUpGapToSpreadRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
