/**
 * ZZZZZZZZ: explanation.candidateScoreMedianToP25Ratio in ch1tty/cast when explain:true.
 *
 * candidateScoreMedianToP25Ratio: number — ratio of median to P25 (Q1):
 * medianCandidateScore / candidateScoreP25.
 *
 * Present when: >= 2 candidates, medianCandidateScore defined, candidateScoreP25 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP25 === 0.
 * Always >= 1 (median >= P25 by definition).
 * Always <= candidateScoreMedianToP10Ratio (P25 >= P10 so median/P25 <= median/P10).
 * For n=2: (w+r) / (2*(0.25*w + 0.75*r)).
 * Identity: candidateScoreMedianToP25Ratio * candidateScoreP25 === medianCandidateScore.
 *
 * Covered:
 *   ZZZZZZZZ-1: present when >= 2 candidates and candidateScoreP25 > 0
 *   ZZZZZZZZ-2: always >= 1 and finite when present
 *   ZZZZZZZZ-3: always <= candidateScoreMedianToP10Ratio when both present (P25 >= P10)
 *   ZZZZZZZZ-4: for n=2 equals (w+r) / (2*(0.25*w + 0.75*r))
 *   ZZZZZZZZ-5: absent on cast:no_match
 *   ZZZZZZZZ-6: absent when only 1 candidate
 *   ZZZZZZZZ-7: identity — candidateScoreMedianToP25Ratio * candidateScoreP25 === medianCandidateScore
 *   ZZZZZZZZ-8: tool description documents candidateScoreMedianToP25Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-zzzzzzzz-${label}-${Date.now()}.jsonl`);
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

test('ZZZZZZZZ-1: present when >= 2 candidates and candidateScoreP25 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP25' in explanation && explanation.candidateScoreP25 > 0 && 'medianCandidateScore' in explanation) {
      assert.ok('candidateScoreMedianToP25Ratio' in explanation,
        `candidateScoreMedianToP25Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreMedianToP25Ratio, 'number', 'candidateScoreMedianToP25Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZZZZZ-2: always >= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMedianToP25Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreMedianToP25Ratio),
        `candidateScoreMedianToP25Ratio should be finite, got ${explanation.candidateScoreMedianToP25Ratio}`,
      );
      assert.ok(
        explanation.candidateScoreMedianToP25Ratio >= 1 - 1e-9,
        `candidateScoreMedianToP25Ratio should be >= 1, got ${explanation.candidateScoreMedianToP25Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZZZZZ-3: always <= candidateScoreMedianToP10Ratio when both present (P25 >= P10)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMedianToP25Ratio' in explanation && 'candidateScoreMedianToP10Ratio' in explanation) {
      assert.ok(
        explanation.candidateScoreMedianToP25Ratio <= explanation.candidateScoreMedianToP10Ratio + 1e-9,
        `candidateScoreMedianToP25Ratio (${explanation.candidateScoreMedianToP25Ratio}) should be <= candidateScoreMedianToP10Ratio (${explanation.candidateScoreMedianToP10Ratio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZZZZZ-4: for n=2 equals (w+r) / (2*(0.25*w + 0.75*r))', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMedianToP25Ratio' in explanation && explanation.candidateCount === 2) {
      const p25 = 0.25 * explanation.winnerScore + 0.75 * explanation.runnerUpScore;
      if (p25 > 0) {
        const median = (explanation.winnerScore + explanation.runnerUpScore) / 2;
        const expected = median / p25;
        assert.ok(
          Math.abs(explanation.candidateScoreMedianToP25Ratio - expected) < 1e-9,
          `candidateScoreMedianToP25Ratio (${explanation.candidateScoreMedianToP25Ratio}) should equal (w+r)/(2*(0.25w+0.75r)) (${expected}) for n=2`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZZZZZ-5: absent on cast:no_match', async () => {
  const path = dlqPath('z5');
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
      !('candidateScoreMedianToP25Ratio' in parsed.explanation),
      `candidateScoreMedianToP25Ratio should be absent on no_match, found: ${parsed.explanation.candidateScoreMedianToP25Ratio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('ZZZZZZZZ-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreMedianToP25Ratio' in explanation),
      `candidateScoreMedianToP25Ratio should be absent with single candidate, found: ${explanation.candidateScoreMedianToP25Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZZZZZ-7: identity — candidateScoreMedianToP25Ratio * candidateScoreP25 === medianCandidateScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMedianToP25Ratio' in explanation && 'candidateScoreP25' in explanation && 'medianCandidateScore' in explanation) {
      const product = explanation.candidateScoreMedianToP25Ratio * explanation.candidateScoreP25;
      assert.ok(
        Math.abs(product - explanation.medianCandidateScore) < 1e-9,
        `candidateScoreMedianToP25Ratio * candidateScoreP25 (${product}) should equal medianCandidateScore (${explanation.medianCandidateScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZZZZZ-8: tool description documents candidateScoreMedianToP25Ratio', async () => {
  const path = dlqPath('z8');
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
      cast.description?.includes('candidateScoreMedianToP25Ratio'),
      `cast description should mention candidateScoreMedianToP25Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
