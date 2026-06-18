/**
 * YYYYYYYY: explanation.candidateScoreMedianToP75Ratio in ch1tty/cast when explain:true.
 *
 * candidateScoreMedianToP75Ratio: number — ratio of median to P75 (Q3):
 * medianCandidateScore / candidateScoreP75.
 *
 * Present when: >= 2 candidates, medianCandidateScore defined, candidateScoreP75 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP75 === 0.
 * Always in [0, 1] (median <= P75 by definition).
 * Always >= candidateScoreMedianToP90Ratio (P75 <= P90 so median/P75 >= median/P90).
 * For n=2: (w+r) / (2*(0.75*w + 0.25*r)).
 * Identity: candidateScoreMedianToP75Ratio * candidateScoreP75 === medianCandidateScore.
 *
 * Covered:
 *   YYYYYYYY-1: present when >= 2 candidates and candidateScoreP75 > 0
 *   YYYYYYYY-2: always in [0, 1] and finite when present
 *   YYYYYYYY-3: always >= candidateScoreMedianToP90Ratio when both present (P75 <= P90)
 *   YYYYYYYY-4: for n=2 equals (w+r) / (2*(0.75*w + 0.25*r))
 *   YYYYYYYY-5: absent on cast:no_match
 *   YYYYYYYY-6: absent when only 1 candidate
 *   YYYYYYYY-7: identity — candidateScoreMedianToP75Ratio * candidateScoreP75 === medianCandidateScore
 *   YYYYYYYY-8: tool description documents candidateScoreMedianToP75Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-yyyyyyyy-${label}-${Date.now()}.jsonl`);
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

test('YYYYYYYY-1: present when >= 2 candidates and candidateScoreP75 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('y1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP75' in explanation && explanation.candidateScoreP75 > 0 && 'medianCandidateScore' in explanation) {
      assert.ok('candidateScoreMedianToP75Ratio' in explanation,
        `candidateScoreMedianToP75Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreMedianToP75Ratio, 'number', 'candidateScoreMedianToP75Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('YYYYYYYY-2: always in [0, 1] and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('y2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMedianToP75Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreMedianToP75Ratio),
        `candidateScoreMedianToP75Ratio should be finite, got ${explanation.candidateScoreMedianToP75Ratio}`,
      );
      assert.ok(
        explanation.candidateScoreMedianToP75Ratio >= 0,
        `candidateScoreMedianToP75Ratio should be >= 0, got ${explanation.candidateScoreMedianToP75Ratio}`,
      );
      assert.ok(
        explanation.candidateScoreMedianToP75Ratio <= 1 + 1e-9,
        `candidateScoreMedianToP75Ratio should be <= 1, got ${explanation.candidateScoreMedianToP75Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('YYYYYYYY-3: always >= candidateScoreMedianToP90Ratio when both present (P75 <= P90)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('y3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMedianToP75Ratio' in explanation && 'candidateScoreMedianToP90Ratio' in explanation) {
      assert.ok(
        explanation.candidateScoreMedianToP75Ratio >= explanation.candidateScoreMedianToP90Ratio - 1e-9,
        `candidateScoreMedianToP75Ratio (${explanation.candidateScoreMedianToP75Ratio}) should be >= candidateScoreMedianToP90Ratio (${explanation.candidateScoreMedianToP90Ratio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('YYYYYYYY-4: for n=2 equals (w+r) / (2*(0.75*w + 0.25*r))', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('y4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMedianToP75Ratio' in explanation && explanation.candidateCount === 2) {
      const p75 = 0.75 * explanation.winnerScore + 0.25 * explanation.runnerUpScore;
      if (p75 > 0) {
        const median = (explanation.winnerScore + explanation.runnerUpScore) / 2;
        const expected = median / p75;
        assert.ok(
          Math.abs(explanation.candidateScoreMedianToP75Ratio - expected) < 1e-9,
          `candidateScoreMedianToP75Ratio (${explanation.candidateScoreMedianToP75Ratio}) should equal (w+r)/(2*(0.75w+0.25r)) (${expected}) for n=2`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('YYYYYYYY-5: absent on cast:no_match', async () => {
  const path = dlqPath('y5');
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
      !('candidateScoreMedianToP75Ratio' in parsed.explanation),
      `candidateScoreMedianToP75Ratio should be absent on no_match, found: ${parsed.explanation.candidateScoreMedianToP75Ratio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('YYYYYYYY-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('y6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreMedianToP75Ratio' in explanation),
      `candidateScoreMedianToP75Ratio should be absent with single candidate, found: ${explanation.candidateScoreMedianToP75Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('YYYYYYYY-7: identity — candidateScoreMedianToP75Ratio * candidateScoreP75 === medianCandidateScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('y7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMedianToP75Ratio' in explanation && 'candidateScoreP75' in explanation && 'medianCandidateScore' in explanation) {
      const product = explanation.candidateScoreMedianToP75Ratio * explanation.candidateScoreP75;
      assert.ok(
        Math.abs(product - explanation.medianCandidateScore) < 1e-9,
        `candidateScoreMedianToP75Ratio * candidateScoreP75 (${product}) should equal medianCandidateScore (${explanation.medianCandidateScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('YYYYYYYY-8: tool description documents candidateScoreMedianToP75Ratio', async () => {
  const path = dlqPath('y8');
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
      cast.description?.includes('candidateScoreMedianToP75Ratio'),
      `cast description should mention candidateScoreMedianToP75Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
