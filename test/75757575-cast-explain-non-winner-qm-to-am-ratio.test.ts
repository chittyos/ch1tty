/**
 * 75757575: explanation.candidateScoreNonWinnerQMToAMRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreNonWinnerQMToAMRatio: number — ratio of non-winner quadratic mean to arithmetic mean:
 * candidateScoreNonWinnerQuadraticMean / candidateScoreNonWinnerMean.
 *
 * Present when: >= 3 candidates and candidateScoreNonWinnerMean > 0.
 * Absent when: no_match, < 3 candidates, or all non-winner scores are zero.
 * Always >= 1 (QM >= AM by Power Mean inequality).
 * Equals 1 when all non-winners are tied.
 * For n=3: equals sqrt(2*(r^2+t^2)) / (r+t).
 * Identity: ratio * candidateScoreNonWinnerMean === candidateScoreNonWinnerQuadraticMean.
 * Mathematical identity: equals sqrt(1 + CV^2) where CV = candidateScoreNonWinnerCoefficientOfVariation.
 *   Follows from QM^2 = AM^2 + stdDev^2 => QM/AM = sqrt(1 + (stdDev/AM)^2).
 *
 * Covered:
 *   75757575-1: present when >= 3 candidates and nwMean > 0
 *   75757575-2: always finite and >= 1
 *   75757575-3: identity — ratio * AM === QM
 *   75757575-4: for n=3 equals sqrt(2*(r^2+t^2)) / (r+t)
 *   75757575-5: absent on cast:no_match
 *   75757575-6: absent when fewer than 3 candidates
 *   75757575-7: equals sqrt(1 + CV^2) when CV is defined
 *   75757575-8: tool description documents candidateScoreNonWinnerQMToAMRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-75757575-${label}-${Date.now()}.jsonl`);
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

test('75757575-1: present when >= 3 candidates and nwMean > 0', async () => {
  const agg = buildAgg('xxx1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3 && explanation.candidateScoreNonWinnerMean > 0) {
      assert.ok('candidateScoreNonWinnerQMToAMRatio' in explanation,
        `candidateScoreNonWinnerQMToAMRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreNonWinnerQMToAMRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('75757575-2: always finite and >= 1', async () => {
  const agg = buildAgg('xxx2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerQMToAMRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreNonWinnerQMToAMRatio),
        `should be finite, got ${explanation.candidateScoreNonWinnerQMToAMRatio}`,
      );
      assert.ok(
        explanation.candidateScoreNonWinnerQMToAMRatio >= 1 - 1e-9,
        `should be >= 1, got ${explanation.candidateScoreNonWinnerQMToAMRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('75757575-3: identity — ratio * AM === QM', async () => {
  const agg = buildAgg('xxx3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerQMToAMRatio' in explanation &&
        'candidateScoreNonWinnerMean' in explanation &&
        'candidateScoreNonWinnerQuadraticMean' in explanation) {
      const product = explanation.candidateScoreNonWinnerQMToAMRatio * explanation.candidateScoreNonWinnerMean;
      assert.ok(
        Math.abs(product - explanation.candidateScoreNonWinnerQuadraticMean) < 1e-9,
        `ratio * AM (${product}) should equal QM (${explanation.candidateScoreNonWinnerQuadraticMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('75757575-4: for n=3 equals sqrt(2*(r^2+t^2)) / (r+t)', async () => {
  const agg = buildAgg('xxx4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerQMToAMRatio' in explanation &&
        'runnerUpScore' in explanation &&
        'thirdCandidateScore' in explanation &&
        explanation.candidateCount === 3 &&
        explanation.runnerUpScore > 0 &&
        explanation.thirdCandidateScore > 0) {
      const ru = explanation.runnerUpScore;
      const t = explanation.thirdCandidateScore;
      const expected = Math.sqrt(2 * (ru ** 2 + t ** 2)) / (ru + t);
      assert.ok(
        Math.abs(explanation.candidateScoreNonWinnerQMToAMRatio - expected) < 1e-9,
        `for n=3, QM/AM ratio (${explanation.candidateScoreNonWinnerQMToAMRatio}) should equal sqrt(2*(r^2+t^2))/(r+t) (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('75757575-5: absent on cast:no_match', async () => {
  const path = dlqPath('xxx5');
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
      !('candidateScoreNonWinnerQMToAMRatio' in parsed.explanation),
      `should be absent on no_match`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('75757575-6: absent when fewer than 3 candidates', async () => {
  const path = dlqPath('xxx6');
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
        !('candidateScoreNonWinnerQMToAMRatio' in explanation),
        `should be absent with < 3 candidates`,
      );
    }
  } finally {
    await twoAgg.shutdown();
  }
});

test('75757575-7: equals sqrt(1 + CV^2) when CV is defined', async () => {
  const agg = buildAgg('xxx7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerQMToAMRatio' in explanation &&
        'candidateScoreNonWinnerCoefficientOfVariation' in explanation) {
      const cv = explanation.candidateScoreNonWinnerCoefficientOfVariation;
      const expected = Math.sqrt(1 + cv ** 2);
      assert.ok(
        Math.abs(explanation.candidateScoreNonWinnerQMToAMRatio - expected) < 1e-9,
        `QM/AM ratio (${explanation.candidateScoreNonWinnerQMToAMRatio}) should equal sqrt(1+CV^2) (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('75757575-8: tool description documents candidateScoreNonWinnerQMToAMRatio', async () => {
  const path = dlqPath('xxx8');
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
      cast.description?.includes('candidateScoreNonWinnerQMToAMRatio'),
      `cast description should mention candidateScoreNonWinnerQMToAMRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
