/**
 * BBBBBBBB: explanation.candidateScoreMedianToP95Ratio in ch1tty/cast when explain:true.
 *
 * candidateScoreMedianToP95Ratio: number — ratio of median to P95:
 * medianCandidateScore / candidateScoreP95.
 *
 * Present when: >= 2 candidates, medianCandidateScore defined, candidateScoreP95 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP95 === 0.
 * Always in [0, 1] (median <= P95 by definition).
 * Always <= candidateScoreMedianToP90Ratio (P95 >= P90 so median/P95 <= median/P90).
 * For n=2: (w+r) / (2*(0.95*w + 0.05*r)).
 * Identity: candidateScoreMedianToP95Ratio * candidateScoreP95 === medianCandidateScore.
 *
 * Covered:
 *   BBBBBBBB-1: present when >= 2 candidates and candidateScoreP95 > 0
 *   BBBBBBBB-2: always in [0, 1] and finite when present
 *   BBBBBBBB-3: always <= candidateScoreMedianToP90Ratio when both present (P95 >= P90)
 *   BBBBBBBB-4: for n=2 equals (w+r) / (2*(0.95*w + 0.05*r))
 *   BBBBBBBB-5: absent on cast:no_match
 *   BBBBBBBB-6: absent when only 1 candidate
 *   BBBBBBBB-7: identity — candidateScoreMedianToP95Ratio * candidateScoreP95 === medianCandidateScore
 *   BBBBBBBB-8: tool description documents candidateScoreMedianToP95Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-bbbbbbbb-${label}-${Date.now()}.jsonl`);
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

test('BBBBBBBB-1: present when >= 2 candidates and candidateScoreP95 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('b1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP95' in explanation && explanation.candidateScoreP95 > 0 && 'medianCandidateScore' in explanation) {
      assert.ok('candidateScoreMedianToP95Ratio' in explanation,
        `candidateScoreMedianToP95Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreMedianToP95Ratio, 'number', 'candidateScoreMedianToP95Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('BBBBBBBB-2: always in [0, 1] and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('b2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMedianToP95Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreMedianToP95Ratio),
        `candidateScoreMedianToP95Ratio should be finite, got ${explanation.candidateScoreMedianToP95Ratio}`,
      );
      assert.ok(
        explanation.candidateScoreMedianToP95Ratio >= 0,
        `candidateScoreMedianToP95Ratio should be >= 0, got ${explanation.candidateScoreMedianToP95Ratio}`,
      );
      assert.ok(
        explanation.candidateScoreMedianToP95Ratio <= 1 + 1e-9,
        `candidateScoreMedianToP95Ratio should be <= 1, got ${explanation.candidateScoreMedianToP95Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('BBBBBBBB-3: always <= candidateScoreMedianToP90Ratio when both present (P95 >= P90)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('b3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMedianToP95Ratio' in explanation && 'candidateScoreMedianToP90Ratio' in explanation) {
      assert.ok(
        explanation.candidateScoreMedianToP95Ratio <= explanation.candidateScoreMedianToP90Ratio + 1e-9,
        `candidateScoreMedianToP95Ratio (${explanation.candidateScoreMedianToP95Ratio}) should be <= candidateScoreMedianToP90Ratio (${explanation.candidateScoreMedianToP90Ratio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('BBBBBBBB-4: for n=2 equals (w+r) / (2*(0.95*w + 0.05*r))', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('b4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMedianToP95Ratio' in explanation && explanation.candidateCount === 2) {
      const p95 = 0.95 * explanation.winnerScore + 0.05 * explanation.runnerUpScore;
      if (p95 > 0) {
        const median = (explanation.winnerScore + explanation.runnerUpScore) / 2;
        const expected = median / p95;
        assert.ok(
          Math.abs(explanation.candidateScoreMedianToP95Ratio - expected) < 1e-9,
          `candidateScoreMedianToP95Ratio (${explanation.candidateScoreMedianToP95Ratio}) should equal (w+r)/(2*(0.95w+0.05r)) (${expected}) for n=2`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('BBBBBBBB-5: absent on cast:no_match', async () => {
  const path = dlqPath('b5');
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
      !('candidateScoreMedianToP95Ratio' in parsed.explanation),
      `candidateScoreMedianToP95Ratio should be absent on no_match, found: ${parsed.explanation.candidateScoreMedianToP95Ratio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('BBBBBBBB-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('b6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreMedianToP95Ratio' in explanation),
      `candidateScoreMedianToP95Ratio should be absent with single candidate, found: ${explanation.candidateScoreMedianToP95Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('BBBBBBBB-7: identity — candidateScoreMedianToP95Ratio * candidateScoreP95 === medianCandidateScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('b7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMedianToP95Ratio' in explanation && 'candidateScoreP95' in explanation && 'medianCandidateScore' in explanation) {
      const product = explanation.candidateScoreMedianToP95Ratio * explanation.candidateScoreP95;
      assert.ok(
        Math.abs(product - explanation.medianCandidateScore) < 1e-9,
        `candidateScoreMedianToP95Ratio * candidateScoreP95 (${product}) should equal medianCandidateScore (${explanation.medianCandidateScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('BBBBBBBB-8: tool description documents candidateScoreMedianToP95Ratio', async () => {
  const path = dlqPath('b8');
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
      cast.description?.includes('candidateScoreMedianToP95Ratio'),
      `cast description should mention candidateScoreMedianToP95Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
