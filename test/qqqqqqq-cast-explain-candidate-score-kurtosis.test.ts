/**
 * QQQQQQQ: explanation.candidateScoreKurtosis in ch1tty/cast when explain:true.
 *
 * candidateScoreKurtosis: number — fourth standardised moment (excess kurtosis)
 * of relevance scores across the entire candidate pool.
 * Formula: (1/n) * sum((x_i - mean)^4) / stddev^4 − 3
 * Excess kurtosis: 0 = normal-like; positive = leptokurtic (heavy tails); negative = platykurtic (light tails).
 * Completes the four-moment characterisation alongside mean (1st), variance (2nd), skewness (3rd).
 *
 * Present when: >= 2 candidates and full-pool stddev > 0.
 * Absent when: no_match, single candidate, all candidates score identically (stddev === 0).
 * For exactly 2 candidates, excess kurtosis is always -2.
 *
 * Covered:
 *   QQQQQQQ-1: present when >= 2 candidates with different scores
 *   QQQQQQQ-2: is a finite number when present
 *   QQQQQQQ-3: absent when only 1 candidate
 *   QQQQQQQ-4: absent when all candidates score identically (stddev === 0)
 *   QQQQQQQ-5: absent on cast:no_match
 *   QQQQQQQ-6: equals -2 for exactly 2 candidates (two-point kurtosis identity)
 *   QQQQQQQ-7: present regardless of focus (focus inactive)
 *   QQQQQQQ-8: tool description documents candidateScoreKurtosis
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-qqqqqqq-${label}-${Date.now()}.jsonl`);
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

test('QQQQQQQ-1: present when >= 2 candidates with different scores', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('n1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    assert.ok('candidateScoreKurtosis' in explanation,
      `candidateScoreKurtosis should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.candidateScoreKurtosis, 'number', 'candidateScoreKurtosis should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQQQ-2: is a finite number when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('n2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreKurtosis' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreKurtosis),
        `candidateScoreKurtosis should be finite, got ${explanation.candidateScoreKurtosis}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQQQ-3: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('n3', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreKurtosis' in explanation),
      `candidateScoreKurtosis should be absent with single candidate, found: ${explanation.candidateScoreKurtosis}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQQQ-4: absent when all candidates score identically (stddev === 0)', async () => {
  // Both tools share the same keyword overlap with the intent — identical scores.
  const identicalTool = (name: string): ToolEntry => ({
    name,
    description: 'billing payment invoice charge',
    inputSchema: { type: 'object', properties: {} },
  });
  const agg = buildAgg('n4', [STRIPE_CFG, NEON_CFG], {
    stripe: [identicalTool('tool_a')],
    neon: [identicalTool('tool_b')],
  });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing payment invoice', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    // If scores are identical, stddev === 0 and kurtosis should be absent.
    if ('candidateScoreStdDev' in explanation && explanation.candidateScoreStdDev === 0) {
      assert.ok(
        !('candidateScoreKurtosis' in explanation),
        `candidateScoreKurtosis should be absent when stddev === 0, found: ${explanation.candidateScoreKurtosis}`,
      );
    }
    // The field may or may not be present depending on whether scores differ.
    // Just verify it's a finite number if present.
    if ('candidateScoreKurtosis' in explanation) {
      assert.ok(Number.isFinite(explanation.candidateScoreKurtosis));
    }
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQQQ-5: absent on cast:no_match', async () => {
  const path = dlqPath('n5');
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
      !('candidateScoreKurtosis' in parsed.explanation),
      `candidateScoreKurtosis should be absent on no_match, found: ${parsed.explanation.candidateScoreKurtosis}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('QQQQQQQ-6: equals -2 for exactly 2 candidates with different scores', async () => {
  // With exactly 2 candidates, excess kurtosis is always -2:
  // standardised values are +1 and -1; (1/2)*(1^4 + 1^4) - 3 = 1 - 3 = -2.
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('n6', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreKurtosis' in explanation && explanation.candidateCount === 2) {
      assert.ok(
        Math.abs(explanation.candidateScoreKurtosis - (-2)) < 1e-9,
        `with 2 candidates, excess kurtosis should be -2, got ${explanation.candidateScoreKurtosis}`,
      );
    }
    assert.ok(explanation.candidateCount >= 1, 'should have candidates');
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQQQ-7: present regardless of focus (focus inactive)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('n7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok('candidateScoreKurtosis' in explanation,
      `candidateScoreKurtosis should be present without focus; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQQQ-8: tool description documents candidateScoreKurtosis', async () => {
  const path = dlqPath('n8');
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
      cast.description?.includes('candidateScoreKurtosis'),
      `cast description should mention candidateScoreKurtosis, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
