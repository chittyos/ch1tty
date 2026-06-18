/**
 * 62626262: explanation.candidateScoreNonWinnerGeometricMean in ch1tty/cast when explain:true.
 *
 * candidateScoreNonWinnerGeometricMean: number — geometric mean of all non-winner candidate scores:
 * (product of non-winner scores)^(1/(n-1)).
 *
 * Present when: >= 3 candidates and all non-winner scores > 0.
 * Absent when: no_match, < 3 candidates, or any non-winner score is zero.
 * Always > 0.
 * Always <= candidateScoreNonWinnerMean (AM >= GM).
 * Always >= lowestCandidateScore.
 * For n=3: equals sqrt(runnerUpScore * thirdCandidateScore).
 *
 * Covered:
 *   62626262-1: present when >= 3 candidates and all non-winner scores > 0
 *   62626262-2: always finite and > 0
 *   62626262-3: always <= candidateScoreNonWinnerMean (AM-GM)
 *   62626262-4: for n=3 equals sqrt(runnerUpScore * thirdCandidateScore)
 *   62626262-5: absent on cast:no_match
 *   62626262-6: absent when fewer than 3 candidates
 *   62626262-7: always >= lowestCandidateScore
 *   62626262-8: tool description documents candidateScoreNonWinnerGeometricMean
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-62626262-${label}-${Date.now()}.jsonl`);
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

test('62626262-1: present when >= 3 candidates and all non-winner scores > 0', async () => {
  const agg = buildAgg('kkk1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3 && explanation.lowestCandidateScore > 0) {
      assert.ok('candidateScoreNonWinnerGeometricMean' in explanation,
        `candidateScoreNonWinnerGeometricMean should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreNonWinnerGeometricMean, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('62626262-2: always finite and > 0', async () => {
  const agg = buildAgg('kkk2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerGeometricMean' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreNonWinnerGeometricMean),
        `should be finite, got ${explanation.candidateScoreNonWinnerGeometricMean}`,
      );
      assert.ok(
        explanation.candidateScoreNonWinnerGeometricMean > 0,
        `should be > 0, got ${explanation.candidateScoreNonWinnerGeometricMean}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('62626262-3: always <= candidateScoreNonWinnerMean (AM >= GM)', async () => {
  const agg = buildAgg('kkk3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerGeometricMean' in explanation && 'candidateScoreNonWinnerMean' in explanation) {
      assert.ok(
        explanation.candidateScoreNonWinnerGeometricMean <= explanation.candidateScoreNonWinnerMean + 1e-9,
        `candidateScoreNonWinnerGeometricMean (${explanation.candidateScoreNonWinnerGeometricMean}) should be <= candidateScoreNonWinnerMean (${explanation.candidateScoreNonWinnerMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('62626262-4: for n=3 equals sqrt(runnerUpScore * thirdCandidateScore)', async () => {
  const agg = buildAgg('kkk4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerGeometricMean' in explanation &&
        'runnerUpScore' in explanation &&
        'thirdCandidateScore' in explanation &&
        explanation.candidateCount === 3) {
      const expected = Math.sqrt(explanation.runnerUpScore * explanation.thirdCandidateScore);
      assert.ok(
        Math.abs(explanation.candidateScoreNonWinnerGeometricMean - expected) < 1e-9,
        `for n=3, candidateScoreNonWinnerGeometricMean (${explanation.candidateScoreNonWinnerGeometricMean}) should equal sqrt(runnerUp * third) (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('62626262-5: absent on cast:no_match', async () => {
  const path = dlqPath('kkk5');
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
      !('candidateScoreNonWinnerGeometricMean' in parsed.explanation),
      `should be absent on no_match`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('62626262-6: absent when fewer than 3 candidates', async () => {
  const path = dlqPath('kkk6');
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
        !('candidateScoreNonWinnerGeometricMean' in explanation),
        `should be absent with < 3 candidates`,
      );
    }
  } finally {
    await twoAgg.shutdown();
  }
});

test('62626262-7: always >= lowestCandidateScore', async () => {
  const agg = buildAgg('kkk7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerGeometricMean' in explanation && 'lowestCandidateScore' in explanation) {
      assert.ok(
        explanation.candidateScoreNonWinnerGeometricMean >= explanation.lowestCandidateScore - 1e-9,
        `candidateScoreNonWinnerGeometricMean (${explanation.candidateScoreNonWinnerGeometricMean}) should be >= lowestCandidateScore (${explanation.lowestCandidateScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('62626262-8: tool description documents candidateScoreNonWinnerGeometricMean', async () => {
  const path = dlqPath('kkk8');
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
      cast.description?.includes('candidateScoreNonWinnerGeometricMean'),
      `cast description should mention candidateScoreNonWinnerGeometricMean, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
