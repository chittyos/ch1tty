/**
 * GGGGGGGG: explanation.candidateScoreP95 in ch1tty/cast when explain:true.
 *
 * candidateScoreP95: number — 95th percentile of candidate scores,
 * computed via linear interpolation on the descending-sorted pool.
 * Ascending P95 = descending index (n-1)*0.05.
 *
 * Present when: >= 2 candidates.
 * Absent when: no_match or single candidate.
 * Always >= 0.
 * Always >= candidateScoreP90.
 * Always <= winnerScore.
 * For n=2: 0.95 * winnerScore + 0.05 * runnerUpScore.
 *
 * Covered:
 *   GGGGGGGG-1: present when >= 2 candidates
 *   GGGGGGGG-2: always >= 0 and finite when present
 *   GGGGGGGG-3: always >= candidateScoreP90 when both present
 *   GGGGGGGG-4: for n=2 equals 0.95*winnerScore + 0.05*runnerUpScore
 *   GGGGGGGG-5: absent on cast:no_match
 *   GGGGGGGG-6: absent when only 1 candidate
 *   GGGGGGGG-7: always <= winnerScore
 *   GGGGGGGG-8: tool description documents candidateScoreP95
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-gggggggg-${label}-${Date.now()}.jsonl`);
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

test('GGGGGGGG-1: present when >= 2 candidates', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('g1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    assert.ok('candidateScoreP95' in explanation,
      `candidateScoreP95 should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.candidateScoreP95, 'number', 'candidateScoreP95 should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('GGGGGGGG-2: always >= 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('g2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP95' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP95),
        `candidateScoreP95 should be finite, got ${explanation.candidateScoreP95}`,
      );
      assert.ok(
        explanation.candidateScoreP95 >= -1e-9,
        `candidateScoreP95 should be >= 0, got ${explanation.candidateScoreP95}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('GGGGGGGG-3: always >= candidateScoreP90 when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('g3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP95' in explanation && 'candidateScoreP90' in explanation) {
      assert.ok(
        explanation.candidateScoreP95 >= explanation.candidateScoreP90 - 1e-9,
        `candidateScoreP95 (${explanation.candidateScoreP95}) should be >= candidateScoreP90 (${explanation.candidateScoreP90})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('GGGGGGGG-4: for n=2 equals 0.95*winnerScore + 0.05*runnerUpScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('g4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP95' in explanation && explanation.candidateCount === 2) {
      const expected = 0.95 * explanation.winnerScore + 0.05 * explanation.runnerUpScore;
      assert.ok(
        Math.abs(explanation.candidateScoreP95 - expected) < 1e-9,
        `candidateScoreP95 (${explanation.candidateScoreP95}) should equal 0.95*winner+0.05*runnerUp (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('GGGGGGGG-5: absent on cast:no_match', async () => {
  const path = dlqPath('g5');
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
      !('candidateScoreP95' in parsed.explanation),
      `candidateScoreP95 should be absent on no_match, found: ${parsed.explanation.candidateScoreP95}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('GGGGGGGG-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('g6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP95' in explanation),
      `candidateScoreP95 should be absent with single candidate, found: ${explanation.candidateScoreP95}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GGGGGGGG-7: always <= winnerScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('g7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP95' in explanation && 'winnerScore' in explanation) {
      assert.ok(
        explanation.candidateScoreP95 <= explanation.winnerScore + 1e-9,
        `candidateScoreP95 (${explanation.candidateScoreP95}) should be <= winnerScore (${explanation.winnerScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('GGGGGGGG-8: tool description documents candidateScoreP95', async () => {
  const path = dlqPath('g8');
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
      cast.description?.includes('candidateScoreP95'),
      `cast description should mention candidateScoreP95, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
