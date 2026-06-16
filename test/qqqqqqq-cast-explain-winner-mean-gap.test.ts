/**
 * QQQQQQQ: explanation.winnerMeanGap in ch1tty/cast when explain:true.
 *
 * winnerMeanGap: number — winnerScore - candidateScoreMean.
 * Absolute gap between the winner's score and the pool mean.
 *
 * Present when: >= 2 candidates exist.
 * Absent when: no_match or single candidate.
 * Always >= 0: the winner is always at or above the mean.
 * A value of 0 means all candidates scored identically.
 * Identity: winnerMeanGap / candidateScoreStdDev === winnerScoreZScore
 *   when both are present and candidateScoreStdDev > 0.
 *
 * Covered:
 *   QQQQQQQ-1: present when >= 2 candidates
 *   QQQQQQQ-2: always >= 0 and finite when present
 *   QQQQQQQ-3: equals 0 when all candidates have identical scores
 *   QQQQQQQ-4: identity — winnerMeanGap === winnerScore - candidateScoreMean
 *   QQQQQQQ-5: absent on cast:no_match
 *   QQQQQQQ-6: absent when only 1 candidate
 *   QQQQQQQ-7: identity — winnerMeanGap / candidateScoreStdDev === winnerScoreZScore
 *   QQQQQQQ-8: tool description documents winnerMeanGap
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-qqqqqqq-${label}-${Date.now()}.jsonl`);
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

test('QQQQQQQ-1: present when >= 2 candidates', async () => {
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
    assert.ok('winnerMeanGap' in explanation,
      `winnerMeanGap should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.winnerMeanGap, 'number', 'winnerMeanGap should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQQQ-2: always >= 0 and finite when present', async () => {
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
    if ('winnerMeanGap' in explanation) {
      assert.ok(
        explanation.winnerMeanGap >= -1e-9,
        `winnerMeanGap should be >= 0, got ${explanation.winnerMeanGap}`,
      );
      assert.ok(
        Number.isFinite(explanation.winnerMeanGap),
        `winnerMeanGap should be finite, got ${explanation.winnerMeanGap}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQQQ-3: equals 0 when all candidates have identical scores', async () => {
  const SAME_DESC = 'billing invoice payment charge query database';
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: SAME_DESC, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerMeanGap' in explanation && 'candidateScoreSpread' in explanation) {
      if (Math.abs(explanation.candidateScoreSpread) < 1e-9) {
        assert.ok(
          Math.abs(explanation.winnerMeanGap) < 1e-9,
          `winnerMeanGap should be 0 when all scores equal, got ${explanation.winnerMeanGap}`,
        );
      }
    }
    assert.ok(explanation.candidateCount >= 1, 'should have candidates');
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQQQ-4: identity — winnerMeanGap === winnerScore - candidateScoreMean', async () => {
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
    if ('winnerMeanGap' in explanation && 'winnerScore' in explanation && 'candidateScoreMean' in explanation) {
      const expected = explanation.winnerScore - explanation.candidateScoreMean;
      assert.ok(
        Math.abs(explanation.winnerMeanGap - expected) < 1e-9,
        `winnerMeanGap (${explanation.winnerMeanGap}) should equal winnerScore - candidateScoreMean (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQQQ-5: absent on cast:no_match', async () => {
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
      !('winnerMeanGap' in parsed.explanation),
      `winnerMeanGap should be absent on no_match, found: ${parsed.explanation.winnerMeanGap}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('QQQQQQQ-6: absent when only 1 candidate', async () => {
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
      !('winnerMeanGap' in explanation),
      `winnerMeanGap should be absent with single candidate, found: ${explanation.winnerMeanGap}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQQQ-7: identity — winnerMeanGap / candidateScoreStdDev === winnerScoreZScore', async () => {
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
    if (
      'winnerMeanGap' in explanation &&
      'candidateScoreStdDev' in explanation &&
      'winnerScoreZScore' in explanation &&
      explanation.candidateScoreStdDev > 0
    ) {
      const reconstructed = explanation.winnerMeanGap / explanation.candidateScoreStdDev;
      assert.ok(
        Math.abs(reconstructed - explanation.winnerScoreZScore) < 1e-9,
        `winnerMeanGap / candidateScoreStdDev (${reconstructed}) should equal winnerScoreZScore (${explanation.winnerScoreZScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQQQ-8: tool description documents winnerMeanGap', async () => {
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
      cast.description?.includes('winnerMeanGap'),
      `cast description should mention winnerMeanGap, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
