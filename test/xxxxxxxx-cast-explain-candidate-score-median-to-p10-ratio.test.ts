/**
 * XXXXXXXX: explanation.candidateScoreMedianToP10Ratio in ch1tty/cast when explain:true.
 *
 * candidateScoreMedianToP10Ratio: number — ratio of median to P10:
 * medianCandidateScore / candidateScoreP10.
 *
 * Present when: >= 2 candidates, medianCandidateScore defined, candidateScoreP10 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP10 === 0.
 * Always >= 1 (median >= P10 by definition).
 * Always <= winnerScoreToP10Ratio (median <= winner, same denominator).
 * For n=2: (w+r) / (2*(0.1*w + 0.9*r)).
 * Identity: candidateScoreMedianToP10Ratio * candidateScoreP10 === medianCandidateScore.
 *
 * Covered:
 *   XXXXXXXX-1: present when >= 2 candidates and candidateScoreP10 > 0
 *   XXXXXXXX-2: always >= 1 and finite when present
 *   XXXXXXXX-3: always <= winnerScoreToP10Ratio when both present (median <= winner)
 *   XXXXXXXX-4: for n=2 equals (w+r) / (2*(0.1*w + 0.9*r))
 *   XXXXXXXX-5: absent on cast:no_match
 *   XXXXXXXX-6: absent when only 1 candidate
 *   XXXXXXXX-7: identity — candidateScoreMedianToP10Ratio * candidateScoreP10 === medianCandidateScore
 *   XXXXXXXX-8: tool description documents candidateScoreMedianToP10Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-xxxxxxxx-${label}-${Date.now()}.jsonl`);
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

test('XXXXXXXX-1: present when >= 2 candidates and candidateScoreP10 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('x1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP10' in explanation && explanation.candidateScoreP10 > 0 && 'medianCandidateScore' in explanation) {
      assert.ok('candidateScoreMedianToP10Ratio' in explanation,
        `candidateScoreMedianToP10Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreMedianToP10Ratio, 'number', 'candidateScoreMedianToP10Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('XXXXXXXX-2: always >= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('x2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMedianToP10Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreMedianToP10Ratio),
        `candidateScoreMedianToP10Ratio should be finite, got ${explanation.candidateScoreMedianToP10Ratio}`,
      );
      assert.ok(
        explanation.candidateScoreMedianToP10Ratio >= 1 - 1e-9,
        `candidateScoreMedianToP10Ratio should be >= 1, got ${explanation.candidateScoreMedianToP10Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('XXXXXXXX-3: always <= winnerScoreToP10Ratio when both present (median <= winner)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('x3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMedianToP10Ratio' in explanation && 'winnerScoreToP10Ratio' in explanation) {
      assert.ok(
        explanation.candidateScoreMedianToP10Ratio <= explanation.winnerScoreToP10Ratio + 1e-9,
        `candidateScoreMedianToP10Ratio (${explanation.candidateScoreMedianToP10Ratio}) should be <= winnerScoreToP10Ratio (${explanation.winnerScoreToP10Ratio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('XXXXXXXX-4: for n=2 equals (w+r) / (2*(0.1*w + 0.9*r))', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('x4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMedianToP10Ratio' in explanation && explanation.candidateCount === 2) {
      const p10 = 0.1 * explanation.winnerScore + 0.9 * explanation.runnerUpScore;
      if (p10 > 0) {
        const median = (explanation.winnerScore + explanation.runnerUpScore) / 2;
        const expected = median / p10;
        assert.ok(
          Math.abs(explanation.candidateScoreMedianToP10Ratio - expected) < 1e-9,
          `candidateScoreMedianToP10Ratio (${explanation.candidateScoreMedianToP10Ratio}) should equal (w+r)/(2*(0.1w+0.9r)) (${expected}) for n=2`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('XXXXXXXX-5: absent on cast:no_match', async () => {
  const path = dlqPath('x5');
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
      !('candidateScoreMedianToP10Ratio' in parsed.explanation),
      `candidateScoreMedianToP10Ratio should be absent on no_match, found: ${parsed.explanation.candidateScoreMedianToP10Ratio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('XXXXXXXX-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('x6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreMedianToP10Ratio' in explanation),
      `candidateScoreMedianToP10Ratio should be absent with single candidate, found: ${explanation.candidateScoreMedianToP10Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('XXXXXXXX-7: identity — candidateScoreMedianToP10Ratio * candidateScoreP10 === medianCandidateScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('x7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMedianToP10Ratio' in explanation && 'candidateScoreP10' in explanation && 'medianCandidateScore' in explanation) {
      const product = explanation.candidateScoreMedianToP10Ratio * explanation.candidateScoreP10;
      assert.ok(
        Math.abs(product - explanation.medianCandidateScore) < 1e-9,
        `candidateScoreMedianToP10Ratio * candidateScoreP10 (${product}) should equal medianCandidateScore (${explanation.medianCandidateScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('XXXXXXXX-8: tool description documents candidateScoreMedianToP10Ratio', async () => {
  const path = dlqPath('x8');
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
      cast.description?.includes('candidateScoreMedianToP10Ratio'),
      `cast description should mention candidateScoreMedianToP10Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
