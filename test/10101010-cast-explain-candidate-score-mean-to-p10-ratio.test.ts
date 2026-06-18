/**
 * 10101010: explanation.candidateScoreMeanToP10Ratio in ch1tty/cast when explain:true.
 *
 * candidateScoreMeanToP10Ratio: number — ratio of mean to P10 score:
 * candidateScoreMean / candidateScoreP10.
 *
 * Present when: >= 2 candidates and candidateScoreP10 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP10 === 0.
 * Typically > 1 (mean > P10 in right-skewed distributions).
 * Always >= candidateScoreMeanToP75Ratio when both present (P10 <= P75).
 * Exact inverse of candidateScoreP10ToMeanRatio: product === 1.
 * Identity: candidateScoreMeanToP10Ratio * candidateScoreP10 === candidateScoreMean.
 * For n=2: (w+r) / (2*(0.1*w + 0.9*r)).
 *
 * Covered:
 *   10101010-1: present when >= 2 candidates and candidateScoreP10 > 0
 *   10101010-2: > 0 and finite when present
 *   10101010-3: always >= candidateScoreMeanToP75Ratio when both present (P10 <= P75)
 *   10101010-4: for n=2 equals (w+r) / (2*(0.1*w + 0.9*r))
 *   10101010-5: absent on cast:no_match
 *   10101010-6: absent when only 1 candidate
 *   10101010-7: identity — candidateScoreMeanToP10Ratio * candidateScoreP10 === candidateScoreMean
 *   10101010-8: tool description documents candidateScoreMeanToP10Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-10101010-${label}-${Date.now()}.jsonl`);
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

test('10101010-1: present when >= 2 candidates and candidateScoreP10 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('j1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP10' in explanation && explanation.candidateScoreP10 > 0) {
      assert.ok('candidateScoreMeanToP10Ratio' in explanation,
        `candidateScoreMeanToP10Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreMeanToP10Ratio, 'number', 'candidateScoreMeanToP10Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('10101010-2: > 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('j2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToP10Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreMeanToP10Ratio),
        `candidateScoreMeanToP10Ratio should be finite, got ${explanation.candidateScoreMeanToP10Ratio}`,
      );
      assert.ok(
        explanation.candidateScoreMeanToP10Ratio > 0,
        `candidateScoreMeanToP10Ratio should be > 0, got ${explanation.candidateScoreMeanToP10Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('10101010-3: always >= candidateScoreMeanToP75Ratio when both present (P10 <= P75)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('j3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToP10Ratio' in explanation && 'candidateScoreMeanToP75Ratio' in explanation) {
      assert.ok(
        explanation.candidateScoreMeanToP10Ratio >= explanation.candidateScoreMeanToP75Ratio - 1e-9,
        `candidateScoreMeanToP10Ratio (${explanation.candidateScoreMeanToP10Ratio}) should be >= candidateScoreMeanToP75Ratio (${explanation.candidateScoreMeanToP75Ratio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('10101010-4: for n=2 equals (w+r) / (2*(0.1*w + 0.9*r))', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('j4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToP10Ratio' in explanation && explanation.candidateCount === 2 && explanation.candidateScoreP10 > 0) {
      const mean = (explanation.winnerScore + explanation.runnerUpScore) / 2;
      const p10 = 0.1 * explanation.winnerScore + 0.9 * explanation.runnerUpScore;
      const expected = mean / p10;
      assert.ok(
        Math.abs(explanation.candidateScoreMeanToP10Ratio - expected) < 1e-9,
        `candidateScoreMeanToP10Ratio (${explanation.candidateScoreMeanToP10Ratio}) should equal (w+r)/(2*(0.1w+0.9r)) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('10101010-5: absent on cast:no_match', async () => {
  const path = dlqPath('j5');
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
      !('candidateScoreMeanToP10Ratio' in parsed.explanation),
      `candidateScoreMeanToP10Ratio should be absent on no_match, found: ${parsed.explanation.candidateScoreMeanToP10Ratio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('10101010-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('j6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreMeanToP10Ratio' in explanation),
      `candidateScoreMeanToP10Ratio should be absent with single candidate, found: ${explanation.candidateScoreMeanToP10Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('10101010-7: identity — candidateScoreMeanToP10Ratio * candidateScoreP10 === candidateScoreMean', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('j7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToP10Ratio' in explanation && 'candidateScoreP10' in explanation && 'candidateScoreMean' in explanation) {
      const product = explanation.candidateScoreMeanToP10Ratio * explanation.candidateScoreP10;
      assert.ok(
        Math.abs(product - explanation.candidateScoreMean) < 1e-9,
        `candidateScoreMeanToP10Ratio * candidateScoreP10 (${product}) should equal candidateScoreMean (${explanation.candidateScoreMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('10101010-8: tool description documents candidateScoreMeanToP10Ratio', async () => {
  const path = dlqPath('j8');
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
      cast.description?.includes('candidateScoreMeanToP10Ratio'),
      `cast description should mention candidateScoreMeanToP10Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
