/**
 * 70707070: explanation.candidateScoreNonWinnerGMHMGap in ch1tty/cast when explain:true.
 *
 * candidateScoreNonWinnerGMHMGap: number — gap between non-winner geometric and harmonic means:
 * candidateScoreNonWinnerGeometricMean - candidateScoreNonWinnerHarmonicMean.
 *
 * Present when: >= 3 candidates and all non-winner scores > 0.
 * Absent when: no_match, < 3 candidates, or any non-winner score is zero.
 * Always >= 0 (GM >= HM).
 * Always <= candidateScoreNonWinnerAMHMGap.
 * Zero when all non-winners are tied.
 * Additive identity: AMHMGap === AMGMGap + GMHMGap.
 * For n=3: equals sqrt(runnerUp*third) - 2*runnerUp*third/(runnerUp+third).
 * Identity: candidateScoreNonWinnerGMHMGap === nonWinnerGeometricMean - nonWinnerHarmonicMean.
 *
 * Covered:
 *   70707070-1: present when >= 3 candidates and all non-winner scores > 0
 *   70707070-2: always finite and >= 0
 *   70707070-3: identity — equals nonWinnerGeometricMean - nonWinnerHarmonicMean
 *   70707070-4: for n=3 equals sqrt(r*t) - 2*r*t/(r+t)
 *   70707070-5: absent on cast:no_match
 *   70707070-6: absent when fewer than 3 candidates
 *   70707070-7: additive identity AMHMGap === AMGMGap + GMHMGap
 *   70707070-8: tool description documents candidateScoreNonWinnerGMHMGap
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-70707070-${label}-${Date.now()}.jsonl`);
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

test('70707070-1: present when >= 3 candidates and all non-winner scores > 0', async () => {
  const agg = buildAgg('sss1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3 && explanation.lowestCandidateScore > 0) {
      assert.ok('candidateScoreNonWinnerGMHMGap' in explanation,
        `candidateScoreNonWinnerGMHMGap should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreNonWinnerGMHMGap, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('70707070-2: always finite and >= 0', async () => {
  const agg = buildAgg('sss2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerGMHMGap' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreNonWinnerGMHMGap),
        `should be finite, got ${explanation.candidateScoreNonWinnerGMHMGap}`,
      );
      assert.ok(
        explanation.candidateScoreNonWinnerGMHMGap >= -1e-9,
        `should be >= 0, got ${explanation.candidateScoreNonWinnerGMHMGap}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('70707070-3: identity — equals nonWinnerGeometricMean - nonWinnerHarmonicMean', async () => {
  const agg = buildAgg('sss3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerGMHMGap' in explanation &&
        'candidateScoreNonWinnerGeometricMean' in explanation &&
        'candidateScoreNonWinnerHarmonicMean' in explanation) {
      const expected = explanation.candidateScoreNonWinnerGeometricMean - explanation.candidateScoreNonWinnerHarmonicMean;
      assert.ok(
        Math.abs(explanation.candidateScoreNonWinnerGMHMGap - expected) < 1e-9,
        `candidateScoreNonWinnerGMHMGap (${explanation.candidateScoreNonWinnerGMHMGap}) should equal GM - HM (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('70707070-4: for n=3 equals sqrt(r*t) - 2*r*t/(r+t)', async () => {
  const agg = buildAgg('sss4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerGMHMGap' in explanation &&
        'runnerUpScore' in explanation &&
        'thirdCandidateScore' in explanation &&
        explanation.candidateCount === 3 &&
        explanation.runnerUpScore > 0 &&
        explanation.thirdCandidateScore > 0) {
      const ru = explanation.runnerUpScore;
      const t = explanation.thirdCandidateScore;
      const expected = Math.sqrt(ru * t) - 2 * ru * t / (ru + t);
      assert.ok(
        Math.abs(explanation.candidateScoreNonWinnerGMHMGap - expected) < 1e-9,
        `for n=3, candidateScoreNonWinnerGMHMGap (${explanation.candidateScoreNonWinnerGMHMGap}) should equal sqrt(r*t)-2rt/(r+t) (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('70707070-5: absent on cast:no_match', async () => {
  const path = dlqPath('sss5');
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
      !('candidateScoreNonWinnerGMHMGap' in parsed.explanation),
      `should be absent on no_match`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('70707070-6: absent when fewer than 3 candidates', async () => {
  const path = dlqPath('sss6');
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
        !('candidateScoreNonWinnerGMHMGap' in explanation),
        `should be absent with < 3 candidates`,
      );
    }
  } finally {
    await twoAgg.shutdown();
  }
});

test('70707070-7: additive identity AMHMGap === AMGMGap + GMHMGap', async () => {
  const agg = buildAgg('sss7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerGMHMGap' in explanation &&
        'candidateScoreNonWinnerAMGMGap' in explanation &&
        'candidateScoreNonWinnerAMHMGap' in explanation) {
      const sum = explanation.candidateScoreNonWinnerAMGMGap + explanation.candidateScoreNonWinnerGMHMGap;
      assert.ok(
        Math.abs(sum - explanation.candidateScoreNonWinnerAMHMGap) < 1e-9,
        `AMGMGap + GMHMGap (${sum}) should equal AMHMGap (${explanation.candidateScoreNonWinnerAMHMGap})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('70707070-8: tool description documents candidateScoreNonWinnerGMHMGap', async () => {
  const path = dlqPath('sss8');
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
      cast.description?.includes('candidateScoreNonWinnerGMHMGap'),
      `cast description should mention candidateScoreNonWinnerGMHMGap, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
