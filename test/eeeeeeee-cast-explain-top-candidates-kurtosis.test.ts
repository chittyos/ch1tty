/**
 * EEEEEEEE: explanation.topCandidatesKurtosis in ch1tty/cast when explain:true.
 *
 * topCandidatesKurtosis: number — fourth standardised moment (excess kurtosis)
 * of the topCandidates pool (up to 5 candidates).
 * Formula: (1/n) * sum((x_i - mean)^4 / stddev^4) - 3
 *
 * Present when: >= 2 topCandidates and topCandidatesScoreStdDev > 0.
 * Absent when: no_match, single candidate, or all top candidates score identically.
 * Excess kurtosis 0 = mesokurtic; >0 = leptokurtic; <0 = platykurtic.
 * For n=2 with different scores: always -2 (minimum possible excess kurtosis).
 *
 * Covered:
 *   EEEEEEEE-1: present when >= 2 topCandidates with different scores
 *   EEEEEEEE-2: is a finite number
 *   EEEEEEEE-3: absent when only 1 candidate
 *   EEEEEEEE-4: absent when all top candidates score identically
 *   EEEEEEEE-5: absent on cast:no_match
 *   EEEEEEEE-6: for n=2 with different scores always equals -2
 *   EEEEEEEE-7: present without focus active
 *   EEEEEEEE-8: tool description documents topCandidatesKurtosis
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-eeeeeeee-${label}-${Date.now()}.jsonl`);
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

test('EEEEEEEE-1: present when >= 2 topCandidates with different scores', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('e1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    assert.ok(
      'topCandidatesKurtosis' in explanation,
      `topCandidatesKurtosis should be present; keys: ${Object.keys(explanation).join(', ')}`,
    );
    assert.equal(typeof explanation.topCandidatesKurtosis, 'number', 'topCandidatesKurtosis should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('EEEEEEEE-2: is a finite number', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('e2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('topCandidatesKurtosis' in explanation) {
      assert.ok(
        Number.isFinite(explanation.topCandidatesKurtosis),
        `topCandidatesKurtosis should be finite, got ${explanation.topCandidatesKurtosis}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('EEEEEEEE-3: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('e3', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('topCandidatesKurtosis' in explanation),
      `topCandidatesKurtosis should be absent with single candidate, found: ${explanation.topCandidatesKurtosis}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('EEEEEEEE-4: absent when all top candidates score identically', async () => {
  const SAME_DESC = 'billing invoice payment charge query database';
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('e4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: SAME_DESC, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreSpread' in explanation && Math.abs(explanation.candidateScoreSpread) < 1e-9) {
      assert.ok(
        !('topCandidatesKurtosis' in explanation),
        `topCandidatesKurtosis should be absent when all scores identical, found: ${explanation.topCandidatesKurtosis}`,
      );
    }
    assert.ok(explanation.candidateCount >= 1, 'should have candidates');
  } finally {
    await agg.shutdown();
  }
});

test('EEEEEEEE-5: absent on cast:no_match', async () => {
  const path = dlqPath('e5');
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
      !('topCandidatesKurtosis' in parsed.explanation),
      `topCandidatesKurtosis should be absent on no_match, found: ${parsed.explanation.topCandidatesKurtosis}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('EEEEEEEE-6: for n=2 with different scores, equals -2', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('e6', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('topCandidatesKurtosis' in explanation && explanation.candidateCount === 2) {
      assert.ok(
        Math.abs(explanation.topCandidatesKurtosis - (-2)) < 1e-9,
        `topCandidatesKurtosis (${explanation.topCandidatesKurtosis}) should equal -2 for n=2 with different scores`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('EEEEEEEE-7: present without focus active', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const path = dlqPath('e7');
  const agg = new Aggregator([STRIPE_CFG, NEON_CFG], {
    backendFactory: (cfg) => makeBackend(cfg.id === 'stripe' ? stripeTools : neonTools),
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
  });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!explanation.activeFocus, 'focus should not be active');
    if (explanation.candidateCount >= 2) {
      assert.ok(
        'topCandidatesKurtosis' in explanation,
        `topCandidatesKurtosis should be present without focus; keys: ${Object.keys(explanation).join(', ')}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('EEEEEEEE-8: tool description documents topCandidatesKurtosis', async () => {
  const path = dlqPath('e8');
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
      cast.description?.includes('topCandidatesKurtosis'),
      `cast description should mention topCandidatesKurtosis, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
