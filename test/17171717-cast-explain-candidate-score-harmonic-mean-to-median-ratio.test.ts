/**
 * 17171717: explanation.candidateScoreHarmonicMeanToMedianRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreHarmonicMeanToMedianRatio: number — ratio of harmonic mean to median:
 * candidateScoreHarmonicMean / medianCandidateScore.
 *
 * Present when: >= 2 candidates, all scores > 0, and medianCandidateScore > 0.
 * Absent when: no_match, single candidate, any score === 0.
 * No fixed bound relative to 1 (HM vs median can go either way).
 * Exact inverse of candidateScoreMedianToHarmonicMeanRatio: product === 1.
 * Three-way chain: candidateScoreHarmonicMeanToMedianRatio * medianToMeanRatio === candidateScoreHarmonicMeanToMeanRatio.
 * For n=2: 4wr/(w+r)^2 — same as candidateScoreHarmonicMeanToMeanRatio for n=2 (median = AM when n=2).
 * Identity: candidateScoreHarmonicMeanToMedianRatio * medianCandidateScore === candidateScoreHarmonicMean.
 *
 * Covered:
 *   17171717-1: present when >= 2 candidates, all scores > 0, and medianCandidateScore > 0
 *   17171717-2: > 0 and finite when present
 *   17171717-3: inverse of candidateScoreMedianToHarmonicMeanRatio — product === 1 when both present
 *   17171717-4: for n=2 equals 4wr/(w+r)^2
 *   17171717-5: absent on cast:no_match
 *   17171717-6: absent when only 1 candidate
 *   17171717-7: identity — candidateScoreHarmonicMeanToMedianRatio * medianCandidateScore === candidateScoreHarmonicMean
 *   17171717-8: tool description documents candidateScoreHarmonicMeanToMedianRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-17171717-${label}-${Date.now()}.jsonl`);
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

test('17171717-1: present when >= 2 candidates, all scores > 0, and medianCandidateScore > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('rr1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreHarmonicMean' in explanation && explanation.candidateScoreHarmonicMean > 0 &&
        'medianCandidateScore' in explanation && explanation.medianCandidateScore > 0) {
      assert.ok('candidateScoreHarmonicMeanToMedianRatio' in explanation,
        `candidateScoreHarmonicMeanToMedianRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreHarmonicMeanToMedianRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('17171717-2: > 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('rr2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreHarmonicMeanToMedianRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreHarmonicMeanToMedianRatio),
        `should be finite, got ${explanation.candidateScoreHarmonicMeanToMedianRatio}`,
      );
      assert.ok(
        explanation.candidateScoreHarmonicMeanToMedianRatio > 0,
        `should be > 0, got ${explanation.candidateScoreHarmonicMeanToMedianRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('17171717-3: inverse of candidateScoreMedianToHarmonicMeanRatio — product === 1 when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('rr3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreHarmonicMeanToMedianRatio' in explanation && 'candidateScoreMedianToHarmonicMeanRatio' in explanation) {
      const product = explanation.candidateScoreHarmonicMeanToMedianRatio * explanation.candidateScoreMedianToHarmonicMeanRatio;
      assert.ok(
        Math.abs(product - 1) < 1e-9,
        `candidateScoreHarmonicMeanToMedianRatio * candidateScoreMedianToHarmonicMeanRatio (${product}) should equal 1`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('17171717-4: for n=2 equals 4wr/(w+r)^2', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('rr4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreHarmonicMeanToMedianRatio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0 && explanation.runnerUpScore > 0) {
      const w = explanation.winnerScore;
      const ru = explanation.runnerUpScore;
      const expected = (4 * w * ru) / ((w + ru) ** 2);
      assert.ok(
        Math.abs(explanation.candidateScoreHarmonicMeanToMedianRatio - expected) < 1e-9,
        `candidateScoreHarmonicMeanToMedianRatio (${explanation.candidateScoreHarmonicMeanToMedianRatio}) should equal 4wr/(w+r)^2 (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('17171717-5: absent on cast:no_match', async () => {
  const path = dlqPath('rr5');
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
      !('candidateScoreHarmonicMeanToMedianRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.candidateScoreHarmonicMeanToMedianRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('17171717-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('rr6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreHarmonicMeanToMedianRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.candidateScoreHarmonicMeanToMedianRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('17171717-7: identity — candidateScoreHarmonicMeanToMedianRatio * medianCandidateScore === candidateScoreHarmonicMean', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('rr7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreHarmonicMeanToMedianRatio' in explanation && 'medianCandidateScore' in explanation && 'candidateScoreHarmonicMean' in explanation) {
      const product = explanation.candidateScoreHarmonicMeanToMedianRatio * explanation.medianCandidateScore;
      assert.ok(
        Math.abs(product - explanation.candidateScoreHarmonicMean) < 1e-9,
        `candidateScoreHarmonicMeanToMedianRatio * medianCandidateScore (${product}) should equal candidateScoreHarmonicMean (${explanation.candidateScoreHarmonicMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('17171717-8: tool description documents candidateScoreHarmonicMeanToMedianRatio', async () => {
  const path = dlqPath('rr8');
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
      cast.description?.includes('candidateScoreHarmonicMeanToMedianRatio'),
      `cast description should mention candidateScoreHarmonicMeanToMedianRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
