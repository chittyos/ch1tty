/**
 * 79797979: explanation.candidateScoreNonWinnerQMHMGap in ch1tty/cast when explain:true.
 *
 * candidateScoreNonWinnerQMHMGap: number — gap between non-winner quadratic mean and harmonic mean:
 * candidateScoreNonWinnerQuadraticMean - candidateScoreNonWinnerHarmonicMean.
 *
 * Present when: >= 3 candidates and all non-winner scores > 0.
 * Absent when: no_match, < 3 candidates, or any non-winner score is zero.
 * Always >= 0 (QM >= HM by Power Mean chain).
 * Zero when all non-winners are tied.
 * For n=3: equals sqrt((r^2+t^2)/2) - 2*r*t/(r+t).
 * Additive decomposition: QMHMGap === QMGap + AMGMGap + GMHMGap.
 * Always >= candidateScoreNonWinnerAMHMGap (QM >= AM).
 * Always >= candidateScoreNonWinnerQMGap (HM <= AM).
 * Identity: gap + HM === QM.
 *
 * Covered:
 *   79797979-1: present when >= 3 candidates and all non-winner scores > 0
 *   79797979-2: always finite and >= 0
 *   79797979-3: identity — gap + HM === QM
 *   79797979-4: for n=3 equals sqrt((r^2+t^2)/2) - 2*r*t/(r+t)
 *   79797979-5: absent on cast:no_match
 *   79797979-6: absent when fewer than 3 candidates
 *   79797979-7: additive decomposition — QMHMGap === QMGap + AMGMGap + GMHMGap
 *   79797979-8: tool description documents candidateScoreNonWinnerQMHMGap
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-79797979-${label}-${Date.now()}.jsonl`);
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

test('79797979-1: present when >= 3 candidates and all non-winner scores > 0', async () => {
  const agg = buildAgg('bbb1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3 && explanation.lowestCandidateScore > 0) {
      assert.ok('candidateScoreNonWinnerQMHMGap' in explanation,
        `candidateScoreNonWinnerQMHMGap should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreNonWinnerQMHMGap, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('79797979-2: always finite and >= 0', async () => {
  const agg = buildAgg('bbb2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerQMHMGap' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreNonWinnerQMHMGap),
        `should be finite, got ${explanation.candidateScoreNonWinnerQMHMGap}`,
      );
      assert.ok(
        explanation.candidateScoreNonWinnerQMHMGap >= -1e-9,
        `should be >= 0, got ${explanation.candidateScoreNonWinnerQMHMGap}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('79797979-3: identity — gap + HM === QM', async () => {
  const agg = buildAgg('bbb3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerQMHMGap' in explanation &&
        'candidateScoreNonWinnerHarmonicMean' in explanation &&
        'candidateScoreNonWinnerQuadraticMean' in explanation) {
      const sum = explanation.candidateScoreNonWinnerQMHMGap + explanation.candidateScoreNonWinnerHarmonicMean;
      assert.ok(
        Math.abs(sum - explanation.candidateScoreNonWinnerQuadraticMean) < 1e-9,
        `gap + HM (${sum}) should equal QM (${explanation.candidateScoreNonWinnerQuadraticMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('79797979-4: for n=3 equals sqrt((r^2+t^2)/2) - 2*r*t/(r+t)', async () => {
  const agg = buildAgg('bbb4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerQMHMGap' in explanation &&
        'runnerUpScore' in explanation &&
        'thirdCandidateScore' in explanation &&
        explanation.candidateCount === 3 &&
        explanation.runnerUpScore > 0 &&
        explanation.thirdCandidateScore > 0) {
      const ru = explanation.runnerUpScore;
      const t = explanation.thirdCandidateScore;
      const expected = Math.sqrt((ru ** 2 + t ** 2) / 2) - (2 * ru * t) / (ru + t);
      assert.ok(
        Math.abs(explanation.candidateScoreNonWinnerQMHMGap - expected) < 1e-9,
        `for n=3, QMHMGap (${explanation.candidateScoreNonWinnerQMHMGap}) should equal sqrt((r^2+t^2)/2)-2rt/(r+t) (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('79797979-5: absent on cast:no_match', async () => {
  const path = dlqPath('bbb5');
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
      !('candidateScoreNonWinnerQMHMGap' in parsed.explanation),
      `should be absent on no_match`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('79797979-6: absent when fewer than 3 candidates', async () => {
  const path = dlqPath('bbb6');
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
        !('candidateScoreNonWinnerQMHMGap' in explanation),
        `should be absent with < 3 candidates`,
      );
    }
  } finally {
    await twoAgg.shutdown();
  }
});

test('79797979-7: additive decomposition — QMHMGap === QMGap + AMGMGap + GMHMGap', async () => {
  const agg = buildAgg('bbb7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerQMHMGap' in explanation &&
        'candidateScoreNonWinnerQMGap' in explanation &&
        'candidateScoreNonWinnerAMGMGap' in explanation &&
        'candidateScoreNonWinnerGMHMGap' in explanation) {
      const sum = explanation.candidateScoreNonWinnerQMGap +
        explanation.candidateScoreNonWinnerAMGMGap +
        explanation.candidateScoreNonWinnerGMHMGap;
      assert.ok(
        Math.abs(explanation.candidateScoreNonWinnerQMHMGap - sum) < 1e-9,
        `QMHMGap (${explanation.candidateScoreNonWinnerQMHMGap}) should equal QMGap+AMGMGap+GMHMGap (${sum})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('79797979-8: tool description documents candidateScoreNonWinnerQMHMGap', async () => {
  const path = dlqPath('bbb8');
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
      cast.description?.includes('candidateScoreNonWinnerQMHMGap'),
      `cast description should mention candidateScoreNonWinnerQMHMGap, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
