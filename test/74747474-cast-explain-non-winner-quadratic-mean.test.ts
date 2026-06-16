/**
 * 74747474: explanation.candidateScoreNonWinnerQuadraticMean in ch1tty/cast when explain:true.
 *
 * candidateScoreNonWinnerQuadraticMean: number — the quadratic mean (RMS) of non-winner scores:
 * sqrt(sum(score_i^2) / (n-1)) over all non-winner candidates.
 *
 * Present when: >= 3 candidates.
 * Absent when: no_match or < 3 candidates. No zero restriction (squares are always non-negative).
 * Always >= 0.
 * Always >= candidateScoreNonWinnerMean (QM >= AM by Power Mean inequality).
 * Equals candidateScoreNonWinnerMean when all non-winners are tied.
 * For n=3: equals sqrt((runnerUp^2 + third^2) / 2).
 * Identity: QM^2 * (n-1) === sum of squares of non-winner scores.
 *
 * Covered:
 *   74747474-1: present when >= 3 candidates
 *   74747474-2: always finite and >= 0
 *   74747474-3: identity — QM^2 * (n-1) === sum of non-winner scores squared
 *   74747474-4: for n=3 equals sqrt((r^2 + t^2) / 2)
 *   74747474-5: absent on cast:no_match
 *   74747474-6: absent when fewer than 3 candidates
 *   74747474-7: always >= candidateScoreNonWinnerMean (QM >= AM)
 *   74747474-8: tool description documents candidateScoreNonWinnerQuadraticMean
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-74747474-${label}-${Date.now()}.jsonl`);
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

test('74747474-1: present when >= 3 candidates', async () => {
  const agg = buildAgg('www1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3) {
      assert.ok('candidateScoreNonWinnerQuadraticMean' in explanation,
        `candidateScoreNonWinnerQuadraticMean should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreNonWinnerQuadraticMean, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('74747474-2: always finite and >= 0', async () => {
  const agg = buildAgg('www2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerQuadraticMean' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreNonWinnerQuadraticMean),
        `should be finite, got ${explanation.candidateScoreNonWinnerQuadraticMean}`,
      );
      assert.ok(
        explanation.candidateScoreNonWinnerQuadraticMean >= 0,
        `should be >= 0, got ${explanation.candidateScoreNonWinnerQuadraticMean}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('74747474-3: identity — QM^2 * (n-1) === sum of non-winner scores squared', async () => {
  const agg = buildAgg('www3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerQuadraticMean' in explanation &&
        'runnerUpScore' in explanation &&
        'thirdCandidateScore' in explanation) {
      const n = explanation.candidateCount;
      const qm = explanation.candidateScoreNonWinnerQuadraticMean;
      const lhs = qm ** 2 * (n - 1);
      const ru = explanation.runnerUpScore;
      const t = explanation.thirdCandidateScore;
      const rhs = n === 3 ? (ru ** 2 + t ** 2) : undefined;
      if (rhs !== undefined) {
        assert.ok(
          Math.abs(lhs - rhs) < 1e-9,
          `QM^2 * (n-1) (${lhs}) should equal sum of non-winner scores^2 (${rhs})`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('74747474-4: for n=3 equals sqrt((r^2 + t^2) / 2)', async () => {
  const agg = buildAgg('www4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerQuadraticMean' in explanation &&
        'runnerUpScore' in explanation &&
        'thirdCandidateScore' in explanation &&
        explanation.candidateCount === 3) {
      const ru = explanation.runnerUpScore;
      const t = explanation.thirdCandidateScore;
      const expected = Math.sqrt((ru ** 2 + t ** 2) / 2);
      assert.ok(
        Math.abs(explanation.candidateScoreNonWinnerQuadraticMean - expected) < 1e-9,
        `for n=3, candidateScoreNonWinnerQuadraticMean (${explanation.candidateScoreNonWinnerQuadraticMean}) should equal sqrt((r^2+t^2)/2) (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('74747474-5: absent on cast:no_match', async () => {
  const path = dlqPath('www5');
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
      !('candidateScoreNonWinnerQuadraticMean' in parsed.explanation),
      `should be absent on no_match`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('74747474-6: absent when fewer than 3 candidates', async () => {
  const path = dlqPath('www6');
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
        !('candidateScoreNonWinnerQuadraticMean' in explanation),
        `should be absent with < 3 candidates`,
      );
    }
  } finally {
    await twoAgg.shutdown();
  }
});

test('74747474-7: always >= candidateScoreNonWinnerMean (QM >= AM by Power Mean inequality)', async () => {
  const agg = buildAgg('www7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerQuadraticMean' in explanation &&
        'candidateScoreNonWinnerMean' in explanation) {
      assert.ok(
        explanation.candidateScoreNonWinnerQuadraticMean >= explanation.candidateScoreNonWinnerMean - 1e-9,
        `QM (${explanation.candidateScoreNonWinnerQuadraticMean}) should be >= AM (${explanation.candidateScoreNonWinnerMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('74747474-8: tool description documents candidateScoreNonWinnerQuadraticMean', async () => {
  const path = dlqPath('www8');
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
      cast.description?.includes('candidateScoreNonWinnerQuadraticMean'),
      `cast description should mention candidateScoreNonWinnerQuadraticMean, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
