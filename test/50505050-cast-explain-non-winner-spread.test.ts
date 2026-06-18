/**
 * 50505050: explanation.candidateScoreNonWinnerSpread in ch1tty/cast when explain:true.
 *
 * candidateScoreNonWinnerSpread: number — score span within the non-winner pool:
 * runnerUpScore - lowestCandidateScore.
 *
 * Present when: >= 3 candidates.
 * Absent when: no_match, < 3 candidates.
 * Always >= 0.
 * Always <= candidateScoreSpread.
 * Additive: candidateScoreNonWinnerSpread + winnerRunnerUpGap === candidateScoreSpread.
 * For n=3: equals runnerUpThirdGap.
 *
 * Covered:
 *   50505050-1: present when >= 3 candidates
 *   50505050-2: always finite and >= 0 when present
 *   50505050-3: additive identity — nonWinnerSpread + winnerRunnerUpGap === candidateScoreSpread
 *   50505050-4: for n=3 equals runnerUpThirdGap
 *   50505050-5: absent on cast:no_match
 *   50505050-6: absent when fewer than 3 candidates
 *   50505050-7: always <= candidateScoreSpread
 *   50505050-8: tool description documents candidateScoreNonWinnerSpread
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-50505050-${label}-${Date.now()}.jsonl`);
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

test('50505050-1: present when >= 3 candidates', async () => {
  const agg = buildAgg('yyy1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3) {
      assert.ok('candidateScoreNonWinnerSpread' in explanation,
        `candidateScoreNonWinnerSpread should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreNonWinnerSpread, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('50505050-2: always finite and >= 0 when present', async () => {
  const agg = buildAgg('yyy2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerSpread' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreNonWinnerSpread),
        `should be finite, got ${explanation.candidateScoreNonWinnerSpread}`,
      );
      assert.ok(
        explanation.candidateScoreNonWinnerSpread >= -1e-9,
        `should be >= 0, got ${explanation.candidateScoreNonWinnerSpread}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('50505050-3: additive identity — nonWinnerSpread + winnerRunnerUpGap === candidateScoreSpread', async () => {
  const agg = buildAgg('yyy3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerSpread' in explanation &&
        'winnerRunnerUpGap' in explanation &&
        'candidateScoreSpread' in explanation) {
      const sum = explanation.candidateScoreNonWinnerSpread + explanation.winnerRunnerUpGap;
      assert.ok(
        Math.abs(sum - explanation.candidateScoreSpread) < 1e-9,
        `nonWinnerSpread (${explanation.candidateScoreNonWinnerSpread}) + winnerRunnerUpGap (${explanation.winnerRunnerUpGap}) = ${sum}, should equal candidateScoreSpread (${explanation.candidateScoreSpread})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('50505050-4: for n=3 equals runnerUpThirdGap', async () => {
  const agg = buildAgg('yyy4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerSpread' in explanation &&
        'runnerUpThirdGap' in explanation &&
        explanation.candidateCount === 3) {
      assert.ok(
        Math.abs(explanation.candidateScoreNonWinnerSpread - explanation.runnerUpThirdGap) < 1e-9,
        `for n=3, candidateScoreNonWinnerSpread (${explanation.candidateScoreNonWinnerSpread}) should equal runnerUpThirdGap (${explanation.runnerUpThirdGap})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('50505050-5: absent on cast:no_match', async () => {
  const path = dlqPath('yyy5');
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
      !('candidateScoreNonWinnerSpread' in parsed.explanation),
      `should be absent on no_match`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('50505050-6: absent when fewer than 3 candidates', async () => {
  const path = dlqPath('yyy6');
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
        !('candidateScoreNonWinnerSpread' in explanation),
        `should be absent with < 3 candidates, found: ${explanation.candidateScoreNonWinnerSpread}`,
      );
    }
  } finally {
    await twoAgg.shutdown();
  }
});

test('50505050-7: always <= candidateScoreSpread', async () => {
  const agg = buildAgg('yyy7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerSpread' in explanation && 'candidateScoreSpread' in explanation) {
      assert.ok(
        explanation.candidateScoreNonWinnerSpread <= explanation.candidateScoreSpread + 1e-9,
        `candidateScoreNonWinnerSpread (${explanation.candidateScoreNonWinnerSpread}) should be <= candidateScoreSpread (${explanation.candidateScoreSpread})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('50505050-8: tool description documents candidateScoreNonWinnerSpread', async () => {
  const path = dlqPath('yyy8');
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
      cast.description?.includes('candidateScoreNonWinnerSpread'),
      `cast description should mention candidateScoreNonWinnerSpread, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
