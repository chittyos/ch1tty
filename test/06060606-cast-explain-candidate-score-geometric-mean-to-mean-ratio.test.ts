/**
 * 06060606: explanation.candidateScoreGeometricMeanToMeanRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreGeometricMeanToMeanRatio: number — ratio of geometric mean to arithmetic mean:
 * candidateScoreGeometricMean / candidateScoreMean.
 *
 * Present when: >= 2 candidates, all scores > 0, and candidateScoreMean > 0.
 * Absent when: no_match, single candidate, any score === 0, or mean === 0.
 * Always in (0, 1] by AM-GM inequality.
 * Identity: candidateScoreGeometricMeanToMeanRatio * candidateScoreMean === candidateScoreGeometricMean.
 * For n=2: 2*sqrt(w*r) / (w+r).
 *
 * Covered:
 *   06060606-1: present when >= 2 candidates, all scores > 0, and candidateScoreMean > 0
 *   06060606-2: in (0, 1] and finite when present
 *   06060606-3: <= 1 precisely (AM >= GM invariant)
 *   06060606-4: for n=2 equals 2*sqrt(w*r)/(w+r)
 *   06060606-5: absent on cast:no_match
 *   06060606-6: absent when only 1 candidate
 *   06060606-7: identity — candidateScoreGeometricMeanToMeanRatio * candidateScoreMean === candidateScoreGeometricMean
 *   06060606-8: tool description documents candidateScoreGeometricMeanToMeanRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-06060606-${label}-${Date.now()}.jsonl`);
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

test('06060606-1: present when >= 2 candidates, all scores > 0, and candidateScoreMean > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('gg1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreGeometricMean' in explanation && explanation.candidateScoreGeometricMean > 0 && explanation.candidateScoreMean > 0) {
      assert.ok('candidateScoreGeometricMeanToMeanRatio' in explanation,
        `candidateScoreGeometricMeanToMeanRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreGeometricMeanToMeanRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('06060606-2: in (0, 1] and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('gg2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreGeometricMeanToMeanRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreGeometricMeanToMeanRatio),
        `should be finite, got ${explanation.candidateScoreGeometricMeanToMeanRatio}`,
      );
      assert.ok(
        explanation.candidateScoreGeometricMeanToMeanRatio > 0,
        `should be > 0, got ${explanation.candidateScoreGeometricMeanToMeanRatio}`,
      );
      assert.ok(
        explanation.candidateScoreGeometricMeanToMeanRatio <= 1 + 1e-9,
        `should be <= 1 (AM >= GM), got ${explanation.candidateScoreGeometricMeanToMeanRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('06060606-3: <= 1 precisely — AM >= GM invariant', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('gg3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreGeometricMeanToMeanRatio' in explanation && 'candidateScoreGeometricMean' in explanation && 'candidateScoreMean' in explanation) {
      assert.ok(
        explanation.candidateScoreGeometricMean <= explanation.candidateScoreMean + 1e-9,
        `geometric mean (${explanation.candidateScoreGeometricMean}) should be <= arithmetic mean (${explanation.candidateScoreMean}) by AM-GM`,
      );
      assert.ok(
        explanation.candidateScoreGeometricMeanToMeanRatio <= 1 + 1e-9,
        `ratio (${explanation.candidateScoreGeometricMeanToMeanRatio}) should be <= 1`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('06060606-4: for n=2 equals 2*sqrt(w*r)/(w+r)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('gg4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreGeometricMeanToMeanRatio' in explanation && explanation.candidateCount === 2) {
      const w = explanation.winnerScore;
      const ru = explanation.runnerUpScore;
      const expected = (2 * Math.sqrt(w * ru)) / (w + ru);
      assert.ok(
        Math.abs(explanation.candidateScoreGeometricMeanToMeanRatio - expected) < 1e-9,
        `candidateScoreGeometricMeanToMeanRatio (${explanation.candidateScoreGeometricMeanToMeanRatio}) should equal 2*sqrt(w*r)/(w+r) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('06060606-5: absent on cast:no_match', async () => {
  const path = dlqPath('gg5');
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
      !('candidateScoreGeometricMeanToMeanRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.candidateScoreGeometricMeanToMeanRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('06060606-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('gg6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreGeometricMeanToMeanRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.candidateScoreGeometricMeanToMeanRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('06060606-7: identity — candidateScoreGeometricMeanToMeanRatio * candidateScoreMean === candidateScoreGeometricMean', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('gg7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreGeometricMeanToMeanRatio' in explanation && 'candidateScoreMean' in explanation && 'candidateScoreGeometricMean' in explanation) {
      const product = explanation.candidateScoreGeometricMeanToMeanRatio * explanation.candidateScoreMean;
      assert.ok(
        Math.abs(product - explanation.candidateScoreGeometricMean) < 1e-9,
        `candidateScoreGeometricMeanToMeanRatio * candidateScoreMean (${product}) should equal candidateScoreGeometricMean (${explanation.candidateScoreGeometricMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('06060606-8: tool description documents candidateScoreGeometricMeanToMeanRatio', async () => {
  const path = dlqPath('gg8');
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
      cast.description?.includes('candidateScoreGeometricMeanToMeanRatio'),
      `cast description should mention candidateScoreGeometricMeanToMeanRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
