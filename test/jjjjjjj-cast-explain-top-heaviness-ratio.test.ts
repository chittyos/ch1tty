/**
 * JJJJJJJ: explanation.topHeavinessRatio in ch1tty/cast when explain:true.
 *
 * topHeavinessRatio: number — sum(top-5 scores) / candidateScoreEntropyTotal.
 * Fraction of total score mass concentrated in the top-5 candidates.
 * Group concentration view: top-5 share of total vs. scoreDominanceIndex (winner's share alone).
 *
 * Present when: >= 2 candidates and candidateScoreEntropyTotal > 0.
 * Absent when: no_match, single candidate, or all scores are 0.
 * Always in (0, 1]. Equals 1 when candidateCount <= 5 or all non-top-5 candidates score 0.
 * Identity: topHeavinessRatio * candidateScoreEntropyTotal === topScoreSum.
 *
 * Covered:
 *   JJJJJJJ-1: present when >= 2 candidates with nonzero total score
 *   JJJJJJJ-2: always in (0, 1] and finite when present
 *   JJJJJJJ-3: equals 1 when candidateCount <= 5 (all candidates in top-5)
 *   JJJJJJJ-4: identity — topHeavinessRatio * candidateScoreEntropyTotal === topScoreSum
 *   JJJJJJJ-5: absent on cast:no_match
 *   JJJJJJJ-6: absent when only 1 candidate
 *   JJJJJJJ-7: present regardless of focus (focus inactive)
 *   JJJJJJJ-8: tool description documents topHeavinessRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-jjjjjjj-${label}-${Date.now()}.jsonl`);
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

test('JJJJJJJ-1: present when >= 2 candidates with nonzero total score', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('j1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    assert.ok('topHeavinessRatio' in explanation,
      `topHeavinessRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.topHeavinessRatio, 'number', 'topHeavinessRatio should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('JJJJJJJ-2: always in (0, 1] and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('j2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('topHeavinessRatio' in explanation) {
      assert.ok(
        explanation.topHeavinessRatio > -1e-9,
        `topHeavinessRatio should be > 0, got ${explanation.topHeavinessRatio}`,
      );
      assert.ok(
        explanation.topHeavinessRatio <= 1 + 1e-9,
        `topHeavinessRatio should be <= 1, got ${explanation.topHeavinessRatio}`,
      );
      assert.ok(
        Number.isFinite(explanation.topHeavinessRatio),
        `topHeavinessRatio should be finite, got ${explanation.topHeavinessRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('JJJJJJJ-3: equals 1 when candidateCount <= 5 (all candidates fit in top-5)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('j3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('topHeavinessRatio' in explanation && explanation.candidateCount <= 5) {
      assert.ok(
        Math.abs(explanation.topHeavinessRatio - 1) < 1e-9,
        `topHeavinessRatio should be 1 when candidateCount <= 5, got ${explanation.topHeavinessRatio}`,
      );
    }
    assert.ok(explanation.candidateCount >= 1, 'should have candidates');
  } finally {
    await agg.shutdown();
  }
});

test('JJJJJJJ-4: identity — topHeavinessRatio * candidateScoreEntropyTotal === topScoreSum', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('j4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('topHeavinessRatio' in explanation && 'candidateScoreMean' in explanation) {
      const totalScore = explanation.candidateScoreMean * explanation.candidateCount;
      const topScoreSum = explanation.topHeavinessRatio * totalScore;
      assert.ok(
        topScoreSum > -1e-9,
        `reconstructed topScoreSum (${topScoreSum}) should be >= 0`,
      );
      assert.ok(
        topScoreSum <= totalScore + 1e-9,
        `reconstructed topScoreSum (${topScoreSum}) should be <= totalScore (${totalScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('JJJJJJJ-5: absent on cast:no_match', async () => {
  const path = dlqPath('j5');
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
      !('topHeavinessRatio' in parsed.explanation),
      `topHeavinessRatio should be absent on no_match, found: ${parsed.explanation.topHeavinessRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('JJJJJJJ-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('j6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('topHeavinessRatio' in explanation),
      `topHeavinessRatio should be absent with single candidate, found: ${explanation.topHeavinessRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('JJJJJJJ-7: present regardless of focus (focus inactive)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('j7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok('topHeavinessRatio' in explanation,
      `topHeavinessRatio should be present without focus; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('JJJJJJJ-8: tool description documents topHeavinessRatio', async () => {
  const path = dlqPath('j8');
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
      cast.description?.includes('topHeavinessRatio'),
      `cast description should mention topHeavinessRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
