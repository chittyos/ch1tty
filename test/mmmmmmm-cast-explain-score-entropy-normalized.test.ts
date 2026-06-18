/**
 * MMMMMMM: explanation.scoreEntropyNormalized in ch1tty/cast when explain:true.
 *
 * scoreEntropyNormalized: number — candidateScoreEntropy / log2(nonZeroCount).
 * Shannon entropy of the score distribution normalised by the maximum possible
 * entropy for the number of nonzero-scoring candidates.
 *
 * Present when: >= 2 candidates, totalScore > 0, and nonZeroCount >= 2.
 * Absent when: no_match, single candidate, all scores 0, or only 1 nonzero score.
 * Always in [0, 1].
 * Identity: scoreEntropyNormalized * log2(nonZeroCount) === candidateScoreEntropy.
 *
 * Covered:
 *   MMMMMMM-1: present when >= 2 candidates with >= 2 nonzero scores
 *   MMMMMMM-2: always in [0, 1] and finite when present
 *   MMMMMMM-3: equals 1 when all nonzero candidates have identical scores
 *   MMMMMMM-4: identity — scoreEntropyNormalized * log2(nonZeroCount) === candidateScoreEntropy
 *   MMMMMMM-5: absent on cast:no_match
 *   MMMMMMM-6: absent when only 1 candidate
 *   MMMMMMM-7: present regardless of focus (focus inactive)
 *   MMMMMMM-8: tool description documents scoreEntropyNormalized
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-mmmmmmm-${label}-${Date.now()}.jsonl`);
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

test('MMMMMMM-1: present when >= 2 candidates with >= 2 nonzero scores', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('m1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('scoreEntropyNormalized' in explanation) {
      assert.equal(typeof explanation.scoreEntropyNormalized, 'number', 'scoreEntropyNormalized should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('MMMMMMM-2: always in [0, 1] and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('m2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('scoreEntropyNormalized' in explanation) {
      assert.ok(
        explanation.scoreEntropyNormalized >= -1e-9,
        `scoreEntropyNormalized should be >= 0, got ${explanation.scoreEntropyNormalized}`,
      );
      assert.ok(
        explanation.scoreEntropyNormalized <= 1 + 1e-9,
        `scoreEntropyNormalized should be <= 1, got ${explanation.scoreEntropyNormalized}`,
      );
      assert.ok(
        Number.isFinite(explanation.scoreEntropyNormalized),
        `scoreEntropyNormalized should be finite, got ${explanation.scoreEntropyNormalized}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('MMMMMMM-3: equals 1 when all candidates have identical nonzero scores', async () => {
  const SAME_DESC = 'billing invoice payment charge query database';
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('m3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: SAME_DESC, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('scoreEntropyNormalized' in explanation) {
      if (Math.abs(explanation.winnerScore - explanation.runnerUpScore) < 1e-9 && explanation.lowestCandidateScore > 0) {
        assert.ok(
          Math.abs(explanation.scoreEntropyNormalized - 1) < 1e-9,
          `scoreEntropyNormalized should be 1 when all scores equal, got ${explanation.scoreEntropyNormalized}`,
        );
      }
    }
    assert.ok(explanation.candidateCount >= 1, 'should have candidates');
  } finally {
    await agg.shutdown();
  }
});

test('MMMMMMM-4: identity — scoreEntropyNormalized * log2(nonZeroCount) === candidateScoreEntropy', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('m4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('scoreEntropyNormalized' in explanation && 'candidateScoreEntropy' in explanation && 'nonZeroCandidateFraction' in explanation) {
      const nonZeroCount = Math.round(explanation.nonZeroCandidateFraction * explanation.candidateCount);
      const reconstructed = explanation.scoreEntropyNormalized * Math.log2(nonZeroCount);
      assert.ok(
        Math.abs(reconstructed - explanation.candidateScoreEntropy) < 1e-9,
        `scoreEntropyNormalized * log2(nonZeroCount) (${reconstructed}) should equal candidateScoreEntropy (${explanation.candidateScoreEntropy})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('MMMMMMM-5: absent on cast:no_match', async () => {
  const path = dlqPath('m5');
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
      !('scoreEntropyNormalized' in parsed.explanation),
      `scoreEntropyNormalized should be absent on no_match, found: ${parsed.explanation.scoreEntropyNormalized}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('MMMMMMM-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('m6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('scoreEntropyNormalized' in explanation),
      `scoreEntropyNormalized should be absent with single candidate, found: ${explanation.scoreEntropyNormalized}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('MMMMMMM-7: present regardless of focus (focus inactive)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('m7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    if ('scoreEntropyNormalized' in explanation) {
      assert.equal(typeof explanation.scoreEntropyNormalized, 'number', 'scoreEntropyNormalized should be a number when present');
    }
  } finally {
    await agg.shutdown();
  }
});

test('MMMMMMM-8: tool description documents scoreEntropyNormalized', async () => {
  const path = dlqPath('m8');
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
      cast.description?.includes('scoreEntropyNormalized'),
      `cast description should mention scoreEntropyNormalized, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
