/**
 * 28282828: explanation.runnerUpScoreToNonWinnerMeanRatio in ch1tty/cast when explain:true.
 *
 * runnerUpScoreToNonWinnerMeanRatio: number — ratio of runner-up score to non-winner field mean:
 * runnerUpScore / candidateScoreNonWinnerMean.
 *
 * Present when: >= 2 candidates and candidateScoreNonWinnerMean > 0 (runnerUpScore > 0).
 * Absent when: no_match, single candidate, or all non-winners scored 0.
 * Always >= 1: runner-up is max of non-winners, so runnerUp >= nonWinnerMean.
 * Always <= winnerScoreToNonWinnerMeanRatio: runnerUp <= winner, same denominator.
 * For n=2: always === 1 (non-winner set = {runnerUp}, mean = runnerUp).
 * Identity: runnerUpScoreToNonWinnerMeanRatio * candidateScoreNonWinnerMean === runnerUpScore.
 *
 * Covered:
 *   28282828-1: present when >= 2 candidates and runnerUpScore > 0
 *   28282828-2: always >= 1 when present
 *   28282828-3: always <= winnerScoreToNonWinnerMeanRatio when both present
 *   28282828-4: for n=2 equals 1
 *   28282828-5: absent on cast:no_match
 *   28282828-6: absent when only 1 candidate
 *   28282828-7: identity — runnerUpScoreToNonWinnerMeanRatio * candidateScoreNonWinnerMean === runnerUpScore
 *   28282828-8: tool description documents runnerUpScoreToNonWinnerMeanRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-28282828-${label}-${Date.now()}.jsonl`);
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

test('28282828-1: present when >= 2 candidates and runnerUpScore > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ccc1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreNonWinnerMean' in explanation && explanation.candidateScoreNonWinnerMean > 0) {
      assert.ok('runnerUpScoreToNonWinnerMeanRatio' in explanation,
        `runnerUpScoreToNonWinnerMeanRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.runnerUpScoreToNonWinnerMeanRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('28282828-2: always >= 1 when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ccc2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToNonWinnerMeanRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.runnerUpScoreToNonWinnerMeanRatio),
        `should be finite, got ${explanation.runnerUpScoreToNonWinnerMeanRatio}`,
      );
      assert.ok(
        explanation.runnerUpScoreToNonWinnerMeanRatio >= 1 - 1e-9,
        `should be >= 1, got ${explanation.runnerUpScoreToNonWinnerMeanRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('28282828-3: always <= winnerScoreToNonWinnerMeanRatio when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ccc3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToNonWinnerMeanRatio' in explanation && 'winnerScoreToNonWinnerMeanRatio' in explanation) {
      assert.ok(
        explanation.runnerUpScoreToNonWinnerMeanRatio <= explanation.winnerScoreToNonWinnerMeanRatio + 1e-9,
        `runnerUpScoreToNonWinnerMeanRatio (${explanation.runnerUpScoreToNonWinnerMeanRatio}) should be <= winnerScoreToNonWinnerMeanRatio (${explanation.winnerScoreToNonWinnerMeanRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('28282828-4: for n=2 equals 1', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ccc4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToNonWinnerMeanRatio' in explanation && explanation.candidateCount === 2) {
      assert.ok(
        Math.abs(explanation.runnerUpScoreToNonWinnerMeanRatio - 1) < 1e-9,
        `runnerUpScoreToNonWinnerMeanRatio (${explanation.runnerUpScoreToNonWinnerMeanRatio}) should equal 1 for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('28282828-5: absent on cast:no_match', async () => {
  const path = dlqPath('ccc5');
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
      !('runnerUpScoreToNonWinnerMeanRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.runnerUpScoreToNonWinnerMeanRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('28282828-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ccc6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('runnerUpScoreToNonWinnerMeanRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.runnerUpScoreToNonWinnerMeanRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('28282828-7: identity — runnerUpScoreToNonWinnerMeanRatio * candidateScoreNonWinnerMean === runnerUpScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ccc7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToNonWinnerMeanRatio' in explanation &&
        'candidateScoreNonWinnerMean' in explanation &&
        'runnerUpScore' in explanation) {
      const product = explanation.runnerUpScoreToNonWinnerMeanRatio * explanation.candidateScoreNonWinnerMean;
      assert.ok(
        Math.abs(product - explanation.runnerUpScore) < 1e-9,
        `runnerUpScoreToNonWinnerMeanRatio * candidateScoreNonWinnerMean (${product}) should equal runnerUpScore (${explanation.runnerUpScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('28282828-8: tool description documents runnerUpScoreToNonWinnerMeanRatio', async () => {
  const path = dlqPath('ccc8');
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
      cast.description?.includes('runnerUpScoreToNonWinnerMeanRatio'),
      `cast description should mention runnerUpScoreToNonWinnerMeanRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
