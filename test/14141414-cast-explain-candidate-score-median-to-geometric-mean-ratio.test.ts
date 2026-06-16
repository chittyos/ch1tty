/**
 * 14141414: explanation.candidateScoreMedianToGeometricMeanRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreMedianToGeometricMeanRatio: number — ratio of median to geometric mean:
 * medianCandidateScore / candidateScoreGeometricMean.
 *
 * Present when: >= 2 candidates, all scores > 0, and medianCandidateScore > 0.
 * Absent when: no_match, single candidate, any score === 0.
 * No fixed bound relative to 1 (median vs GM can go either way).
 * Three-way identity: candidateScoreMedianToGeometricMeanRatio * candidateScoreGeometricMeanToMeanRatio === medianToMeanRatio.
 * For n=2: (w+r)/(2*sqrt(wr)) — same as candidateScoreMeanToGeometricMeanRatio for n=2 (median = AM when n=2).
 * Identity: candidateScoreMedianToGeometricMeanRatio * candidateScoreGeometricMean === medianCandidateScore.
 *
 * Covered:
 *   14141414-1: present when >= 2 candidates, all scores > 0, and medianCandidateScore > 0
 *   14141414-2: > 0 and finite when present
 *   14141414-3: three-way chain — ratio * candidateScoreGeometricMeanToMeanRatio === medianToMeanRatio
 *   14141414-4: for n=2 equals (w+r)/(2*sqrt(wr))
 *   14141414-5: absent on cast:no_match
 *   14141414-6: absent when only 1 candidate
 *   14141414-7: identity — candidateScoreMedianToGeometricMeanRatio * candidateScoreGeometricMean === medianCandidateScore
 *   14141414-8: tool description documents candidateScoreMedianToGeometricMeanRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-14141414-${label}-${Date.now()}.jsonl`);
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

test('14141414-1: present when >= 2 candidates, all scores > 0, and medianCandidateScore > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('oo1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreGeometricMean' in explanation && explanation.candidateScoreGeometricMean > 0 &&
        'medianCandidateScore' in explanation && explanation.medianCandidateScore > 0) {
      assert.ok('candidateScoreMedianToGeometricMeanRatio' in explanation,
        `candidateScoreMedianToGeometricMeanRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreMedianToGeometricMeanRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('14141414-2: > 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('oo2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMedianToGeometricMeanRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreMedianToGeometricMeanRatio),
        `should be finite, got ${explanation.candidateScoreMedianToGeometricMeanRatio}`,
      );
      assert.ok(
        explanation.candidateScoreMedianToGeometricMeanRatio > 0,
        `should be > 0, got ${explanation.candidateScoreMedianToGeometricMeanRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('14141414-3: three-way chain — ratio * candidateScoreGeometricMeanToMeanRatio === medianToMeanRatio', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('oo3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMedianToGeometricMeanRatio' in explanation &&
        'candidateScoreGeometricMeanToMeanRatio' in explanation &&
        'medianToMeanRatio' in explanation) {
      const product = explanation.candidateScoreMedianToGeometricMeanRatio * explanation.candidateScoreGeometricMeanToMeanRatio;
      assert.ok(
        Math.abs(product - explanation.medianToMeanRatio) < 1e-9,
        `median/GM * GM/AM (${product}) should equal medianToMeanRatio (${explanation.medianToMeanRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('14141414-4: for n=2 equals (w+r)/(2*sqrt(wr))', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('oo4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMedianToGeometricMeanRatio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0 && explanation.runnerUpScore > 0) {
      const w = explanation.winnerScore;
      const ru = explanation.runnerUpScore;
      const expected = (w + ru) / (2 * Math.sqrt(w * ru));
      assert.ok(
        Math.abs(explanation.candidateScoreMedianToGeometricMeanRatio - expected) < 1e-9,
        `candidateScoreMedianToGeometricMeanRatio (${explanation.candidateScoreMedianToGeometricMeanRatio}) should equal (w+r)/(2*sqrt(wr)) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('14141414-5: absent on cast:no_match', async () => {
  const path = dlqPath('oo5');
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
      !('candidateScoreMedianToGeometricMeanRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.candidateScoreMedianToGeometricMeanRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('14141414-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('oo6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreMedianToGeometricMeanRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.candidateScoreMedianToGeometricMeanRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('14141414-7: identity — candidateScoreMedianToGeometricMeanRatio * candidateScoreGeometricMean === medianCandidateScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('oo7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMedianToGeometricMeanRatio' in explanation && 'candidateScoreGeometricMean' in explanation && 'medianCandidateScore' in explanation) {
      const product = explanation.candidateScoreMedianToGeometricMeanRatio * explanation.candidateScoreGeometricMean;
      assert.ok(
        Math.abs(product - explanation.medianCandidateScore) < 1e-9,
        `candidateScoreMedianToGeometricMeanRatio * candidateScoreGeometricMean (${product}) should equal medianCandidateScore (${explanation.medianCandidateScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('14141414-8: tool description documents candidateScoreMedianToGeometricMeanRatio', async () => {
  const path = dlqPath('oo8');
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
      cast.description?.includes('candidateScoreMedianToGeometricMeanRatio'),
      `cast description should mention candidateScoreMedianToGeometricMeanRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
