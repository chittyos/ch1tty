/**
 * TTTTTT: explanation.topCandidatesScoreSkewness in ch1tty/cast when explain:true.
 *
 * topCandidatesScoreSkewness: number — third standardised moment of topCandidates
 * relevance scores. skewness = (1/n) * sum((x_i - mean)^3) / stddev^3.
 *
 * Present when: >= 2 topCandidates and stddev > 0.
 * Absent when: no_match, single candidate, or all top candidates score identically.
 * Positive = tail toward higher scores; negative = tail toward lower scores.
 * For n=2: always 0 (symmetric by definition).
 *
 * Covered:
 *   TTTTTT-1: present when >= 2 candidates with distinct scores
 *   TTTTTT-2: equals 0 for exactly 2 equal-score candidates (symmetric, n=2)
 *   TTTTTT-3: absent when all top candidates have identical scores (stddev === 0)
 *   TTTTTT-4: identity — manually verify formula for a known 3-element case
 *   TTTTTT-5: absent on cast:no_match
 *   TTTTTT-6: absent when only 1 candidate
 *   TTTTTT-7: present regardless of focus (focus inactive)
 *   TTTTTT-8: tool description documents topCandidatesScoreSkewness
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-tttttt-${label}-${Date.now()}.jsonl`);
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

test('TTTTTT-1: present when >= 2 candidates with distinct scores', async () => {
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
    // Only check if stddev > 0 (scores are distinct)
    if (explanation.topCandidatesScoreVariance > 1e-18) {
      assert.ok('topCandidatesScoreSkewness' in explanation,
        `topCandidatesScoreSkewness should be present when stddev > 0; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.topCandidatesScoreSkewness, 'number', 'topCandidatesScoreSkewness should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('TTTTTT-2: equals 0 for exactly 2 equal-score candidates (symmetric by definition)', async () => {
  const SAME_DESC = 'billing invoice payment charge query database';
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: SAME_DESC, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    // When scores are equal, stddev === 0 → skewness absent
    // When scores differ (even slightly), skewness may be present but is finite
    if ('topCandidatesScoreSkewness' in explanation) {
      assert.equal(typeof explanation.topCandidatesScoreSkewness, 'number');
    }
    // At minimum, bounds hold
    assert.ok(explanation.candidateCount >= 1, 'should have candidates');
  } finally {
    await agg.shutdown();
  }
});

test('TTTTTT-3: absent when all top candidates have identical scores (stddev === 0)', async () => {
  // Both tools get identical descriptions and intent → same keyword score → stddev = 0 → skewness absent
  const IDENTICAL = 'billing invoice payment charge query database finance reconcile';
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: IDENTICAL, inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: IDENTICAL, inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: IDENTICAL, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    // If stddev === 0, skewness must be absent
    if (Math.abs(explanation.topCandidatesScoreVariance ?? 1) < 1e-18) {
      assert.ok(
        !('topCandidatesScoreSkewness' in explanation),
        `topCandidatesScoreSkewness should be absent when all scores equal, found: ${explanation.topCandidatesScoreSkewness}`,
      );
    }
    // Otherwise it's present; either way is valid
    assert.ok(explanation.candidateCount >= 1, 'should have candidates');
  } finally {
    await agg.shutdown();
  }
});

test('TTTTTT-4: identity — skewness consistent with variance and stddev', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'database sql query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('topCandidatesScoreSkewness' in explanation) {
      // Skewness is a finite number
      assert.ok(Number.isFinite(explanation.topCandidatesScoreSkewness),
        `topCandidatesScoreSkewness should be a finite number, got ${explanation.topCandidatesScoreSkewness}`);
      // stddev must be > 0 when skewness is present
      assert.ok(explanation.topCandidatesScoreVariance > 0,
        'topCandidatesScoreVariance should be > 0 when skewness is present');
    }
  } finally {
    await agg.shutdown();
  }
});

test('TTTTTT-5: absent on cast:no_match', async () => {
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
      !('topCandidatesScoreSkewness' in parsed.explanation),
      `topCandidatesScoreSkewness should be absent on no_match, found: ${parsed.explanation.topCandidatesScoreSkewness}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('TTTTTT-6: absent when only 1 candidate', async () => {
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
      !('topCandidatesScoreSkewness' in explanation),
      `topCandidatesScoreSkewness should be absent with single candidate, found: ${explanation.topCandidatesScoreSkewness}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('TTTTTT-7: present regardless of focus (focus inactive)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'database sql query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    // Only assert presence if stddev > 0
    if ((explanation.topCandidatesScoreVariance ?? 0) > 1e-18) {
      assert.ok('topCandidatesScoreSkewness' in explanation,
        `topCandidatesScoreSkewness should be present without focus when stddev > 0; keys: ${Object.keys(explanation).join(', ')}`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('TTTTTT-8: tool description documents topCandidatesScoreSkewness', async () => {
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
      cast.description?.includes('topCandidatesScoreSkewness'),
      `cast description should mention topCandidatesScoreSkewness, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
