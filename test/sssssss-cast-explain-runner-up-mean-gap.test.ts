/**
 * SSSSSSS: explanation.runnerUpMeanGap in ch1tty/cast when explain:true.
 *
 * runnerUpMeanGap: number — runnerUpScore - candidateScoreMean.
 * The runner-up's position relative to the pool mean. Can be negative.
 *
 * Present when: >= 2 candidates exist.
 * Absent when: no_match or single candidate.
 * Can be negative when runner-up scores below the pool mean.
 * Identity: runnerUpMeanGap / candidateScoreStdDev === runnerUpScoreZScore.
 * Structural: winnerMeanGap - runnerUpMeanGap === winnerRunnerUpGap.
 *
 * Covered:
 *   SSSSSSS-1: present when >= 2 candidates
 *   SSSSSSS-2: finite when present (may be negative)
 *   SSSSSSS-3: equals 0 when runner-up scores exactly at the mean
 *   SSSSSSS-4: identity — runnerUpMeanGap === runnerUpScore - candidateScoreMean
 *   SSSSSSS-5: absent on cast:no_match
 *   SSSSSSS-6: absent when only 1 candidate
 *   SSSSSSS-7: structural — winnerMeanGap - runnerUpMeanGap === winnerRunnerUpGap
 *   SSSSSSS-8: tool description documents runnerUpMeanGap
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-sssssss-${label}-${Date.now()}.jsonl`);
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

test('SSSSSSS-1: present when >= 2 candidates', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('s1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    assert.ok('runnerUpMeanGap' in explanation,
      `runnerUpMeanGap should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.runnerUpMeanGap, 'number', 'runnerUpMeanGap should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('SSSSSSS-2: finite when present (may be negative)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('s2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpMeanGap' in explanation) {
      assert.ok(
        Number.isFinite(explanation.runnerUpMeanGap),
        `runnerUpMeanGap should be finite, got ${explanation.runnerUpMeanGap}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('SSSSSSS-3: equals 0 when all candidates have identical scores', async () => {
  const SAME_DESC = 'billing invoice payment charge query database';
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('s3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: SAME_DESC, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpMeanGap' in explanation && 'candidateScoreSpread' in explanation) {
      if (Math.abs(explanation.candidateScoreSpread) < 1e-9) {
        assert.ok(
          Math.abs(explanation.runnerUpMeanGap) < 1e-9,
          `runnerUpMeanGap should be ~0 when all scores identical, got ${explanation.runnerUpMeanGap}`,
        );
      }
    }
    assert.ok(explanation.candidateCount >= 1, 'should have candidates');
  } finally {
    await agg.shutdown();
  }
});

test('SSSSSSS-4: identity — runnerUpMeanGap === runnerUpScore - candidateScoreMean', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('s4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpMeanGap' in explanation && 'runnerUpScore' in explanation && 'candidateScoreMean' in explanation) {
      const expected = explanation.runnerUpScore - explanation.candidateScoreMean;
      assert.ok(
        Math.abs(explanation.runnerUpMeanGap - expected) < 1e-9,
        `runnerUpMeanGap (${explanation.runnerUpMeanGap}) should equal runnerUpScore - candidateScoreMean (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('SSSSSSS-5: absent on cast:no_match', async () => {
  const path = dlqPath('s5');
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
      !('runnerUpMeanGap' in parsed.explanation),
      `runnerUpMeanGap should be absent on no_match, found: ${parsed.explanation.runnerUpMeanGap}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('SSSSSSS-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('s6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('runnerUpMeanGap' in explanation),
      `runnerUpMeanGap should be absent with single candidate, found: ${explanation.runnerUpMeanGap}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('SSSSSSS-7: structural — winnerMeanGap - runnerUpMeanGap === winnerRunnerUpGap', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('s7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if (
      'winnerMeanGap' in explanation &&
      'runnerUpMeanGap' in explanation &&
      'winnerRunnerUpGap' in explanation
    ) {
      const reconstructed = explanation.winnerMeanGap - explanation.runnerUpMeanGap;
      assert.ok(
        Math.abs(reconstructed - explanation.winnerRunnerUpGap) < 1e-9,
        `winnerMeanGap - runnerUpMeanGap (${reconstructed}) should equal winnerRunnerUpGap (${explanation.winnerRunnerUpGap})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('SSSSSSS-8: tool description documents runnerUpMeanGap', async () => {
  const path = dlqPath('s8');
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
      cast.description?.includes('runnerUpMeanGap'),
      `cast description should mention runnerUpMeanGap, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
