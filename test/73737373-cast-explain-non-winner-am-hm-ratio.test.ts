/**
 * 73737373: explanation.candidateScoreNonWinnerAMHMRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreNonWinnerAMHMRatio: number — ratio of non-winner arithmetic mean to harmonic mean:
 * candidateScoreNonWinnerMean / candidateScoreNonWinnerHarmonicMean.
 *
 * Present when: >= 3 candidates and all non-winner scores > 0.
 * Absent when: no_match, < 3 candidates, or any non-winner score is zero.
 * Always >= 1 (AM >= HM by AM-HM inequality).
 * Equals 1 when all non-winners are tied.
 * For n=3: equals (runnerUp + third)^2 / (4 * runnerUp * third).
 * Identity: ratio * candidateScoreNonWinnerHarmonicMean === candidateScoreNonWinnerMean.
 * Always >= candidateScoreNonWinnerAMGMRatio (AM/HM >= AM/GM since GM >= HM).
 * For n=3: equals (candidateScoreNonWinnerAMGMRatio)^2 (since AM/GM = GM/HM for 2 numbers).
 *
 * Covered:
 *   73737373-1: present when >= 3 candidates and all non-winner scores > 0
 *   73737373-2: always finite and >= 1
 *   73737373-3: identity — ratio * HM === AM
 *   73737373-4: for n=3 equals (r+t)^2 / (4*r*t)
 *   73737373-5: absent on cast:no_match
 *   73737373-6: absent when fewer than 3 candidates
 *   73737373-7: always >= candidateScoreNonWinnerAMGMRatio
 *   73737373-8: tool description documents candidateScoreNonWinnerAMHMRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-73737373-${label}-${Date.now()}.jsonl`);
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

test('73737373-1: present when >= 3 candidates and all non-winner scores > 0', async () => {
  const agg = buildAgg('vvv1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3 && explanation.lowestCandidateScore > 0) {
      assert.ok('candidateScoreNonWinnerAMHMRatio' in explanation,
        `candidateScoreNonWinnerAMHMRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreNonWinnerAMHMRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('73737373-2: always finite and >= 1', async () => {
  const agg = buildAgg('vvv2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerAMHMRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreNonWinnerAMHMRatio),
        `should be finite, got ${explanation.candidateScoreNonWinnerAMHMRatio}`,
      );
      assert.ok(
        explanation.candidateScoreNonWinnerAMHMRatio >= 1 - 1e-9,
        `should be >= 1, got ${explanation.candidateScoreNonWinnerAMHMRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('73737373-3: identity — ratio * HM === AM', async () => {
  const agg = buildAgg('vvv3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerAMHMRatio' in explanation &&
        'candidateScoreNonWinnerHarmonicMean' in explanation &&
        'candidateScoreNonWinnerMean' in explanation) {
      const product = explanation.candidateScoreNonWinnerAMHMRatio * explanation.candidateScoreNonWinnerHarmonicMean;
      assert.ok(
        Math.abs(product - explanation.candidateScoreNonWinnerMean) < 1e-9,
        `ratio * HM (${product}) should equal AM (${explanation.candidateScoreNonWinnerMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('73737373-4: for n=3 equals (r+t)^2 / (4*r*t)', async () => {
  const agg = buildAgg('vvv4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerAMHMRatio' in explanation &&
        'runnerUpScore' in explanation &&
        'thirdCandidateScore' in explanation &&
        explanation.candidateCount === 3 &&
        explanation.runnerUpScore > 0 &&
        explanation.thirdCandidateScore > 0) {
      const ru = explanation.runnerUpScore;
      const t = explanation.thirdCandidateScore;
      const expected = (ru + t) ** 2 / (4 * ru * t);
      assert.ok(
        Math.abs(explanation.candidateScoreNonWinnerAMHMRatio - expected) < 1e-9,
        `for n=3, candidateScoreNonWinnerAMHMRatio (${explanation.candidateScoreNonWinnerAMHMRatio}) should equal (r+t)^2/(4rt) (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('73737373-5: absent on cast:no_match', async () => {
  const path = dlqPath('vvv5');
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
      !('candidateScoreNonWinnerAMHMRatio' in parsed.explanation),
      `should be absent on no_match`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('73737373-6: absent when fewer than 3 candidates', async () => {
  const path = dlqPath('vvv6');
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
        !('candidateScoreNonWinnerAMHMRatio' in explanation),
        `should be absent with < 3 candidates`,
      );
    }
  } finally {
    await twoAgg.shutdown();
  }
});

test('73737373-7: always >= candidateScoreNonWinnerAMGMRatio (AM/HM >= AM/GM since GM >= HM)', async () => {
  const agg = buildAgg('vvv7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerAMHMRatio' in explanation &&
        'candidateScoreNonWinnerAMGMRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreNonWinnerAMHMRatio >= explanation.candidateScoreNonWinnerAMGMRatio - 1e-9,
        `AM/HM ratio (${explanation.candidateScoreNonWinnerAMHMRatio}) should be >= AM/GM ratio (${explanation.candidateScoreNonWinnerAMGMRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('73737373-8: tool description documents candidateScoreNonWinnerAMHMRatio', async () => {
  const path = dlqPath('vvv8');
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
      cast.description?.includes('candidateScoreNonWinnerAMHMRatio'),
      `cast description should mention candidateScoreNonWinnerAMHMRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
