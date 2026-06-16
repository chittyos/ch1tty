/**
 * 23232323: explanation.candidateScoreLowestToMeanRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreLowestToMeanRatio: number — ratio of lowest candidate score to pool mean:
 * lowestCandidateScore / candidateScoreMean.
 *
 * Present when: >= 2 candidates and candidateScoreEntropyTotal > 0 (mean > 0).
 * Absent when: no_match, single candidate, or all candidates scored 0.
 * Always in [0, 1]: lowest score <= mean always; equality when all scores identical.
 * Always >= lowestCandidateScoreRatio (lowest/winner): mean <= winner so lowest/mean >= lowest/winner.
 * For n=2: lowestCandidateScore = runnerUpScore = r; mean = (w+r)/2; ratio = 2r/(w+r).
 * Identity: candidateScoreLowestToMeanRatio * candidateScoreMean === lowestCandidateScore.
 *
 * Covered:
 *   23232323-1: present when >= 2 candidates and mean > 0
 *   23232323-2: always in [0, 1] when present
 *   23232323-3: always >= lowestCandidateScoreRatio when both present
 *   23232323-4: for n=2 equals 2r/(w+r)
 *   23232323-5: absent on cast:no_match
 *   23232323-6: absent when only 1 candidate
 *   23232323-7: identity — candidateScoreLowestToMeanRatio * candidateScoreMean === lowestCandidateScore
 *   23232323-8: tool description documents candidateScoreLowestToMeanRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-23232323-${label}-${Date.now()}.jsonl`);
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

test('23232323-1: present when >= 2 candidates and mean > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('xx1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreMean' in explanation && explanation.candidateScoreMean > 0) {
      assert.ok('candidateScoreLowestToMeanRatio' in explanation,
        `candidateScoreLowestToMeanRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreLowestToMeanRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('23232323-2: always in [0, 1] when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('xx2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreLowestToMeanRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreLowestToMeanRatio),
        `should be finite, got ${explanation.candidateScoreLowestToMeanRatio}`,
      );
      assert.ok(
        explanation.candidateScoreLowestToMeanRatio >= 0,
        `should be >= 0, got ${explanation.candidateScoreLowestToMeanRatio}`,
      );
      assert.ok(
        explanation.candidateScoreLowestToMeanRatio <= 1,
        `should be <= 1, got ${explanation.candidateScoreLowestToMeanRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('23232323-3: always >= lowestCandidateScoreRatio when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('xx3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreLowestToMeanRatio' in explanation && 'lowestCandidateScoreRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreLowestToMeanRatio >= explanation.lowestCandidateScoreRatio - 1e-9,
        `candidateScoreLowestToMeanRatio (${explanation.candidateScoreLowestToMeanRatio}) should be >= lowestCandidateScoreRatio (${explanation.lowestCandidateScoreRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('23232323-4: for n=2 equals 2r/(w+r)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('xx4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreLowestToMeanRatio' in explanation && explanation.candidateCount === 2 &&
        explanation.winnerScore > 0 && explanation.runnerUpScore >= 0) {
      const w = explanation.winnerScore;
      const r2 = explanation.runnerUpScore;
      const expected = (2 * r2) / (w + r2);
      assert.ok(
        Math.abs(explanation.candidateScoreLowestToMeanRatio - expected) < 1e-9,
        `candidateScoreLowestToMeanRatio (${explanation.candidateScoreLowestToMeanRatio}) should equal 2r/(w+r) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('23232323-5: absent on cast:no_match', async () => {
  const path = dlqPath('xx5');
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
      !('candidateScoreLowestToMeanRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.candidateScoreLowestToMeanRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('23232323-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('xx6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreLowestToMeanRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.candidateScoreLowestToMeanRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('23232323-7: identity — candidateScoreLowestToMeanRatio * candidateScoreMean === lowestCandidateScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('xx7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreLowestToMeanRatio' in explanation &&
        'candidateScoreMean' in explanation &&
        'lowestCandidateScore' in explanation) {
      const product = explanation.candidateScoreLowestToMeanRatio * explanation.candidateScoreMean;
      assert.ok(
        Math.abs(product - explanation.lowestCandidateScore) < 1e-9,
        `candidateScoreLowestToMeanRatio * candidateScoreMean (${product}) should equal lowestCandidateScore (${explanation.lowestCandidateScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('23232323-8: tool description documents candidateScoreLowestToMeanRatio', async () => {
  const path = dlqPath('xx8');
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
      cast.description?.includes('candidateScoreLowestToMeanRatio'),
      `cast description should mention candidateScoreLowestToMeanRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
