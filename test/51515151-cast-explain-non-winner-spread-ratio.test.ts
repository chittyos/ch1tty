/**
 * 51515151: explanation.candidateScoreNonWinnerSpreadRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreNonWinnerSpreadRatio: number — non-winner span as fraction of full spread:
 * candidateScoreNonWinnerSpread / candidateScoreSpread.
 *
 * Present when: >= 3 candidates and candidateScoreSpread > 0.
 * Absent when: no_match, < 3 candidates, or spread === 0.
 * Always in [0, 1].
 * Complementary: candidateScoreNonWinnerSpreadRatio + winnerRunnerUpGapToSpreadRatio === 1.
 * For n=3: equals runnerUpThirdGapToSpreadRatio.
 * Identity: candidateScoreNonWinnerSpreadRatio * candidateScoreSpread === candidateScoreNonWinnerSpread.
 *
 * Covered:
 *   51515151-1: present when >= 3 candidates and spread > 0
 *   51515151-2: always finite and in [0, 1]
 *   51515151-3: complementary — nonWinnerSpreadRatio + winnerRunnerUpGapToSpreadRatio === 1
 *   51515151-4: for n=3 equals runnerUpThirdGapToSpreadRatio
 *   51515151-5: absent on cast:no_match
 *   51515151-6: absent when fewer than 3 candidates
 *   51515151-7: identity — nonWinnerSpreadRatio * spread === nonWinnerSpread
 *   51515151-8: tool description documents candidateScoreNonWinnerSpreadRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-51515151-${label}-${Date.now()}.jsonl`);
}

const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe Payments', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.test/mcp',
};
const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.test/mcp',
};
const LINEAR_CFG: ServerConfig = {
  id: 'linear', name: 'Linear', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://linear.test/mcp',
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

const stripeTools: ToolEntry[] = [
  { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
];
const neonTools: ToolEntry[] = [
  { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
];
const linearTools: ToolEntry[] = [
  { name: 'create_issue', description: 'billing issue tracking project', inputSchema: { type: 'object', properties: {} } },
];

test('51515151-1: present when >= 3 candidates and spread > 0', async () => {
  const agg = buildAgg('zzz1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3 && explanation.candidateScoreSpread > 0) {
      assert.ok('candidateScoreNonWinnerSpreadRatio' in explanation,
        `candidateScoreNonWinnerSpreadRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreNonWinnerSpreadRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('51515151-2: always finite and in [0, 1]', async () => {
  const agg = buildAgg('zzz2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerSpreadRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreNonWinnerSpreadRatio),
        `should be finite, got ${explanation.candidateScoreNonWinnerSpreadRatio}`,
      );
      assert.ok(
        explanation.candidateScoreNonWinnerSpreadRatio >= -1e-9,
        `should be >= 0, got ${explanation.candidateScoreNonWinnerSpreadRatio}`,
      );
      assert.ok(
        explanation.candidateScoreNonWinnerSpreadRatio <= 1 + 1e-9,
        `should be <= 1, got ${explanation.candidateScoreNonWinnerSpreadRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('51515151-3: complementary — nonWinnerSpreadRatio + winnerRunnerUpGapToSpreadRatio === 1', async () => {
  const agg = buildAgg('zzz3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerSpreadRatio' in explanation &&
        'winnerRunnerUpGapToSpreadRatio' in explanation) {
      const sum = explanation.candidateScoreNonWinnerSpreadRatio + explanation.winnerRunnerUpGapToSpreadRatio;
      assert.ok(
        Math.abs(sum - 1) < 1e-9,
        `nonWinnerSpreadRatio (${explanation.candidateScoreNonWinnerSpreadRatio}) + winnerRunnerUpGapToSpreadRatio (${explanation.winnerRunnerUpGapToSpreadRatio}) = ${sum}, should equal 1`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('51515151-4: for n=3 equals runnerUpThirdGapToSpreadRatio', async () => {
  const agg = buildAgg('zzz4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerSpreadRatio' in explanation &&
        'runnerUpThirdGapToSpreadRatio' in explanation &&
        explanation.candidateCount === 3) {
      assert.ok(
        Math.abs(explanation.candidateScoreNonWinnerSpreadRatio - explanation.runnerUpThirdGapToSpreadRatio) < 1e-9,
        `for n=3, candidateScoreNonWinnerSpreadRatio (${explanation.candidateScoreNonWinnerSpreadRatio}) should equal runnerUpThirdGapToSpreadRatio (${explanation.runnerUpThirdGapToSpreadRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('51515151-5: absent on cast:no_match', async () => {
  const path = dlqPath('zzz5');
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
      !('candidateScoreNonWinnerSpreadRatio' in parsed.explanation),
      `should be absent on no_match`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('51515151-6: absent when fewer than 3 candidates', async () => {
  const path = dlqPath('zzz6');
  const twoAgg = new Aggregator([STRIPE_CFG, NEON_CFG], {
    backendFactory: (cfg) => makeBackend(cfg.id === 'stripe' ? stripeTools : neonTools),
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
  });
  try {
    const r = await twoAgg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if (explanation.candidateCount < 3) {
      assert.ok(
        !('candidateScoreNonWinnerSpreadRatio' in explanation),
        `should be absent with < 3 candidates`,
      );
    }
  } finally {
    await twoAgg.shutdown();
  }
});

test('51515151-7: identity — nonWinnerSpreadRatio * spread === nonWinnerSpread', async () => {
  const agg = buildAgg('zzz7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerSpreadRatio' in explanation &&
        'candidateScoreSpread' in explanation &&
        'candidateScoreNonWinnerSpread' in explanation) {
      const product = explanation.candidateScoreNonWinnerSpreadRatio * explanation.candidateScoreSpread;
      assert.ok(
        Math.abs(product - explanation.candidateScoreNonWinnerSpread) < 1e-9,
        `nonWinnerSpreadRatio * spread (${product}) should equal candidateScoreNonWinnerSpread (${explanation.candidateScoreNonWinnerSpread})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('51515151-8: tool description documents candidateScoreNonWinnerSpreadRatio', async () => {
  const path = dlqPath('zzz8');
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
      cast.description?.includes('candidateScoreNonWinnerSpreadRatio'),
      `cast description should mention candidateScoreNonWinnerSpreadRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
