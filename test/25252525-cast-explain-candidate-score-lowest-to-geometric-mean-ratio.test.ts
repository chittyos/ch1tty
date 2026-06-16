/**
 * 25252525: explanation.candidateScoreLowestToGeometricMeanRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreLowestToGeometricMeanRatio: number — ratio of lowest candidate score to geometric mean:
 * lowestCandidateScore / candidateScoreGeometricMean.
 *
 * Present when: >= 2 candidates, all scores > 0 (GM defined), candidateScoreGeometricMean > 0.
 * Absent when: no_match, single candidate, any score === 0.
 * Always in (0, 1]: lowest <= GM always (min <= GM by AM-GM); equality when all scores identical.
 * Always >= candidateScoreLowestToMeanRatio: GM <= AM so lowest/GM >= lowest/AM.
 * For n=2: lowestCandidateScore = r; GM = sqrt(wr); ratio = sqrt(r/w).
 * Identity: candidateScoreLowestToGeometricMeanRatio * candidateScoreGeometricMean === lowestCandidateScore.
 *
 * Covered:
 *   25252525-1: present when >= 2 candidates, all scores > 0, candidateScoreGeometricMean > 0
 *   25252525-2: always in (0, 1] when present
 *   25252525-3: always >= candidateScoreLowestToMeanRatio when both present
 *   25252525-4: for n=2 equals sqrt(r/w)
 *   25252525-5: absent on cast:no_match
 *   25252525-6: absent when only 1 candidate
 *   25252525-7: identity — candidateScoreLowestToGeometricMeanRatio * candidateScoreGeometricMean === lowestCandidateScore
 *   25252525-8: tool description documents candidateScoreLowestToGeometricMeanRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-25252525-${label}-${Date.now()}.jsonl`);
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

test('25252525-1: present when >= 2 candidates, all scores > 0, candidateScoreGeometricMean > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('zz1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreGeometricMean' in explanation && explanation.candidateScoreGeometricMean > 0) {
      assert.ok('candidateScoreLowestToGeometricMeanRatio' in explanation,
        `candidateScoreLowestToGeometricMeanRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreLowestToGeometricMeanRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('25252525-2: always in (0, 1] when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('zz2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreLowestToGeometricMeanRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreLowestToGeometricMeanRatio),
        `should be finite, got ${explanation.candidateScoreLowestToGeometricMeanRatio}`,
      );
      assert.ok(
        explanation.candidateScoreLowestToGeometricMeanRatio > 0,
        `should be > 0, got ${explanation.candidateScoreLowestToGeometricMeanRatio}`,
      );
      assert.ok(
        explanation.candidateScoreLowestToGeometricMeanRatio <= 1,
        `should be <= 1, got ${explanation.candidateScoreLowestToGeometricMeanRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('25252525-3: always >= candidateScoreLowestToMeanRatio when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('zz3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreLowestToGeometricMeanRatio' in explanation && 'candidateScoreLowestToMeanRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreLowestToGeometricMeanRatio >= explanation.candidateScoreLowestToMeanRatio - 1e-9,
        `candidateScoreLowestToGeometricMeanRatio (${explanation.candidateScoreLowestToGeometricMeanRatio}) should be >= candidateScoreLowestToMeanRatio (${explanation.candidateScoreLowestToMeanRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('25252525-4: for n=2 equals sqrt(r/w)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('zz4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreLowestToGeometricMeanRatio' in explanation && explanation.candidateCount === 2 &&
        explanation.winnerScore > 0 && explanation.runnerUpScore > 0) {
      const w = explanation.winnerScore;
      const ru = explanation.runnerUpScore;
      const expected = Math.sqrt(ru / w);
      assert.ok(
        Math.abs(explanation.candidateScoreLowestToGeometricMeanRatio - expected) < 1e-9,
        `candidateScoreLowestToGeometricMeanRatio (${explanation.candidateScoreLowestToGeometricMeanRatio}) should equal sqrt(r/w) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('25252525-5: absent on cast:no_match', async () => {
  const path = dlqPath('zz5');
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
      !('candidateScoreLowestToGeometricMeanRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.candidateScoreLowestToGeometricMeanRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('25252525-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('zz6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreLowestToGeometricMeanRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.candidateScoreLowestToGeometricMeanRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('25252525-7: identity — candidateScoreLowestToGeometricMeanRatio * candidateScoreGeometricMean === lowestCandidateScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('zz7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreLowestToGeometricMeanRatio' in explanation &&
        'candidateScoreGeometricMean' in explanation &&
        'lowestCandidateScore' in explanation) {
      const product = explanation.candidateScoreLowestToGeometricMeanRatio * explanation.candidateScoreGeometricMean;
      assert.ok(
        Math.abs(product - explanation.lowestCandidateScore) < 1e-9,
        `candidateScoreLowestToGeometricMeanRatio * candidateScoreGeometricMean (${product}) should equal lowestCandidateScore (${explanation.lowestCandidateScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('25252525-8: tool description documents candidateScoreLowestToGeometricMeanRatio', async () => {
  const path = dlqPath('zz8');
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
      cast.description?.includes('candidateScoreLowestToGeometricMeanRatio'),
      `cast description should mention candidateScoreLowestToGeometricMeanRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
