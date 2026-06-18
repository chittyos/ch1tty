/**
 * 76767676: explanation.candidateScoreNonWinnerQMGap in ch1tty/cast when explain:true.
 *
 * candidateScoreNonWinnerQMGap: number — gap between non-winner quadratic mean and arithmetic mean:
 * candidateScoreNonWinnerQuadraticMean - candidateScoreNonWinnerMean.
 *
 * Present when: >= 3 candidates.
 * Absent when: no_match or < 3 candidates. No zero restriction.
 * Always >= 0 (QM >= AM by Power Mean inequality).
 * Zero when all non-winners are tied.
 * For n=3: equals sqrt((r^2+t^2)/2) - (r+t)/2.
 * Identity: gap === QM - AM.
 * Variance identity: gap * (QM + AM) === stdDev^2 (follows from QM^2 - AM^2 = stdDev^2).
 *
 * Covered:
 *   76767676-1: present when >= 3 candidates
 *   76767676-2: always finite and >= 0
 *   76767676-3: identity — gap + AM === QM
 *   76767676-4: for n=3 equals sqrt((r^2+t^2)/2) - (r+t)/2
 *   76767676-5: absent on cast:no_match
 *   76767676-6: absent when fewer than 3 candidates
 *   76767676-7: variance identity — gap * (QM + AM) === stdDev^2
 *   76767676-8: tool description documents candidateScoreNonWinnerQMGap
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-76767676-${label}-${Date.now()}.jsonl`);
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

test('76767676-1: present when >= 3 candidates', async () => {
  const agg = buildAgg('yyy1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3) {
      assert.ok('candidateScoreNonWinnerQMGap' in explanation,
        `candidateScoreNonWinnerQMGap should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreNonWinnerQMGap, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('76767676-2: always finite and >= 0', async () => {
  const agg = buildAgg('yyy2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerQMGap' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreNonWinnerQMGap),
        `should be finite, got ${explanation.candidateScoreNonWinnerQMGap}`,
      );
      assert.ok(
        explanation.candidateScoreNonWinnerQMGap >= -1e-9,
        `should be >= 0, got ${explanation.candidateScoreNonWinnerQMGap}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('76767676-3: identity — gap + AM === QM', async () => {
  const agg = buildAgg('yyy3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerQMGap' in explanation &&
        'candidateScoreNonWinnerMean' in explanation &&
        'candidateScoreNonWinnerQuadraticMean' in explanation) {
      const sum = explanation.candidateScoreNonWinnerQMGap + explanation.candidateScoreNonWinnerMean;
      assert.ok(
        Math.abs(sum - explanation.candidateScoreNonWinnerQuadraticMean) < 1e-9,
        `gap + AM (${sum}) should equal QM (${explanation.candidateScoreNonWinnerQuadraticMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('76767676-4: for n=3 equals sqrt((r^2+t^2)/2) - (r+t)/2', async () => {
  const agg = buildAgg('yyy4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerQMGap' in explanation &&
        'runnerUpScore' in explanation &&
        'thirdCandidateScore' in explanation &&
        explanation.candidateCount === 3) {
      const ru = explanation.runnerUpScore;
      const t = explanation.thirdCandidateScore;
      const expected = Math.sqrt((ru ** 2 + t ** 2) / 2) - (ru + t) / 2;
      assert.ok(
        Math.abs(explanation.candidateScoreNonWinnerQMGap - expected) < 1e-9,
        `for n=3, QMGap (${explanation.candidateScoreNonWinnerQMGap}) should equal sqrt((r^2+t^2)/2)-(r+t)/2 (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('76767676-5: absent on cast:no_match', async () => {
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
      !('candidateScoreNonWinnerQMGap' in parsed.explanation),
      `should be absent on no_match`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('76767676-6: absent when fewer than 3 candidates', async () => {
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
        !('candidateScoreNonWinnerQMGap' in explanation),
        `should be absent with < 3 candidates`,
      );
    }
  } finally {
    await twoAgg.shutdown();
  }
});

test('76767676-7: variance identity — gap * (QM + AM) === stdDev^2', async () => {
  const agg = buildAgg('yyy7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerQMGap' in explanation &&
        'candidateScoreNonWinnerQuadraticMean' in explanation &&
        'candidateScoreNonWinnerMean' in explanation &&
        'candidateScoreNonWinnerStdDev' in explanation) {
      const lhs = explanation.candidateScoreNonWinnerQMGap *
        (explanation.candidateScoreNonWinnerQuadraticMean + explanation.candidateScoreNonWinnerMean);
      const rhs = explanation.candidateScoreNonWinnerStdDev ** 2;
      assert.ok(
        Math.abs(lhs - rhs) < 1e-9,
        `QMGap*(QM+AM) (${lhs}) should equal stdDev^2 (${rhs})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('76767676-8: tool description documents candidateScoreNonWinnerQMGap', async () => {
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
      cast.description?.includes('candidateScoreNonWinnerQMGap'),
      `cast description should mention candidateScoreNonWinnerQMGap, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
