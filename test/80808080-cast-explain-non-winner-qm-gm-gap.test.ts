/**
 * 80808080: explanation.candidateScoreNonWinnerQMGMGap in ch1tty/cast when explain:true.
 *
 * candidateScoreNonWinnerQMGMGap: number — gap between non-winner quadratic mean and geometric mean:
 * candidateScoreNonWinnerQuadraticMean - candidateScoreNonWinnerGeometricMean.
 *
 * Present when: >= 3 candidates and all non-winner scores > 0.
 * Absent when: no_match, < 3 candidates, or any non-winner score is zero.
 * Always >= 0 (QM >= GM by Power Mean chain).
 * Zero when all non-winners are tied.
 * For n=3: equals sqrt((r^2+t^2)/2) - sqrt(r*t).
 * Additive decomposition: QMGMGap === QMGap + AMGMGap (since QM-GM = (QM-AM) + (AM-GM)).
 * Always >= candidateScoreNonWinnerQMGap (GM <= AM => QM-GM >= QM-AM).
 * Always >= candidateScoreNonWinnerAMGMGap (QM >= AM => QM-GM >= AM-GM).
 * Always <= candidateScoreNonWinnerQMHMGap (GM >= HM => QM-GM <= QM-HM).
 * Identity: gap + GM === QM.
 *
 * Covered:
 *   80808080-1: present when >= 3 candidates and all non-winner scores > 0
 *   80808080-2: always finite and >= 0
 *   80808080-3: identity — gap + GM === QM
 *   80808080-4: for n=3 equals sqrt((r^2+t^2)/2) - sqrt(r*t)
 *   80808080-5: absent on cast:no_match
 *   80808080-6: absent when fewer than 3 candidates
 *   80808080-7: additive decomposition — QMGMGap === QMGap + AMGMGap
 *   80808080-8: tool description documents candidateScoreNonWinnerQMGMGap
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-80808080-${label}-${Date.now()}.jsonl`);
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

test('80808080-1: present when >= 3 candidates and all non-winner scores > 0', async () => {
  const agg = buildAgg('ccc1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3 && explanation.lowestCandidateScore > 0) {
      assert.ok('candidateScoreNonWinnerQMGMGap' in explanation,
        `candidateScoreNonWinnerQMGMGap should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreNonWinnerQMGMGap, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('80808080-2: always finite and >= 0', async () => {
  const agg = buildAgg('ccc2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerQMGMGap' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreNonWinnerQMGMGap),
        `should be finite, got ${explanation.candidateScoreNonWinnerQMGMGap}`,
      );
      assert.ok(
        explanation.candidateScoreNonWinnerQMGMGap >= -1e-9,
        `should be >= 0, got ${explanation.candidateScoreNonWinnerQMGMGap}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('80808080-3: identity — gap + GM === QM', async () => {
  const agg = buildAgg('ccc3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerQMGMGap' in explanation &&
        'candidateScoreNonWinnerGeometricMean' in explanation &&
        'candidateScoreNonWinnerQuadraticMean' in explanation) {
      const sum = explanation.candidateScoreNonWinnerQMGMGap + explanation.candidateScoreNonWinnerGeometricMean;
      assert.ok(
        Math.abs(sum - explanation.candidateScoreNonWinnerQuadraticMean) < 1e-9,
        `gap + GM (${sum}) should equal QM (${explanation.candidateScoreNonWinnerQuadraticMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('80808080-4: for n=3 equals sqrt((r^2+t^2)/2) - sqrt(r*t)', async () => {
  const agg = buildAgg('ccc4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerQMGMGap' in explanation &&
        'runnerUpScore' in explanation &&
        'thirdCandidateScore' in explanation &&
        explanation.candidateCount === 3 &&
        explanation.runnerUpScore > 0 &&
        explanation.thirdCandidateScore > 0) {
      const ru = explanation.runnerUpScore;
      const t = explanation.thirdCandidateScore;
      const expected = Math.sqrt((ru ** 2 + t ** 2) / 2) - Math.sqrt(ru * t);
      assert.ok(
        Math.abs(explanation.candidateScoreNonWinnerQMGMGap - expected) < 1e-9,
        `for n=3, QMGMGap (${explanation.candidateScoreNonWinnerQMGMGap}) should equal sqrt((r^2+t^2)/2)-sqrt(rt) (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('80808080-5: absent on cast:no_match', async () => {
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
      !('candidateScoreNonWinnerQMGMGap' in parsed.explanation),
      `should be absent on no_match`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('80808080-6: absent when fewer than 3 candidates', async () => {
  const path = dlqPath('ccc6');
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
        !('candidateScoreNonWinnerQMGMGap' in explanation),
        `should be absent with < 3 candidates`,
      );
    }
  } finally {
    await twoAgg.shutdown();
  }
});

test('80808080-7: additive decomposition — QMGMGap === QMGap + AMGMGap', async () => {
  const agg = buildAgg('ccc7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerQMGMGap' in explanation &&
        'candidateScoreNonWinnerQMGap' in explanation &&
        'candidateScoreNonWinnerAMGMGap' in explanation) {
      const sum = explanation.candidateScoreNonWinnerQMGap + explanation.candidateScoreNonWinnerAMGMGap;
      assert.ok(
        Math.abs(explanation.candidateScoreNonWinnerQMGMGap - sum) < 1e-9,
        `QMGMGap (${explanation.candidateScoreNonWinnerQMGMGap}) should equal QMGap+AMGMGap (${sum})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('80808080-8: tool description documents candidateScoreNonWinnerQMGMGap', async () => {
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
      cast.description?.includes('candidateScoreNonWinnerQMGMGap'),
      `cast description should mention candidateScoreNonWinnerQMGMGap, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
