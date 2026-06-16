/**
 * TTTTTTT: explanation.candidateScoreGeometricMean in ch1tty/cast when explain:true.
 *
 * candidateScoreGeometricMean: number — geometric mean of nonzero candidate scores.
 * exp(mean(log(nonzero scores))). Less sensitive to outliers than arithmetic mean.
 *
 * Present when: >= 2 candidates and candidateScoreEntropyTotal > 0.
 * Absent when: no_match, single candidate, or all scores zero.
 * Always > 0.
 * Always <= arithmetic mean of nonzero scores (AM-GM inequality).
 * When all scores nonzero: candidateScoreGeometricMean <= candidateScoreMean.
 *
 * Covered:
 *   TTTTTTT-1: present when >= 2 candidates with nonzero total
 *   TTTTTTT-2: always > 0 and finite when present
 *   TTTTTTT-3: equals candidateScoreMean when all scores identical (AM-GM equality)
 *   TTTTTTT-4: always <= candidateScoreMean when all candidates have nonzero scores
 *   TTTTTTT-5: absent on cast:no_match
 *   TTTTTTT-6: absent when only 1 candidate
 *   TTTTTTT-7: always <= winnerScore (geometric mean <= maximum)
 *   TTTTTTT-8: tool description documents candidateScoreGeometricMean
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-ttttttt-${label}-${Date.now()}.jsonl`);
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

test('TTTTTTT-1: present when >= 2 candidates with nonzero total', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    assert.ok('candidateScoreGeometricMean' in explanation,
      `candidateScoreGeometricMean should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.candidateScoreGeometricMean, 'number', 'candidateScoreGeometricMean should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('TTTTTTT-2: always > 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreGeometricMean' in explanation) {
      assert.ok(
        explanation.candidateScoreGeometricMean > 0,
        `candidateScoreGeometricMean should be > 0, got ${explanation.candidateScoreGeometricMean}`,
      );
      assert.ok(
        Number.isFinite(explanation.candidateScoreGeometricMean),
        `candidateScoreGeometricMean should be finite, got ${explanation.candidateScoreGeometricMean}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('TTTTTTT-3: equals candidateScoreMean when all candidates have identical scores', async () => {
  const SAME_DESC = 'billing invoice payment charge query database';
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: SAME_DESC, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreGeometricMean' in explanation && 'candidateScoreMean' in explanation) {
      if (Math.abs(explanation.candidateScoreSpread) < 1e-9 && explanation.lowestCandidateScore > 0) {
        assert.ok(
          Math.abs(explanation.candidateScoreGeometricMean - explanation.candidateScoreMean) < 1e-6,
          `geometric mean (${explanation.candidateScoreGeometricMean}) should equal arithmetic mean (${explanation.candidateScoreMean}) when all scores identical`,
        );
      }
    }
    assert.ok(explanation.candidateCount >= 1, 'should have candidates');
  } finally {
    await agg.shutdown();
  }
});

test('TTTTTTT-4: always <= candidateScoreMean when all candidates have nonzero scores', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if (
      'candidateScoreGeometricMean' in explanation &&
      'candidateScoreMean' in explanation &&
      'nonZeroCandidateFraction' in explanation &&
      Math.abs(explanation.nonZeroCandidateFraction - 1) < 1e-9
    ) {
      assert.ok(
        explanation.candidateScoreGeometricMean <= explanation.candidateScoreMean + 1e-9,
        `geometric mean (${explanation.candidateScoreGeometricMean}) should be <= arithmetic mean (${explanation.candidateScoreMean}) by AM-GM`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('TTTTTTT-5: absent on cast:no_match', async () => {
  const path = dlqPath('t5');
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
      !('candidateScoreGeometricMean' in parsed.explanation),
      `candidateScoreGeometricMean should be absent on no_match, found: ${parsed.explanation.candidateScoreGeometricMean}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('TTTTTTT-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreGeometricMean' in explanation),
      `candidateScoreGeometricMean should be absent with single candidate, found: ${explanation.candidateScoreGeometricMean}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('TTTTTTT-7: always <= winnerScore (geometric mean <= maximum)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreGeometricMean' in explanation && 'winnerScore' in explanation) {
      assert.ok(
        explanation.candidateScoreGeometricMean <= explanation.winnerScore + 1e-9,
        `geometric mean (${explanation.candidateScoreGeometricMean}) should be <= winnerScore (${explanation.winnerScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('TTTTTTT-8: tool description documents candidateScoreGeometricMean', async () => {
  const path = dlqPath('t8');
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
      cast.description?.includes('candidateScoreGeometricMean'),
      `cast description should mention candidateScoreGeometricMean, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
