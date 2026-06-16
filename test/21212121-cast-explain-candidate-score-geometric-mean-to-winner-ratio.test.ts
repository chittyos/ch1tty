/**
 * 21212121: explanation.candidateScoreGeometricMeanToWinnerRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreGeometricMeanToWinnerRatio: number — ratio of geometric mean to winner score:
 * candidateScoreGeometricMean / winnerScore.
 *
 * Present when: >= 2 candidates, all scores > 0 (GM defined), and winnerScore > 0.
 * Absent when: no_match, single candidate, any score === 0, winnerScore === 0.
 * Always in (0, 1]: GM <= winner always; equality only when all scores identical.
 * Exact inverse of winnerScoreToGeometricMeanRatio: product === 1.
 * Always >= candidateScoreMeanRatio (mean/winner): GM <= AM so GM/winner <= AM/winner.
 * For n=2: GM = sqrt(wr), winner = w; ratio = sqrt(r/w) = 1/sqrt(winnerScoreRatio).
 * Identity: candidateScoreGeometricMeanToWinnerRatio * winnerScore === candidateScoreGeometricMean.
 *
 * Covered:
 *   21212121-1: present when >= 2 candidates, all scores > 0, and winnerScore > 0
 *   21212121-2: always in (0, 1] when present
 *   21212121-3: inverse of winnerScoreToGeometricMeanRatio — product === 1 when both present
 *   21212121-4: for n=2 equals 1/sqrt(winnerScoreRatio) = sqrt(r/w)
 *   21212121-5: absent on cast:no_match
 *   21212121-6: absent when only 1 candidate
 *   21212121-7: identity — candidateScoreGeometricMeanToWinnerRatio * winnerScore === candidateScoreGeometricMean
 *   21212121-8: tool description documents candidateScoreGeometricMeanToWinnerRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-21212121-${label}-${Date.now()}.jsonl`);
}

const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe Payments', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.test/mcp',
};
const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.test/mcp',
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

test('21212121-1: present when >= 2 candidates, all scores > 0, and winnerScore > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('vv1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreGeometricMean' in explanation && explanation.candidateScoreGeometricMean > 0 &&
        'winnerScore' in explanation && explanation.winnerScore > 0) {
      assert.ok('candidateScoreGeometricMeanToWinnerRatio' in explanation,
        `candidateScoreGeometricMeanToWinnerRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreGeometricMeanToWinnerRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('21212121-2: always in (0, 1] when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('vv2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreGeometricMeanToWinnerRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreGeometricMeanToWinnerRatio),
        `should be finite, got ${explanation.candidateScoreGeometricMeanToWinnerRatio}`,
      );
      assert.ok(
        explanation.candidateScoreGeometricMeanToWinnerRatio > 0,
        `should be > 0, got ${explanation.candidateScoreGeometricMeanToWinnerRatio}`,
      );
      assert.ok(
        explanation.candidateScoreGeometricMeanToWinnerRatio <= 1,
        `should be <= 1, got ${explanation.candidateScoreGeometricMeanToWinnerRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('21212121-3: inverse of winnerScoreToGeometricMeanRatio — product === 1 when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('vv3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreGeometricMeanToWinnerRatio' in explanation && 'winnerScoreToGeometricMeanRatio' in explanation) {
      const product = explanation.candidateScoreGeometricMeanToWinnerRatio * explanation.winnerScoreToGeometricMeanRatio;
      assert.ok(
        Math.abs(product - 1) < 1e-9,
        `candidateScoreGeometricMeanToWinnerRatio * winnerScoreToGeometricMeanRatio (${product}) should equal 1`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('21212121-4: for n=2 equals sqrt(r/w)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('vv4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreGeometricMeanToWinnerRatio' in explanation && explanation.candidateCount === 2 &&
        explanation.winnerScore > 0 && explanation.runnerUpScore > 0) {
      const w = explanation.winnerScore;
      const ru = explanation.runnerUpScore;
      const expected = Math.sqrt(ru / w);
      assert.ok(
        Math.abs(explanation.candidateScoreGeometricMeanToWinnerRatio - expected) < 1e-9,
        `candidateScoreGeometricMeanToWinnerRatio (${explanation.candidateScoreGeometricMeanToWinnerRatio}) should equal sqrt(r/w) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('21212121-5: absent on cast:no_match', async () => {
  const path = dlqPath('vv5');
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
      !('candidateScoreGeometricMeanToWinnerRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.candidateScoreGeometricMeanToWinnerRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('21212121-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('vv6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreGeometricMeanToWinnerRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.candidateScoreGeometricMeanToWinnerRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('21212121-7: identity — candidateScoreGeometricMeanToWinnerRatio * winnerScore === candidateScoreGeometricMean', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('vv7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreGeometricMeanToWinnerRatio' in explanation &&
        'winnerScore' in explanation &&
        'candidateScoreGeometricMean' in explanation) {
      const product = explanation.candidateScoreGeometricMeanToWinnerRatio * explanation.winnerScore;
      assert.ok(
        Math.abs(product - explanation.candidateScoreGeometricMean) < 1e-9,
        `candidateScoreGeometricMeanToWinnerRatio * winnerScore (${product}) should equal candidateScoreGeometricMean (${explanation.candidateScoreGeometricMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('21212121-8: tool description documents candidateScoreGeometricMeanToWinnerRatio', async () => {
  const path = dlqPath('vv8');
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
      cast.description?.includes('candidateScoreGeometricMeanToWinnerRatio'),
      `cast description should mention candidateScoreGeometricMeanToWinnerRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
