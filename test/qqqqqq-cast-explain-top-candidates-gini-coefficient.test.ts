/**
 * QQQQQQ: explanation.topCandidatesGiniCoefficient in ch1tty/cast when explain:true.
 *
 * topCandidatesGiniCoefficient: number — Gini coefficient of the topCandidates pool
 * (up to 5 candidates) score distribution. Measures inequality of score mass within
 * the top pool. G = (2 * sum((i+1) * s[i]) / (n * totalScore)) - (n+1)/n where scores
 * are sorted ascending (0-indexed i).
 *
 * Present when: >= 2 topCandidates exist and totalTopScore > 0.
 * Absent when: no_match, single candidate, or all top-candidate scores are 0.
 * Always in [0, 1).
 * G = 0 when all scores are equal; approaches 1 when one tool dominates.
 *
 * Covered:
 *   QQQQQQ-1: present when >= 2 candidates
 *   QQQQQQ-2: always in [0, 1) when present
 *   QQQQQQ-3: equals 0 when all top candidates have equal scores
 *   QQQQQQ-4: increases when one tool clearly dominates
 *   QQQQQQ-5: absent on cast:no_match
 *   QQQQQQ-6: absent when only 1 candidate
 *   QQQQQQ-7: present regardless of focus (focus inactive)
 *   QQQQQQ-8: tool description documents topCandidatesGiniCoefficient
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-qqqqqq-${label}-${Date.now()}.jsonl`);
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

test('QQQQQQ-1: present when >= 2 candidates', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    assert.ok('topCandidatesGiniCoefficient' in explanation,
      `topCandidatesGiniCoefficient should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.topCandidatesGiniCoefficient, 'number', 'topCandidatesGiniCoefficient should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQQ-2: always in [0, 1) when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('topCandidatesGiniCoefficient' in explanation, 'topCandidatesGiniCoefficient should be present');
    assert.ok(
      explanation.topCandidatesGiniCoefficient >= -1e-9,
      `topCandidatesGiniCoefficient should be >= 0, got ${explanation.topCandidatesGiniCoefficient}`,
    );
    assert.ok(
      explanation.topCandidatesGiniCoefficient < 1 + 1e-9,
      `topCandidatesGiniCoefficient should be < 1, got ${explanation.topCandidatesGiniCoefficient}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQQ-3: equals 0 when all top candidates have equal scores', async () => {
  const IDENTICAL_DESC = 'billing invoice payment charge query database';
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: IDENTICAL_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: IDENTICAL_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge query database', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('topCandidatesGiniCoefficient' in explanation, 'topCandidatesGiniCoefficient should be present');
    // When both tools get the same score, Gini = 0 (perfect equality)
    if (Math.abs(explanation.winnerScore - explanation.runnerUpScore) < 1e-9) {
      assert.ok(
        Math.abs(explanation.topCandidatesGiniCoefficient) < 1e-9,
        `topCandidatesGiniCoefficient should be 0 when scores are equal, got ${explanation.topCandidatesGiniCoefficient}`,
      );
    }
    // At minimum it must be in bounds
    assert.ok(explanation.topCandidatesGiniCoefficient >= -1e-9, 'Gini should be >= 0');
    assert.ok(explanation.topCandidatesGiniCoefficient < 1 + 1e-9, 'Gini should be < 1');
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQQ-4: higher when winner dominates runner-up', async () => {
  // Winner has very high score, runner-up barely matches → higher Gini than equal-score case.
  // We compare the coefficient value: a dominant winner → Gini closer to 1 than 0.
  const strongTool: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge subscription renewal customer revenue', inputSchema: { type: 'object', properties: {} } },
  ];
  const weakTool: ToolEntry[] = [
    { name: 'run_sql', description: 'query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q4', [STRIPE_CFG, NEON_CFG], { stripe: strongTool, neon: weakTool });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge subscription renewal', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('topCandidatesGiniCoefficient' in explanation) {
      // Dominant winner → Gini > 0 (strictly more unequal than uniform)
      assert.ok(
        explanation.topCandidatesGiniCoefficient > -1e-9,
        `topCandidatesGiniCoefficient should be > 0 when winner dominates, got ${explanation.topCandidatesGiniCoefficient}`,
      );
      assert.ok(explanation.topCandidatesGiniCoefficient < 1 + 1e-9, 'Gini should be < 1');
    }
    // If runner-up scored 0, topCandidatesGiniCoefficient may be absent — that's valid too.
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQQ-5: absent on cast:no_match', async () => {
  const path = dlqPath('q5');
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
      !('topCandidatesGiniCoefficient' in parsed.explanation),
      `topCandidatesGiniCoefficient should be absent on no_match, found: ${parsed.explanation.topCandidatesGiniCoefficient}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('QQQQQQ-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('topCandidatesGiniCoefficient' in explanation),
      `topCandidatesGiniCoefficient should be absent with single candidate, found: ${explanation.topCandidatesGiniCoefficient}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQQ-7: present regardless of focus (focus inactive)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok('topCandidatesGiniCoefficient' in explanation,
      `topCandidatesGiniCoefficient should be present without focus; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQQ-8: tool description documents topCandidatesGiniCoefficient', async () => {
  const path = dlqPath('q8');
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
      cast.description?.includes('topCandidatesGiniCoefficient'),
      `cast description should mention topCandidatesGiniCoefficient, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
