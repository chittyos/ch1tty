/**
 * 77777777: explanation.candidateScoreNonWinnerQMHMRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreNonWinnerQMHMRatio: number — ratio of non-winner quadratic mean to harmonic mean:
 * candidateScoreNonWinnerQuadraticMean / candidateScoreNonWinnerHarmonicMean.
 *
 * Present when: >= 3 candidates and all non-winner scores > 0.
 * Absent when: no_match, < 3 candidates, or any non-winner score is zero.
 * Always >= 1 (QM >= HM by full Power Mean chain).
 * Equals 1 when all non-winners are tied.
 * For n=3: equals sqrt((r^2+t^2)/2) * (r+t) / (2*r*t).
 * Identity: ratio * HM === QM.
 * Product decomposition: QM/HM === (QM/AM) * (AM/HM) === QMToAMRatio * AMHMRatio.
 * Always >= candidateScoreNonWinnerAMHMRatio (QM >= AM => QM/HM >= AM/HM).
 *
 * Covered:
 *   77777777-1: present when >= 3 candidates and all non-winner scores > 0
 *   77777777-2: always finite and >= 1
 *   77777777-3: identity — ratio * HM === QM
 *   77777777-4: for n=3 equals sqrt((r^2+t^2)/2) * (r+t) / (2*r*t)
 *   77777777-5: absent on cast:no_match
 *   77777777-6: absent when fewer than 3 candidates
 *   77777777-7: product decomposition — QM/HM === QMToAMRatio * AMHMRatio
 *   77777777-8: tool description documents candidateScoreNonWinnerQMHMRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-77777777-${label}-${Date.now()}.jsonl`);
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

test('77777777-1: present when >= 3 candidates and all non-winner scores > 0', async () => {
  const agg = buildAgg('zzz1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3 && explanation.lowestCandidateScore > 0) {
      assert.ok('candidateScoreNonWinnerQMHMRatio' in explanation,
        `candidateScoreNonWinnerQMHMRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreNonWinnerQMHMRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('77777777-2: always finite and >= 1', async () => {
  const agg = buildAgg('zzz2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerQMHMRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreNonWinnerQMHMRatio),
        `should be finite, got ${explanation.candidateScoreNonWinnerQMHMRatio}`,
      );
      assert.ok(
        explanation.candidateScoreNonWinnerQMHMRatio >= 1 - 1e-9,
        `should be >= 1, got ${explanation.candidateScoreNonWinnerQMHMRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('77777777-3: identity — ratio * HM === QM', async () => {
  const agg = buildAgg('zzz3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerQMHMRatio' in explanation &&
        'candidateScoreNonWinnerHarmonicMean' in explanation &&
        'candidateScoreNonWinnerQuadraticMean' in explanation) {
      const product = explanation.candidateScoreNonWinnerQMHMRatio * explanation.candidateScoreNonWinnerHarmonicMean;
      assert.ok(
        Math.abs(product - explanation.candidateScoreNonWinnerQuadraticMean) < 1e-9,
        `ratio * HM (${product}) should equal QM (${explanation.candidateScoreNonWinnerQuadraticMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('77777777-4: for n=3 equals sqrt((r^2+t^2)/2) * (r+t) / (2*r*t)', async () => {
  const agg = buildAgg('zzz4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerQMHMRatio' in explanation &&
        'runnerUpScore' in explanation &&
        'thirdCandidateScore' in explanation &&
        explanation.candidateCount === 3 &&
        explanation.runnerUpScore > 0 &&
        explanation.thirdCandidateScore > 0) {
      const ru = explanation.runnerUpScore;
      const t = explanation.thirdCandidateScore;
      const expected = Math.sqrt((ru ** 2 + t ** 2) / 2) * (ru + t) / (2 * ru * t);
      assert.ok(
        Math.abs(explanation.candidateScoreNonWinnerQMHMRatio - expected) < 1e-9,
        `for n=3, QM/HM ratio (${explanation.candidateScoreNonWinnerQMHMRatio}) should equal sqrt((r^2+t^2)/2)*(r+t)/(2rt) (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('77777777-5: absent on cast:no_match', async () => {
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
      !('candidateScoreNonWinnerQMHMRatio' in parsed.explanation),
      `should be absent on no_match`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('77777777-6: absent when fewer than 3 candidates', async () => {
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
        !('candidateScoreNonWinnerQMHMRatio' in explanation),
        `should be absent with < 3 candidates`,
      );
    }
  } finally {
    await twoAgg.shutdown();
  }
});

test('77777777-7: product decomposition — QM/HM === QMToAMRatio * AMHMRatio', async () => {
  const agg = buildAgg('zzz7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerQMHMRatio' in explanation &&
        'candidateScoreNonWinnerQMToAMRatio' in explanation &&
        'candidateScoreNonWinnerAMHMRatio' in explanation) {
      const product = explanation.candidateScoreNonWinnerQMToAMRatio * explanation.candidateScoreNonWinnerAMHMRatio;
      assert.ok(
        Math.abs(explanation.candidateScoreNonWinnerQMHMRatio - product) < 1e-9,
        `QM/HM (${explanation.candidateScoreNonWinnerQMHMRatio}) should equal QM/AM * AM/HM (${product})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('77777777-8: tool description documents candidateScoreNonWinnerQMHMRatio', async () => {
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
      cast.description?.includes('candidateScoreNonWinnerQMHMRatio'),
      `cast description should mention candidateScoreNonWinnerQMHMRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
