/**
 * 27272727: explanation.winnerScoreToNonWinnerMeanRatio in ch1tty/cast when explain:true.
 *
 * winnerScoreToNonWinnerMeanRatio: number — ratio of winner score to non-winner field mean:
 * winnerScore / candidateScoreNonWinnerMean.
 *
 * Present when: >= 2 candidates and candidateScoreNonWinnerMean > 0 (runnerUpScore > 0).
 * Absent when: no_match, single candidate, all non-winners scored 0.
 * Always >= 1: winner >= mean of any subset (non-winner mean); equality when all scores identical.
 * Exact inverse of candidateScoreFieldStrengthRatio when both present: product === 1.
 * For n=2: winnerScoreToNonWinnerMeanRatio === winnerScoreRatio (winner/runnerUp).
 * Identity: winnerScoreToNonWinnerMeanRatio * candidateScoreNonWinnerMean === winnerScore.
 *
 * Covered:
 *   27272727-1: present when >= 2 candidates and runnerUpScore > 0
 *   27272727-2: always >= 1 when present
 *   27272727-3: inverse of candidateScoreFieldStrengthRatio — product === 1 when both present
 *   27272727-4: for n=2 equals winnerScoreRatio
 *   27272727-5: absent on cast:no_match
 *   27272727-6: absent when only 1 candidate
 *   27272727-7: identity — winnerScoreToNonWinnerMeanRatio * candidateScoreNonWinnerMean === winnerScore
 *   27272727-8: tool description documents winnerScoreToNonWinnerMeanRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-27272727-${label}-${Date.now()}.jsonl`);
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

test('27272727-1: present when >= 2 candidates and runnerUpScore > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('bbb1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreNonWinnerMean' in explanation && explanation.candidateScoreNonWinnerMean > 0) {
      assert.ok('winnerScoreToNonWinnerMeanRatio' in explanation,
        `winnerScoreToNonWinnerMeanRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.winnerScoreToNonWinnerMeanRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('27272727-2: always >= 1 when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('bbb2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToNonWinnerMeanRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.winnerScoreToNonWinnerMeanRatio),
        `should be finite, got ${explanation.winnerScoreToNonWinnerMeanRatio}`,
      );
      assert.ok(
        explanation.winnerScoreToNonWinnerMeanRatio >= 1 - 1e-9,
        `should be >= 1, got ${explanation.winnerScoreToNonWinnerMeanRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('27272727-3: inverse of candidateScoreFieldStrengthRatio — product === 1 when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('bbb3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToNonWinnerMeanRatio' in explanation && 'candidateScoreFieldStrengthRatio' in explanation) {
      const product = explanation.winnerScoreToNonWinnerMeanRatio * explanation.candidateScoreFieldStrengthRatio;
      assert.ok(
        Math.abs(product - 1) < 1e-9,
        `winnerScoreToNonWinnerMeanRatio * candidateScoreFieldStrengthRatio (${product}) should equal 1`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('27272727-4: for n=2 equals winnerScoreRatio', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('bbb4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToNonWinnerMeanRatio' in explanation && explanation.candidateCount === 2 &&
        'winnerScoreRatio' in explanation) {
      assert.ok(
        Math.abs(explanation.winnerScoreToNonWinnerMeanRatio - explanation.winnerScoreRatio) < 1e-9,
        `winnerScoreToNonWinnerMeanRatio (${explanation.winnerScoreToNonWinnerMeanRatio}) should equal winnerScoreRatio (${explanation.winnerScoreRatio}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('27272727-5: absent on cast:no_match', async () => {
  const path = dlqPath('bbb5');
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
      !('winnerScoreToNonWinnerMeanRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.winnerScoreToNonWinnerMeanRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('27272727-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('bbb6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('winnerScoreToNonWinnerMeanRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.winnerScoreToNonWinnerMeanRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('27272727-7: identity — winnerScoreToNonWinnerMeanRatio * candidateScoreNonWinnerMean === winnerScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('bbb7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToNonWinnerMeanRatio' in explanation &&
        'candidateScoreNonWinnerMean' in explanation &&
        'winnerScore' in explanation) {
      const product = explanation.winnerScoreToNonWinnerMeanRatio * explanation.candidateScoreNonWinnerMean;
      assert.ok(
        Math.abs(product - explanation.winnerScore) < 1e-9,
        `winnerScoreToNonWinnerMeanRatio * candidateScoreNonWinnerMean (${product}) should equal winnerScore (${explanation.winnerScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('27272727-8: tool description documents winnerScoreToNonWinnerMeanRatio', async () => {
  const path = dlqPath('bbb8');
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
      cast.description?.includes('winnerScoreToNonWinnerMeanRatio'),
      `cast description should mention winnerScoreToNonWinnerMeanRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
