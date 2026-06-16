/**
 * 40404040: explanation.winnerThirdGapToSpreadRatio in ch1tty/cast when explain:true.
 *
 * winnerThirdGapToSpreadRatio: number — winner-to-3rd gap as fraction of full spread:
 * (winnerScore - thirdCandidateScore) / candidateScoreSpread.
 *
 * Present when: >= 3 candidates and candidateScoreSpread > 0.
 * Absent when: no_match, fewer than 3 candidates, or spread === 0.
 * Always in [0, 1]: winnerThirdGap <= spread.
 * Always >= winnerRunnerUpGapToSpreadRatio: winnerThirdGap >= winnerRunnerUpGap.
 * Additive: winnerThirdGapToSpreadRatio === winnerRunnerUpGapToSpreadRatio + runnerUpThirdGapToSpreadRatio.
 * For n=3: equals 1 (winnerThirdGap = spread when third === lowest).
 * Identity: winnerThirdGapToSpreadRatio * spread === winnerThirdGap.
 *
 * Covered:
 *   40404040-1: present when >= 3 candidates and spread > 0
 *   40404040-2: always in [0, 1] when present
 *   40404040-3: always >= winnerRunnerUpGapToSpreadRatio when both present
 *   40404040-4: for n=3 equals 1
 *   40404040-5: absent on cast:no_match
 *   40404040-6: absent when fewer than 3 candidates
 *   40404040-7: additive identity — equals winnerRunnerUpGapToSpreadRatio + runnerUpThirdGapToSpreadRatio
 *   40404040-8: tool description documents winnerThirdGapToSpreadRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-40404040-${label}-${Date.now()}.jsonl`);
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

test('40404040-1: present when >= 3 candidates and spread > 0', async () => {
  const agg = buildAgg('ooo1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3 && explanation.candidateScoreSpread > 0) {
      assert.ok('winnerThirdGapToSpreadRatio' in explanation,
        `winnerThirdGapToSpreadRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.winnerThirdGapToSpreadRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('40404040-2: always in [0, 1] when present', async () => {
  const agg = buildAgg('ooo2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerThirdGapToSpreadRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.winnerThirdGapToSpreadRatio),
        `should be finite, got ${explanation.winnerThirdGapToSpreadRatio}`,
      );
      assert.ok(
        explanation.winnerThirdGapToSpreadRatio >= 0,
        `should be >= 0, got ${explanation.winnerThirdGapToSpreadRatio}`,
      );
      assert.ok(
        explanation.winnerThirdGapToSpreadRatio <= 1,
        `should be <= 1, got ${explanation.winnerThirdGapToSpreadRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('40404040-3: always >= winnerRunnerUpGapToSpreadRatio when both present', async () => {
  const agg = buildAgg('ooo3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerThirdGapToSpreadRatio' in explanation && 'winnerRunnerUpGapToSpreadRatio' in explanation) {
      assert.ok(
        explanation.winnerThirdGapToSpreadRatio >= explanation.winnerRunnerUpGapToSpreadRatio - 1e-9,
        `winnerThirdGapToSpreadRatio (${explanation.winnerThirdGapToSpreadRatio}) should be >= winnerRunnerUpGapToSpreadRatio (${explanation.winnerRunnerUpGapToSpreadRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('40404040-4: for n=3 equals 1', async () => {
  const agg = buildAgg('ooo4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerThirdGapToSpreadRatio' in explanation && explanation.candidateCount === 3) {
      assert.ok(
        Math.abs(explanation.winnerThirdGapToSpreadRatio - 1) < 1e-9,
        `winnerThirdGapToSpreadRatio (${explanation.winnerThirdGapToSpreadRatio}) should equal 1 for n=3`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('40404040-5: absent on cast:no_match', async () => {
  const path = dlqPath('ooo5');
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
      !('winnerThirdGapToSpreadRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.winnerThirdGapToSpreadRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('40404040-6: absent when fewer than 3 candidates', async () => {
  const agg = buildAgg('ooo6', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount <= 2, `should have at most 2 candidates, got ${explanation.candidateCount}`);
    assert.ok(
      !('winnerThirdGapToSpreadRatio' in explanation),
      `should be absent with < 3 candidates, found: ${explanation.winnerThirdGapToSpreadRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('40404040-7: additive identity — equals winnerRunnerUpGapToSpreadRatio + runnerUpThirdGapToSpreadRatio', async () => {
  const agg = buildAgg('ooo7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerThirdGapToSpreadRatio' in explanation &&
        'winnerRunnerUpGapToSpreadRatio' in explanation &&
        'runnerUpThirdGapToSpreadRatio' in explanation) {
      const sum = explanation.winnerRunnerUpGapToSpreadRatio + explanation.runnerUpThirdGapToSpreadRatio;
      assert.ok(
        Math.abs(explanation.winnerThirdGapToSpreadRatio - sum) < 1e-9,
        `winnerThirdGapToSpreadRatio (${explanation.winnerThirdGapToSpreadRatio}) should equal winnerRunnerUpGapToSpreadRatio + runnerUpThirdGapToSpreadRatio (${sum})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('40404040-8: tool description documents winnerThirdGapToSpreadRatio', async () => {
  const path = dlqPath('ooo8');
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
      cast.description?.includes('winnerThirdGapToSpreadRatio'),
      `cast description should mention winnerThirdGapToSpreadRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
