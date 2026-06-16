/**
 * LLLLLLLL: explanation.candidateScoreWinnerFieldGap in ch1tty/cast when explain:true.
 *
 * candidateScoreWinnerFieldGap: number — gap between the winner score and the
 * mean of all non-winner candidate scores: winnerScore - candidateScoreNonWinnerMean.
 *
 * Present when: >= 2 candidates (same as candidateScoreNonWinnerMean).
 * Absent when: no_match or single candidate.
 * Always >= 0 (winner is max so winnerScore >= all others >= their mean).
 * For n=2: equals winnerRunnerUpGap exactly.
 * For n > 2: >= winnerRunnerUpGap (field mean <= runner-up, so winner-to-field-mean >= winner-to-runner-up).
 * Identity: candidateScoreWinnerFieldGap === winnerScore - candidateScoreNonWinnerMean.
 *
 * Covered:
 *   LLLLLLLL-1: present when >= 2 candidates
 *   LLLLLLLL-2: always >= 0 and finite when present
 *   LLLLLLLL-3: always >= winnerRunnerUpGap
 *   LLLLLLLL-4: for n=2 equals winnerRunnerUpGap exactly
 *   LLLLLLLL-5: absent on cast:no_match
 *   LLLLLLLL-6: absent when only 1 candidate
 *   LLLLLLLL-7: identity — equals winnerScore - candidateScoreNonWinnerMean
 *   LLLLLLLL-8: tool description documents candidateScoreWinnerFieldGap
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-llllllll-${label}-${Date.now()}.jsonl`);
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

test('LLLLLLLL-1: present when >= 2 candidates', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('l1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    assert.ok('candidateScoreWinnerFieldGap' in explanation,
      `candidateScoreWinnerFieldGap should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.candidateScoreWinnerFieldGap, 'number', 'candidateScoreWinnerFieldGap should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('LLLLLLLL-2: always >= 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('l2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreWinnerFieldGap' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreWinnerFieldGap),
        `candidateScoreWinnerFieldGap should be finite, got ${explanation.candidateScoreWinnerFieldGap}`,
      );
      assert.ok(
        explanation.candidateScoreWinnerFieldGap >= -1e-9,
        `candidateScoreWinnerFieldGap should be >= 0, got ${explanation.candidateScoreWinnerFieldGap}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('LLLLLLLL-3: always >= winnerRunnerUpGap', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('l3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreWinnerFieldGap' in explanation && 'winnerRunnerUpGap' in explanation) {
      assert.ok(
        explanation.candidateScoreWinnerFieldGap >= explanation.winnerRunnerUpGap - 1e-9,
        `candidateScoreWinnerFieldGap (${explanation.candidateScoreWinnerFieldGap}) should be >= winnerRunnerUpGap (${explanation.winnerRunnerUpGap})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('LLLLLLLL-4: for n=2 equals winnerRunnerUpGap exactly', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('l4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreWinnerFieldGap' in explanation && explanation.candidateCount === 2) {
      assert.ok(
        Math.abs(explanation.candidateScoreWinnerFieldGap - explanation.winnerRunnerUpGap) < 1e-9,
        `candidateScoreWinnerFieldGap (${explanation.candidateScoreWinnerFieldGap}) should equal winnerRunnerUpGap (${explanation.winnerRunnerUpGap}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('LLLLLLLL-5: absent on cast:no_match', async () => {
  const path = dlqPath('l5');
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
      !('candidateScoreWinnerFieldGap' in parsed.explanation),
      `candidateScoreWinnerFieldGap should be absent on no_match, found: ${parsed.explanation.candidateScoreWinnerFieldGap}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('LLLLLLLL-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('l6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreWinnerFieldGap' in explanation),
      `candidateScoreWinnerFieldGap should be absent with single candidate, found: ${explanation.candidateScoreWinnerFieldGap}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('LLLLLLLL-7: identity — equals winnerScore - candidateScoreNonWinnerMean', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('l7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreWinnerFieldGap' in explanation && 'winnerScore' in explanation && 'candidateScoreNonWinnerMean' in explanation) {
      const expected = explanation.winnerScore - explanation.candidateScoreNonWinnerMean;
      assert.ok(
        Math.abs(explanation.candidateScoreWinnerFieldGap - expected) < 1e-9,
        `candidateScoreWinnerFieldGap (${explanation.candidateScoreWinnerFieldGap}) should equal winnerScore - candidateScoreNonWinnerMean (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('LLLLLLLL-8: tool description documents candidateScoreWinnerFieldGap', async () => {
  const path = dlqPath('l8');
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
      cast.description?.includes('candidateScoreWinnerFieldGap'),
      `cast description should mention candidateScoreWinnerFieldGap, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
