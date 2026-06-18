/**
 * UUUUUU: explanation.candidateScoreSkewness in ch1tty/cast when explain:true.
 *
 * candidateScoreSkewness: number — third standardised moment of the full candidate
 * pool. skewness = (1/n) * sum((x_i - mean)^3) / stddev^3 over all scored tools.
 *
 * Present when: >= 2 candidates and full-pool stddev > 0.
 * Absent when: no_match, single candidate, or all candidates score identically.
 * Positive = tail toward higher scores; negative = tail toward lower scores.
 *
 * Covered:
 *   UUUUUU-1: present when >= 2 candidates with distinct scores
 *   UUUUUU-2: absent when all candidate scores are identical (stddev === 0)
 *   UUUUUU-3: is a finite number when present
 *   UUUUUU-4: same sign as topCandidatesScoreSkewness when candidateCount <= 5
 *   UUUUUU-5: absent on cast:no_match
 *   UUUUUU-6: absent when only 1 candidate
 *   UUUUUU-7: present regardless of focus (focus inactive)
 *   UUUUUU-8: tool description documents candidateScoreSkewness
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-uuuuuu-${label}-${Date.now()}.jsonl`);
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

test('UUUUUU-1: present when >= 2 candidates with distinct scores', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('u1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    // Only assert presence if scores differ (stddev > 0)
    if ((explanation.topCandidatesScoreVariance ?? 0) > 1e-18) {
      assert.ok('candidateScoreSkewness' in explanation,
        `candidateScoreSkewness should be present when stddev > 0; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreSkewness, 'number', 'candidateScoreSkewness should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('UUUUUU-2: absent when all candidate scores are identical (stddev === 0)', async () => {
  const IDENTICAL = 'billing invoice payment charge query database finance';
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: IDENTICAL, inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: IDENTICAL, inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('u2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: IDENTICAL, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    // If scores are equal, stddev = 0 → candidateScoreSkewness absent
    if (Math.abs((explanation.topCandidatesScoreVariance ?? 1)) < 1e-18) {
      assert.ok(
        !('candidateScoreSkewness' in explanation),
        `candidateScoreSkewness should be absent when all scores equal, found: ${explanation.candidateScoreSkewness}`,
      );
    }
    assert.ok(explanation.candidateCount >= 1, 'should have candidates');
  } finally {
    await agg.shutdown();
  }
});

test('UUUUUU-3: is a finite number when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('u3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreSkewness' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreSkewness),
        `candidateScoreSkewness should be a finite number, got ${explanation.candidateScoreSkewness}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('UUUUUU-4: same sign as topCandidatesScoreSkewness when candidateCount <= 5', async () => {
  // When all candidates fit in topCandidates, both skewness values use the same data → same sign.
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('u4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount <= 5, 'test requires candidateCount <= 5');
    if ('candidateScoreSkewness' in explanation && 'topCandidatesScoreSkewness' in explanation) {
      // Same pool → values should be equal (or both zero)
      assert.ok(
        Math.abs(explanation.candidateScoreSkewness - explanation.topCandidatesScoreSkewness) < 1e-9,
        `candidateScoreSkewness (${explanation.candidateScoreSkewness}) should equal topCandidatesScoreSkewness (${explanation.topCandidatesScoreSkewness}) when candidateCount <= 5`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('UUUUUU-5: absent on cast:no_match', async () => {
  const path = dlqPath('u5');
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
      !('candidateScoreSkewness' in parsed.explanation),
      `candidateScoreSkewness should be absent on no_match, found: ${parsed.explanation.candidateScoreSkewness}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('UUUUUU-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('u6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreSkewness' in explanation),
      `candidateScoreSkewness should be absent with single candidate, found: ${explanation.candidateScoreSkewness}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('UUUUUU-7: present regardless of focus (focus inactive)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('u7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    // Only assert presence if stddev > 0
    if ((explanation.topCandidatesScoreVariance ?? 0) > 1e-18) {
      assert.ok('candidateScoreSkewness' in explanation,
        `candidateScoreSkewness should be present without focus when stddev > 0; keys: ${Object.keys(explanation).join(', ')}`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('UUUUUU-8: tool description documents candidateScoreSkewness', async () => {
  const path = dlqPath('u8');
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
      cast.description?.includes('candidateScoreSkewness'),
      `cast description should mention candidateScoreSkewness, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
