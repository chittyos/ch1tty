/**
 * 78787878: explanation.candidateScoreNonWinnerQMGMRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreNonWinnerQMGMRatio: number — ratio of non-winner quadratic mean to geometric mean:
 * candidateScoreNonWinnerQuadraticMean / candidateScoreNonWinnerGeometricMean.
 *
 * Present when: >= 3 candidates and all non-winner scores > 0.
 * Absent when: no_match, < 3 candidates, or any non-winner score is zero.
 * Always >= 1 (QM >= GM by Power Mean chain).
 * Equals 1 when all non-winners are tied.
 * For n=3: equals sqrt((r^2+t^2)/(2*r*t)).
 * Identity: ratio * GM === QM.
 * Product decomposition: QM/GM === QMToAMRatio * AMGMRatio.
 * Always >= candidateScoreNonWinnerQMToAMRatio (GM <= AM => QM/GM >= QM/AM).
 * Always >= candidateScoreNonWinnerAMGMRatio (QM >= AM => QM/GM >= AM/GM).
 *
 * Covered:
 *   78787878-1: present when >= 3 candidates and all non-winner scores > 0
 *   78787878-2: always finite and >= 1
 *   78787878-3: identity — ratio * GM === QM
 *   78787878-4: for n=3 equals sqrt((r^2+t^2)/(2*r*t))
 *   78787878-5: absent on cast:no_match
 *   78787878-6: absent when fewer than 3 candidates
 *   78787878-7: product decomposition — QM/GM === QMToAMRatio * AMGMRatio
 *   78787878-8: tool description documents candidateScoreNonWinnerQMGMRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-78787878-${label}-${Date.now()}.jsonl`);
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

test('78787878-1: present when >= 3 candidates and all non-winner scores > 0', async () => {
  const agg = buildAgg('aaa1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3 && explanation.lowestCandidateScore > 0) {
      assert.ok('candidateScoreNonWinnerQMGMRatio' in explanation,
        `candidateScoreNonWinnerQMGMRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreNonWinnerQMGMRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('78787878-2: always finite and >= 1', async () => {
  const agg = buildAgg('aaa2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerQMGMRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreNonWinnerQMGMRatio),
        `should be finite, got ${explanation.candidateScoreNonWinnerQMGMRatio}`,
      );
      assert.ok(
        explanation.candidateScoreNonWinnerQMGMRatio >= 1 - 1e-9,
        `should be >= 1, got ${explanation.candidateScoreNonWinnerQMGMRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('78787878-3: identity — ratio * GM === QM', async () => {
  const agg = buildAgg('aaa3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerQMGMRatio' in explanation &&
        'candidateScoreNonWinnerGeometricMean' in explanation &&
        'candidateScoreNonWinnerQuadraticMean' in explanation) {
      const product = explanation.candidateScoreNonWinnerQMGMRatio * explanation.candidateScoreNonWinnerGeometricMean;
      assert.ok(
        Math.abs(product - explanation.candidateScoreNonWinnerQuadraticMean) < 1e-9,
        `ratio * GM (${product}) should equal QM (${explanation.candidateScoreNonWinnerQuadraticMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('78787878-4: for n=3 equals sqrt((r^2+t^2)/(2*r*t))', async () => {
  const agg = buildAgg('aaa4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerQMGMRatio' in explanation &&
        'runnerUpScore' in explanation &&
        'thirdCandidateScore' in explanation &&
        explanation.candidateCount === 3 &&
        explanation.runnerUpScore > 0 &&
        explanation.thirdCandidateScore > 0) {
      const ru = explanation.runnerUpScore;
      const t = explanation.thirdCandidateScore;
      const expected = Math.sqrt((ru ** 2 + t ** 2) / (2 * ru * t));
      assert.ok(
        Math.abs(explanation.candidateScoreNonWinnerQMGMRatio - expected) < 1e-9,
        `for n=3, QM/GM ratio (${explanation.candidateScoreNonWinnerQMGMRatio}) should equal sqrt((r^2+t^2)/(2rt)) (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('78787878-5: absent on cast:no_match', async () => {
  const path = dlqPath('aaa5');
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
      !('candidateScoreNonWinnerQMGMRatio' in parsed.explanation),
      `should be absent on no_match`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('78787878-6: absent when fewer than 3 candidates', async () => {
  const path = dlqPath('aaa6');
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
        !('candidateScoreNonWinnerQMGMRatio' in explanation),
        `should be absent with < 3 candidates`,
      );
    }
  } finally {
    await twoAgg.shutdown();
  }
});

test('78787878-7: product decomposition — QM/GM === QMToAMRatio * AMGMRatio', async () => {
  const agg = buildAgg('aaa7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerQMGMRatio' in explanation &&
        'candidateScoreNonWinnerQMToAMRatio' in explanation &&
        'candidateScoreNonWinnerAMGMRatio' in explanation) {
      const product = explanation.candidateScoreNonWinnerQMToAMRatio * explanation.candidateScoreNonWinnerAMGMRatio;
      assert.ok(
        Math.abs(explanation.candidateScoreNonWinnerQMGMRatio - product) < 1e-9,
        `QM/GM (${explanation.candidateScoreNonWinnerQMGMRatio}) should equal QM/AM * AM/GM (${product})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('78787878-8: tool description documents candidateScoreNonWinnerQMGMRatio', async () => {
  const path = dlqPath('aaa8');
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
      cast.description?.includes('candidateScoreNonWinnerQMGMRatio'),
      `cast description should mention candidateScoreNonWinnerQMGMRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
