/**
 * RRRRRRR: explanation.winnerRunnerUpGap in ch1tty/cast when explain:true.
 *
 * winnerRunnerUpGap: number — winnerScore - runnerUpScore.
 * Absolute score gap between the winner and the runner-up.
 *
 * Present when: >= 2 candidates exist.
 * Absent when: no_match or single candidate.
 * Always >= 0: the winner always scores at or above the runner-up.
 * A value of 0 means the top-2 candidates are tied.
 * Identity: winnerRunnerUpGap / candidateScoreStdDev === zScoreGap
 *   when both are present and candidateScoreStdDev > 0.
 *
 * Covered:
 *   RRRRRRR-1: present when >= 2 candidates
 *   RRRRRRR-2: always >= 0 and finite when present
 *   RRRRRRR-3: equals 0 when winner and runner-up have identical scores
 *   RRRRRRR-4: identity — winnerRunnerUpGap === winnerScore - runnerUpScore
 *   RRRRRRR-5: absent on cast:no_match
 *   RRRRRRR-6: absent when only 1 candidate
 *   RRRRRRR-7: identity — winnerRunnerUpGap / candidateScoreStdDev === zScoreGap
 *   RRRRRRR-8: tool description documents winnerRunnerUpGap
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-rrrrrrr-${label}-${Date.now()}.jsonl`);
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

test('RRRRRRR-1: present when >= 2 candidates', async () => {
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
    assert.ok('winnerRunnerUpGap' in explanation,
      `winnerRunnerUpGap should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.winnerRunnerUpGap, 'number', 'winnerRunnerUpGap should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('RRRRRRR-2: always >= 0 and finite when present', async () => {
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
    if ('winnerRunnerUpGap' in explanation) {
      assert.ok(
        explanation.winnerRunnerUpGap >= -1e-9,
        `winnerRunnerUpGap should be >= 0, got ${explanation.winnerRunnerUpGap}`,
      );
      assert.ok(
        Number.isFinite(explanation.winnerRunnerUpGap),
        `winnerRunnerUpGap should be finite, got ${explanation.winnerRunnerUpGap}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('RRRRRRR-3: equals 0 when winner and runner-up have identical scores', async () => {
  const SAME_DESC = 'billing invoice payment charge query database';
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('r3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: SAME_DESC, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerRunnerUpGap' in explanation && 'winnerScore' in explanation && 'runnerUpScore' in explanation) {
      if (Math.abs(explanation.winnerScore - explanation.runnerUpScore) < 1e-9) {
        assert.ok(
          Math.abs(explanation.winnerRunnerUpGap) < 1e-9,
          `winnerRunnerUpGap should be 0 when top-2 tied, got ${explanation.winnerRunnerUpGap}`,
        );
      }
    }
    assert.ok(explanation.candidateCount >= 1, 'should have candidates');
  } finally {
    await agg.shutdown();
  }
});

test('RRRRRRR-4: identity — winnerRunnerUpGap === winnerScore - runnerUpScore', async () => {
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
    if ('winnerRunnerUpGap' in explanation && 'winnerScore' in explanation && 'runnerUpScore' in explanation) {
      const expected = explanation.winnerScore - explanation.runnerUpScore;
      assert.ok(
        Math.abs(explanation.winnerRunnerUpGap - expected) < 1e-9,
        `winnerRunnerUpGap (${explanation.winnerRunnerUpGap}) should equal winnerScore - runnerUpScore (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('RRRRRRR-5: absent on cast:no_match', async () => {
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
      !('winnerRunnerUpGap' in parsed.explanation),
      `winnerRunnerUpGap should be absent on no_match, found: ${parsed.explanation.winnerRunnerUpGap}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('RRRRRRR-6: absent when only 1 candidate', async () => {
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
      !('winnerRunnerUpGap' in explanation),
      `winnerRunnerUpGap should be absent with single candidate, found: ${explanation.winnerRunnerUpGap}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('RRRRRRR-7: identity — winnerRunnerUpGap / candidateScoreStdDev === zScoreGap', async () => {
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
    if (
      'winnerRunnerUpGap' in explanation &&
      'candidateScoreStdDev' in explanation &&
      'zScoreGap' in explanation &&
      explanation.candidateScoreStdDev > 0
    ) {
      const reconstructed = explanation.winnerRunnerUpGap / explanation.candidateScoreStdDev;
      assert.ok(
        Math.abs(reconstructed - explanation.zScoreGap) < 1e-9,
        `winnerRunnerUpGap / candidateScoreStdDev (${reconstructed}) should equal zScoreGap (${explanation.zScoreGap})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('RRRRRRR-8: tool description documents winnerRunnerUpGap', async () => {
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
      cast.description?.includes('winnerRunnerUpGap'),
      `cast description should mention winnerRunnerUpGap, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
