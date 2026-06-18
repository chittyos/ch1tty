/**
 * AAAAAAAA: explanation.candidateScoreRobustSkewness in ch1tty/cast when explain:true.
 *
 * candidateScoreRobustSkewness: number — Pearson's 2nd skewness coefficient:
 * 3 * (mean - median) / stdDev.
 *
 * Present when: >= 2 candidates and candidateScoreStdDev > 0.
 * Absent when: no_match, single candidate, or all scores identical (stdDev = 0).
 * Can be positive (right-skewed), zero (symmetric), or negative (left-skewed).
 * |candidateScoreRobustSkewness| <= sqrt(3) always (Pearson's bound).
 * For n=2: always 0 (mean === median for exactly 2 values).
 * Identity: === 3 * (candidateScoreMean - medianCandidateScore) / candidateScoreStdDev.
 *
 * Covered:
 *   AAAAAAAA-1: present when >= 2 candidates with nonzero stddev
 *   AAAAAAAA-2: finite and within Pearson's bound (|value| <= sqrt(3))
 *   AAAAAAAA-3: for n=2 always equals 0
 *   AAAAAAAA-4: identity — equals 3*(mean-median)/stddev
 *   AAAAAAAA-5: absent on cast:no_match
 *   AAAAAAAA-6: absent when only 1 candidate
 *   AAAAAAAA-7: absent when all scores identical (stddev = 0)
 *   AAAAAAAA-8: tool description documents candidateScoreRobustSkewness
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-aaaaaaaa-${label}-${Date.now()}.jsonl`);
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

test('AAAAAAAA-1: present when >= 2 candidates with nonzero stddev', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('a1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if (explanation.candidateScoreStdDev > 0) {
      assert.ok('candidateScoreRobustSkewness' in explanation,
        `candidateScoreRobustSkewness should be present when stddev > 0; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreRobustSkewness, 'number', 'candidateScoreRobustSkewness should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('AAAAAAAA-2: finite and within Pearson bound (|value| <= sqrt(3))', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('a2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreRobustSkewness' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreRobustSkewness),
        `candidateScoreRobustSkewness should be finite, got ${explanation.candidateScoreRobustSkewness}`,
      );
      assert.ok(
        Math.abs(explanation.candidateScoreRobustSkewness) <= Math.sqrt(3) + 1e-9,
        `|candidateScoreRobustSkewness| (${Math.abs(explanation.candidateScoreRobustSkewness)}) should be <= sqrt(3) (${Math.sqrt(3)})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('AAAAAAAA-3: for n=2 always equals 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('a3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreRobustSkewness' in explanation && explanation.candidateCount === 2) {
      assert.ok(
        Math.abs(explanation.candidateScoreRobustSkewness) < 1e-9,
        `candidateScoreRobustSkewness (${explanation.candidateScoreRobustSkewness}) should be 0 for n=2 (mean equals median)`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('AAAAAAAA-4: identity — equals 3*(candidateScoreMean - medianCandidateScore)/candidateScoreStdDev', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('a4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if (
      'candidateScoreRobustSkewness' in explanation &&
      'candidateScoreMean' in explanation &&
      'medianCandidateScore' in explanation &&
      'candidateScoreStdDev' in explanation &&
      explanation.candidateScoreStdDev > 0
    ) {
      const expected = 3 * (explanation.candidateScoreMean - explanation.medianCandidateScore) / explanation.candidateScoreStdDev;
      assert.ok(
        Math.abs(explanation.candidateScoreRobustSkewness - expected) < 1e-9,
        `candidateScoreRobustSkewness (${explanation.candidateScoreRobustSkewness}) should equal 3*(mean-median)/stddev (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('AAAAAAAA-5: absent on cast:no_match', async () => {
  const path = dlqPath('a5');
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
      !('candidateScoreRobustSkewness' in parsed.explanation),
      `candidateScoreRobustSkewness should be absent on no_match, found: ${parsed.explanation.candidateScoreRobustSkewness}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('AAAAAAAA-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('a6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreRobustSkewness' in explanation),
      `candidateScoreRobustSkewness should be absent with single candidate, found: ${explanation.candidateScoreRobustSkewness}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('AAAAAAAA-7: absent when all scores identical (stddev = 0)', async () => {
  const SAME_DESC = 'billing invoice payment charge query database';
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('a7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: SAME_DESC, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreStdDev' in explanation && Math.abs(explanation.candidateScoreStdDev) < 1e-9) {
      assert.ok(
        !('candidateScoreRobustSkewness' in explanation),
        `candidateScoreRobustSkewness should be absent when stddev=0, found: ${explanation.candidateScoreRobustSkewness}`,
      );
    }
    assert.ok(explanation.candidateCount >= 1, 'should have candidates');
  } finally {
    await agg.shutdown();
  }
});

test('AAAAAAAA-8: tool description documents candidateScoreRobustSkewness', async () => {
  const path = dlqPath('a8');
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
      cast.description?.includes('candidateScoreRobustSkewness'),
      `cast description should mention candidateScoreRobustSkewness, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
