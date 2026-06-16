/**
 * 66666666: explanation.lowestToNonWinnerMeanGap in ch1tty/cast when explain:true.
 *
 * lowestToNonWinnerMeanGap: number — gap between the non-winner mean and the lowest candidate score:
 * candidateScoreNonWinnerMean - lowestCandidateScore.
 *
 * Present when: >= 3 candidates.
 * Absent when: no_match or < 3 candidates.
 * Always >= 0 (non-winner mean >= lowest non-winner score).
 * Always <= candidateScoreNonWinnerSpread.
 * For n=3: equals candidateScoreNonWinnerSpread / 2.
 * Zero when all non-winners are tied.
 * Additive identity: runnerUpToNonWinnerMeanGap + lowestToNonWinnerMeanGap === candidateScoreNonWinnerSpread.
 * Identity: lowestToNonWinnerMeanGap === candidateScoreNonWinnerMean - lowestCandidateScore.
 *
 * Covered:
 *   66666666-1: present when >= 3 candidates
 *   66666666-2: always finite and >= 0
 *   66666666-3: identity — lowestToNonWinnerMeanGap === candidateScoreNonWinnerMean - lowestCandidateScore
 *   66666666-4: for n=3 equals candidateScoreNonWinnerSpread / 2
 *   66666666-5: absent on cast:no_match
 *   66666666-6: absent when fewer than 3 candidates
 *   66666666-7: additive identity with runnerUpToNonWinnerMeanGap === candidateScoreNonWinnerSpread
 *   66666666-8: tool description documents lowestToNonWinnerMeanGap
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-66666666-${label}-${Date.now()}.jsonl`);
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

test('66666666-1: present when >= 3 candidates', async () => {
  const agg = buildAgg('ooo1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3) {
      assert.ok('lowestToNonWinnerMeanGap' in explanation,
        `lowestToNonWinnerMeanGap should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.lowestToNonWinnerMeanGap, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('66666666-2: always finite and >= 0', async () => {
  const agg = buildAgg('ooo2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('lowestToNonWinnerMeanGap' in explanation) {
      assert.ok(
        Number.isFinite(explanation.lowestToNonWinnerMeanGap),
        `should be finite, got ${explanation.lowestToNonWinnerMeanGap}`,
      );
      assert.ok(
        explanation.lowestToNonWinnerMeanGap >= -1e-9,
        `should be >= 0, got ${explanation.lowestToNonWinnerMeanGap}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('66666666-3: identity — lowestToNonWinnerMeanGap === candidateScoreNonWinnerMean - lowestCandidateScore', async () => {
  const agg = buildAgg('ooo3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('lowestToNonWinnerMeanGap' in explanation &&
        'candidateScoreNonWinnerMean' in explanation &&
        'lowestCandidateScore' in explanation) {
      const expected = explanation.candidateScoreNonWinnerMean - explanation.lowestCandidateScore;
      assert.ok(
        Math.abs(explanation.lowestToNonWinnerMeanGap - expected) < 1e-9,
        `lowestToNonWinnerMeanGap (${explanation.lowestToNonWinnerMeanGap}) should equal nonWinnerMean - lowest (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('66666666-4: for n=3 equals candidateScoreNonWinnerSpread / 2', async () => {
  const agg = buildAgg('ooo4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('lowestToNonWinnerMeanGap' in explanation &&
        'candidateScoreNonWinnerSpread' in explanation &&
        explanation.candidateCount === 3) {
      const expected = explanation.candidateScoreNonWinnerSpread / 2;
      assert.ok(
        Math.abs(explanation.lowestToNonWinnerMeanGap - expected) < 1e-9,
        `for n=3, lowestToNonWinnerMeanGap (${explanation.lowestToNonWinnerMeanGap}) should equal nonWinnerSpread/2 (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('66666666-5: absent on cast:no_match', async () => {
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
      !('lowestToNonWinnerMeanGap' in parsed.explanation),
      `should be absent on no_match`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('66666666-6: absent when fewer than 3 candidates', async () => {
  const path = dlqPath('ooo6');
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
        !('lowestToNonWinnerMeanGap' in explanation),
        `should be absent with < 3 candidates`,
      );
    }
  } finally {
    await twoAgg.shutdown();
  }
});

test('66666666-7: runnerUpToNonWinnerMeanGap + lowestToNonWinnerMeanGap === candidateScoreNonWinnerSpread', async () => {
  const agg = buildAgg('ooo7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('lowestToNonWinnerMeanGap' in explanation &&
        'runnerUpToNonWinnerMeanGap' in explanation &&
        'candidateScoreNonWinnerSpread' in explanation) {
      const sum = explanation.runnerUpToNonWinnerMeanGap + explanation.lowestToNonWinnerMeanGap;
      assert.ok(
        Math.abs(sum - explanation.candidateScoreNonWinnerSpread) < 1e-9,
        `runnerUpToNonWinnerMeanGap + lowestToNonWinnerMeanGap (${sum}) should equal candidateScoreNonWinnerSpread (${explanation.candidateScoreNonWinnerSpread})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('66666666-8: tool description documents lowestToNonWinnerMeanGap', async () => {
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
      cast.description?.includes('lowestToNonWinnerMeanGap'),
      `cast description should mention lowestToNonWinnerMeanGap, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
