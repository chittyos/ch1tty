/**
 * 72727272: explanation.candidateScoreNonWinnerAMGMRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreNonWinnerAMGMRatio: number — ratio of non-winner arithmetic mean to geometric mean:
 * candidateScoreNonWinnerMean / candidateScoreNonWinnerGeometricMean.
 *
 * Present when: >= 3 candidates and all non-winner scores > 0.
 * Absent when: no_match, < 3 candidates, or any non-winner score is zero.
 * Always >= 1 (AM >= GM by AM-GM inequality).
 * Equals 1 when all non-winners are tied.
 * For n=3: equals (runnerUp + third) / (2 * sqrt(runnerUp * third)).
 * Identity: ratio * candidateScoreNonWinnerGeometricMean === candidateScoreNonWinnerMean.
 * For n=3: equals candidateScoreNonWinnerGMHMRatio (special property of 2 numbers: AM/GM = GM/HM).
 * Always <= candidateScoreNonWinnerAMHMRatio (GM >= HM, so AM/GM <= AM/HM).
 *
 * Covered:
 *   72727272-1: present when >= 3 candidates and all non-winner scores > 0
 *   72727272-2: always finite and >= 1
 *   72727272-3: identity — ratio * GM === AM
 *   72727272-4: for n=3 equals (r+t) / (2*sqrt(r*t))
 *   72727272-5: absent on cast:no_match
 *   72727272-6: absent when fewer than 3 candidates
 *   72727272-7: for n=3 equals candidateScoreNonWinnerGMHMRatio
 *   72727272-8: tool description documents candidateScoreNonWinnerAMGMRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-72727272-${label}-${Date.now()}.jsonl`);
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

test('72727272-1: present when >= 3 candidates and all non-winner scores > 0', async () => {
  const agg = buildAgg('uuu1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3 && explanation.lowestCandidateScore > 0) {
      assert.ok('candidateScoreNonWinnerAMGMRatio' in explanation,
        `candidateScoreNonWinnerAMGMRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreNonWinnerAMGMRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('72727272-2: always finite and >= 1', async () => {
  const agg = buildAgg('uuu2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerAMGMRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreNonWinnerAMGMRatio),
        `should be finite, got ${explanation.candidateScoreNonWinnerAMGMRatio}`,
      );
      assert.ok(
        explanation.candidateScoreNonWinnerAMGMRatio >= 1 - 1e-9,
        `should be >= 1, got ${explanation.candidateScoreNonWinnerAMGMRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('72727272-3: identity — ratio * GM === AM', async () => {
  const agg = buildAgg('uuu3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerAMGMRatio' in explanation &&
        'candidateScoreNonWinnerGeometricMean' in explanation &&
        'candidateScoreNonWinnerMean' in explanation) {
      const product = explanation.candidateScoreNonWinnerAMGMRatio * explanation.candidateScoreNonWinnerGeometricMean;
      assert.ok(
        Math.abs(product - explanation.candidateScoreNonWinnerMean) < 1e-9,
        `ratio * GM (${product}) should equal AM (${explanation.candidateScoreNonWinnerMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('72727272-4: for n=3 equals (r+t) / (2*sqrt(r*t))', async () => {
  const agg = buildAgg('uuu4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerAMGMRatio' in explanation &&
        'runnerUpScore' in explanation &&
        'thirdCandidateScore' in explanation &&
        explanation.candidateCount === 3 &&
        explanation.runnerUpScore > 0 &&
        explanation.thirdCandidateScore > 0) {
      const ru = explanation.runnerUpScore;
      const t = explanation.thirdCandidateScore;
      const expected = (ru + t) / (2 * Math.sqrt(ru * t));
      assert.ok(
        Math.abs(explanation.candidateScoreNonWinnerAMGMRatio - expected) < 1e-9,
        `for n=3, candidateScoreNonWinnerAMGMRatio (${explanation.candidateScoreNonWinnerAMGMRatio}) should equal (r+t)/(2*sqrt(r*t)) (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('72727272-5: absent on cast:no_match', async () => {
  const path = dlqPath('uuu5');
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
      !('candidateScoreNonWinnerAMGMRatio' in parsed.explanation),
      `should be absent on no_match`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('72727272-6: absent when fewer than 3 candidates', async () => {
  const path = dlqPath('uuu6');
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
        !('candidateScoreNonWinnerAMGMRatio' in explanation),
        `should be absent with < 3 candidates`,
      );
    }
  } finally {
    await twoAgg.shutdown();
  }
});

test('72727272-7: for n=3 equals candidateScoreNonWinnerGMHMRatio (AM/GM = GM/HM for 2 numbers)', async () => {
  const agg = buildAgg('uuu7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerAMGMRatio' in explanation &&
        'candidateScoreNonWinnerGMHMRatio' in explanation &&
        explanation.candidateCount === 3) {
      assert.ok(
        Math.abs(explanation.candidateScoreNonWinnerAMGMRatio - explanation.candidateScoreNonWinnerGMHMRatio) < 1e-9,
        `for n=3, AM/GM ratio (${explanation.candidateScoreNonWinnerAMGMRatio}) should equal GM/HM ratio (${explanation.candidateScoreNonWinnerGMHMRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('72727272-8: tool description documents candidateScoreNonWinnerAMGMRatio', async () => {
  const path = dlqPath('uuu8');
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
      cast.description?.includes('candidateScoreNonWinnerAMGMRatio'),
      `cast description should mention candidateScoreNonWinnerAMGMRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
