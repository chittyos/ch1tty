/**
 * 38383838: explanation.runnerUpThirdGapToSpreadRatio in ch1tty/cast when explain:true.
 *
 * runnerUpThirdGapToSpreadRatio: number — runner-up-to-3rd gap as fraction of full spread:
 * (runnerUpScore - thirdCandidateScore) / candidateScoreSpread.
 *
 * Present when: >= 3 candidates and candidateScoreSpread > 0.
 * Absent when: no_match, fewer than 3 candidates, or spread === 0.
 * Always in [0, 1]: runnerUpThirdGap <= spread.
 * For n=3: equals runnerUpLowestGapToSpreadRatio (third === lowest when n=3).
 * For n=3: winnerRunnerUpGapToSpreadRatio + runnerUpThirdGapToSpreadRatio === 1.
 * Identity: runnerUpThirdGapToSpreadRatio * spread === runnerUpThirdGap.
 *
 * Covered:
 *   38383838-1: present when >= 3 candidates and spread > 0
 *   38383838-2: always in [0, 1] when present
 *   38383838-3: for n=3 winnerRunnerUpGapToSpreadRatio + runnerUpThirdGapToSpreadRatio === 1
 *   38383838-4: for n=3 equals runnerUpLowestGapToSpreadRatio
 *   38383838-5: absent on cast:no_match
 *   38383838-6: absent when fewer than 3 candidates
 *   38383838-7: identity — runnerUpThirdGapToSpreadRatio * spread === runnerUpThirdGap
 *   38383838-8: tool description documents runnerUpThirdGapToSpreadRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-38383838-${label}-${Date.now()}.jsonl`);
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

test('38383838-1: present when >= 3 candidates and spread > 0', async () => {
  const agg = buildAgg('mmm1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3 && explanation.candidateScoreSpread > 0) {
      assert.ok('runnerUpThirdGapToSpreadRatio' in explanation,
        `runnerUpThirdGapToSpreadRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.runnerUpThirdGapToSpreadRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('38383838-2: always in [0, 1] when present', async () => {
  const agg = buildAgg('mmm2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpThirdGapToSpreadRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.runnerUpThirdGapToSpreadRatio),
        `should be finite, got ${explanation.runnerUpThirdGapToSpreadRatio}`,
      );
      assert.ok(
        explanation.runnerUpThirdGapToSpreadRatio >= 0,
        `should be >= 0, got ${explanation.runnerUpThirdGapToSpreadRatio}`,
      );
      assert.ok(
        explanation.runnerUpThirdGapToSpreadRatio <= 1,
        `should be <= 1, got ${explanation.runnerUpThirdGapToSpreadRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('38383838-3: for n=3 winnerRunnerUpGapToSpreadRatio + runnerUpThirdGapToSpreadRatio === 1', async () => {
  const agg = buildAgg('mmm3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpThirdGapToSpreadRatio' in explanation && explanation.candidateCount === 3 &&
        'winnerRunnerUpGapToSpreadRatio' in explanation) {
      const sum = explanation.winnerRunnerUpGapToSpreadRatio + explanation.runnerUpThirdGapToSpreadRatio;
      assert.ok(
        Math.abs(sum - 1) < 1e-9,
        `winnerRunnerUpGapToSpreadRatio + runnerUpThirdGapToSpreadRatio (${sum}) should equal 1 for n=3`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('38383838-4: for n=3 equals runnerUpLowestGapToSpreadRatio', async () => {
  const agg = buildAgg('mmm4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpThirdGapToSpreadRatio' in explanation && explanation.candidateCount === 3 &&
        'runnerUpLowestGapToSpreadRatio' in explanation) {
      assert.ok(
        Math.abs(explanation.runnerUpThirdGapToSpreadRatio - explanation.runnerUpLowestGapToSpreadRatio) < 1e-9,
        `runnerUpThirdGapToSpreadRatio (${explanation.runnerUpThirdGapToSpreadRatio}) should equal runnerUpLowestGapToSpreadRatio (${explanation.runnerUpLowestGapToSpreadRatio}) for n=3`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('38383838-5: absent on cast:no_match', async () => {
  const path = dlqPath('mmm5');
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
      !('runnerUpThirdGapToSpreadRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.runnerUpThirdGapToSpreadRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('38383838-6: absent when fewer than 3 candidates', async () => {
  const agg = buildAgg('mmm6', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount <= 2, `should have at most 2 candidates, got ${explanation.candidateCount}`);
    assert.ok(
      !('runnerUpThirdGapToSpreadRatio' in explanation),
      `should be absent with < 3 candidates, found: ${explanation.runnerUpThirdGapToSpreadRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('38383838-7: identity — runnerUpThirdGapToSpreadRatio * spread === runnerUpThirdGap', async () => {
  const agg = buildAgg('mmm7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpThirdGapToSpreadRatio' in explanation &&
        'candidateScoreSpread' in explanation && 'runnerUpThirdGap' in explanation) {
      const product = explanation.runnerUpThirdGapToSpreadRatio * explanation.candidateScoreSpread;
      assert.ok(
        Math.abs(product - explanation.runnerUpThirdGap) < 1e-9,
        `runnerUpThirdGapToSpreadRatio * spread (${product}) should equal runnerUpThirdGap (${explanation.runnerUpThirdGap})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('38383838-8: tool description documents runnerUpThirdGapToSpreadRatio', async () => {
  const path = dlqPath('mmm8');
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
      cast.description?.includes('runnerUpThirdGapToSpreadRatio'),
      `cast description should mention runnerUpThirdGapToSpreadRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
