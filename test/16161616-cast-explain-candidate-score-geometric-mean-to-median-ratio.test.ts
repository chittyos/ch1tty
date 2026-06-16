/**
 * 16161616: explanation.candidateScoreGeometricMeanToMedianRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreGeometricMeanToMedianRatio: number — ratio of geometric mean to median:
 * candidateScoreGeometricMean / medianCandidateScore.
 *
 * Present when: >= 2 candidates, all scores > 0, and medianCandidateScore > 0.
 * Absent when: no_match, single candidate, any score === 0.
 * No fixed bound relative to 1 (GM vs median can go either way).
 * Exact inverse of candidateScoreMedianToGeometricMeanRatio: product === 1.
 * For n=2: 2*sqrt(wr)/(w+r) — same as candidateScoreGeometricMeanToMeanRatio for n=2 (median = AM when n=2).
 * Identity: candidateScoreGeometricMeanToMedianRatio * medianCandidateScore === candidateScoreGeometricMean.
 *
 * Covered:
 *   16161616-1: present when >= 2 candidates, all scores > 0, and medianCandidateScore > 0
 *   16161616-2: > 0 and finite when present
 *   16161616-3: inverse of candidateScoreMedianToGeometricMeanRatio — product === 1 when both present
 *   16161616-4: for n=2 equals 2*sqrt(wr)/(w+r)
 *   16161616-5: absent on cast:no_match
 *   16161616-6: absent when only 1 candidate
 *   16161616-7: identity — candidateScoreGeometricMeanToMedianRatio * medianCandidateScore === candidateScoreGeometricMean
 *   16161616-8: tool description documents candidateScoreGeometricMeanToMedianRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-16161616-${label}-${Date.now()}.jsonl`);
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

test('16161616-1: present when >= 2 candidates, all scores > 0, and medianCandidateScore > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('qq1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreGeometricMean' in explanation && explanation.candidateScoreGeometricMean > 0 &&
        'medianCandidateScore' in explanation && explanation.medianCandidateScore > 0) {
      assert.ok('candidateScoreGeometricMeanToMedianRatio' in explanation,
        `candidateScoreGeometricMeanToMedianRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreGeometricMeanToMedianRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('16161616-2: > 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('qq2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreGeometricMeanToMedianRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreGeometricMeanToMedianRatio),
        `should be finite, got ${explanation.candidateScoreGeometricMeanToMedianRatio}`,
      );
      assert.ok(
        explanation.candidateScoreGeometricMeanToMedianRatio > 0,
        `should be > 0, got ${explanation.candidateScoreGeometricMeanToMedianRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('16161616-3: inverse of candidateScoreMedianToGeometricMeanRatio — product === 1 when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('qq3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreGeometricMeanToMedianRatio' in explanation && 'candidateScoreMedianToGeometricMeanRatio' in explanation) {
      const product = explanation.candidateScoreGeometricMeanToMedianRatio * explanation.candidateScoreMedianToGeometricMeanRatio;
      assert.ok(
        Math.abs(product - 1) < 1e-9,
        `candidateScoreGeometricMeanToMedianRatio * candidateScoreMedianToGeometricMeanRatio (${product}) should equal 1`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('16161616-4: for n=2 equals 2*sqrt(wr)/(w+r)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('qq4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreGeometricMeanToMedianRatio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0 && explanation.runnerUpScore > 0) {
      const w = explanation.winnerScore;
      const ru = explanation.runnerUpScore;
      const expected = (2 * Math.sqrt(w * ru)) / (w + ru);
      assert.ok(
        Math.abs(explanation.candidateScoreGeometricMeanToMedianRatio - expected) < 1e-9,
        `candidateScoreGeometricMeanToMedianRatio (${explanation.candidateScoreGeometricMeanToMedianRatio}) should equal 2*sqrt(wr)/(w+r) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('16161616-5: absent on cast:no_match', async () => {
  const path = dlqPath('qq5');
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
      !('candidateScoreGeometricMeanToMedianRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.candidateScoreGeometricMeanToMedianRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('16161616-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('qq6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreGeometricMeanToMedianRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.candidateScoreGeometricMeanToMedianRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('16161616-7: identity — candidateScoreGeometricMeanToMedianRatio * medianCandidateScore === candidateScoreGeometricMean', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('qq7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreGeometricMeanToMedianRatio' in explanation && 'medianCandidateScore' in explanation && 'candidateScoreGeometricMean' in explanation) {
      const product = explanation.candidateScoreGeometricMeanToMedianRatio * explanation.medianCandidateScore;
      assert.ok(
        Math.abs(product - explanation.candidateScoreGeometricMean) < 1e-9,
        `candidateScoreGeometricMeanToMedianRatio * medianCandidateScore (${product}) should equal candidateScoreGeometricMean (${explanation.candidateScoreGeometricMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('16161616-8: tool description documents candidateScoreGeometricMeanToMedianRatio', async () => {
  const path = dlqPath('qq8');
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
      cast.description?.includes('candidateScoreGeometricMeanToMedianRatio'),
      `cast description should mention candidateScoreGeometricMeanToMedianRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
