/**
 * 20202020: explanation.candidateScoreHarmonicMeanToRunnerUpRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreHarmonicMeanToRunnerUpRatio: number — ratio of harmonic mean to runner-up score:
 * candidateScoreHarmonicMean / runnerUpScore.
 *
 * Present when: >= 2 candidates, all scores > 0 (HM defined), and runnerUpScore > 0.
 * Absent when: no_match, single candidate, any score === 0, runnerUpScore === 0.
 * No fixed bound relative to 1 (HM vs runner-up can go either way).
 * Exact inverse of runnerUpScoreToHarmonicMeanRatio: product === 1.
 * For n=2: HM = 2wr/(w+r), runner-up = r; ratio = 2w/(w+r) === winnerScoreToMeanRatio for n=2.
 * Identity: candidateScoreHarmonicMeanToRunnerUpRatio * runnerUpScore === candidateScoreHarmonicMean.
 *
 * Covered:
 *   20202020-1: present when >= 2 candidates, all scores > 0, and runnerUpScore > 0
 *   20202020-2: > 0 and finite when present
 *   20202020-3: inverse of runnerUpScoreToHarmonicMeanRatio — product === 1 when both present
 *   20202020-4: for n=2 equals 2w/(w+r)
 *   20202020-5: absent on cast:no_match
 *   20202020-6: absent when only 1 candidate
 *   20202020-7: identity — candidateScoreHarmonicMeanToRunnerUpRatio * runnerUpScore === candidateScoreHarmonicMean
 *   20202020-8: tool description documents candidateScoreHarmonicMeanToRunnerUpRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-20202020-${label}-${Date.now()}.jsonl`);
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

test('20202020-1: present when >= 2 candidates, all scores > 0, and runnerUpScore > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('uu1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreHarmonicMean' in explanation && explanation.candidateScoreHarmonicMean > 0 &&
        'runnerUpScore' in explanation && explanation.runnerUpScore > 0) {
      assert.ok('candidateScoreHarmonicMeanToRunnerUpRatio' in explanation,
        `candidateScoreHarmonicMeanToRunnerUpRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreHarmonicMeanToRunnerUpRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('20202020-2: > 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('uu2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreHarmonicMeanToRunnerUpRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreHarmonicMeanToRunnerUpRatio),
        `should be finite, got ${explanation.candidateScoreHarmonicMeanToRunnerUpRatio}`,
      );
      assert.ok(
        explanation.candidateScoreHarmonicMeanToRunnerUpRatio > 0,
        `should be > 0, got ${explanation.candidateScoreHarmonicMeanToRunnerUpRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('20202020-3: inverse of runnerUpScoreToHarmonicMeanRatio — product === 1 when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('uu3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreHarmonicMeanToRunnerUpRatio' in explanation && 'runnerUpScoreToHarmonicMeanRatio' in explanation) {
      const product = explanation.candidateScoreHarmonicMeanToRunnerUpRatio * explanation.runnerUpScoreToHarmonicMeanRatio;
      assert.ok(
        Math.abs(product - 1) < 1e-9,
        `candidateScoreHarmonicMeanToRunnerUpRatio * runnerUpScoreToHarmonicMeanRatio (${product}) should equal 1`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('20202020-4: for n=2 equals 2w/(w+r)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('uu4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreHarmonicMeanToRunnerUpRatio' in explanation && explanation.candidateCount === 2 &&
        explanation.winnerScore > 0 && explanation.runnerUpScore > 0) {
      const w = explanation.winnerScore;
      const ru = explanation.runnerUpScore;
      const expected = (2 * w) / (w + ru);
      assert.ok(
        Math.abs(explanation.candidateScoreHarmonicMeanToRunnerUpRatio - expected) < 1e-9,
        `candidateScoreHarmonicMeanToRunnerUpRatio (${explanation.candidateScoreHarmonicMeanToRunnerUpRatio}) should equal 2w/(w+r) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('20202020-5: absent on cast:no_match', async () => {
  const path = dlqPath('uu5');
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
      !('candidateScoreHarmonicMeanToRunnerUpRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.candidateScoreHarmonicMeanToRunnerUpRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('20202020-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('uu6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreHarmonicMeanToRunnerUpRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.candidateScoreHarmonicMeanToRunnerUpRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('20202020-7: identity — candidateScoreHarmonicMeanToRunnerUpRatio * runnerUpScore === candidateScoreHarmonicMean', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('uu7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreHarmonicMeanToRunnerUpRatio' in explanation &&
        'runnerUpScore' in explanation &&
        'candidateScoreHarmonicMean' in explanation) {
      const product = explanation.candidateScoreHarmonicMeanToRunnerUpRatio * explanation.runnerUpScore;
      assert.ok(
        Math.abs(product - explanation.candidateScoreHarmonicMean) < 1e-9,
        `candidateScoreHarmonicMeanToRunnerUpRatio * runnerUpScore (${product}) should equal candidateScoreHarmonicMean (${explanation.candidateScoreHarmonicMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('20202020-8: tool description documents candidateScoreHarmonicMeanToRunnerUpRatio', async () => {
  const path = dlqPath('uu8');
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
      cast.description?.includes('candidateScoreHarmonicMeanToRunnerUpRatio'),
      `cast description should mention candidateScoreHarmonicMeanToRunnerUpRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
