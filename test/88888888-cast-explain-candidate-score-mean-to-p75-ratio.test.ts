/**
 * 88888888: explanation.candidateScoreMeanToP75Ratio in ch1tty/cast when explain:true.
 *
 * candidateScoreMeanToP75Ratio: number — ratio of mean to P75 (Q3) score:
 * candidateScoreMean / candidateScoreP75.
 *
 * Present when: >= 2 candidates and candidateScoreP75 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP75 === 0.
 * Typically < 1 (mean < P75 in right-skewed distributions).
 * Always >= candidateScoreMeanToP90Ratio when both present (P75 <= P90).
 * Exact inverse of candidateScoreP75ToMeanRatio: product === 1.
 * Identity: candidateScoreMeanToP75Ratio * candidateScoreP75 === candidateScoreMean.
 * For n=2: (w+r) / (2*(0.75*w + 0.25*r)).
 *
 * Covered:
 *   88888888-1: present when >= 2 candidates and candidateScoreP75 > 0
 *   88888888-2: > 0 and finite when present
 *   88888888-3: always >= candidateScoreMeanToP90Ratio when both present (P75 <= P90)
 *   88888888-4: for n=2 equals (w+r) / (2*(0.75*w + 0.25*r))
 *   88888888-5: absent on cast:no_match
 *   88888888-6: absent when only 1 candidate
 *   88888888-7: identity — candidateScoreMeanToP75Ratio * candidateScoreP75 === candidateScoreMean
 *   88888888-8: tool description documents candidateScoreMeanToP75Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-88888888-${label}-${Date.now()}.jsonl`);
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

test('88888888-1: present when >= 2 candidates and candidateScoreP75 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('h1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP75' in explanation && explanation.candidateScoreP75 > 0) {
      assert.ok('candidateScoreMeanToP75Ratio' in explanation,
        `candidateScoreMeanToP75Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreMeanToP75Ratio, 'number', 'candidateScoreMeanToP75Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('88888888-2: > 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('h2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToP75Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreMeanToP75Ratio),
        `candidateScoreMeanToP75Ratio should be finite, got ${explanation.candidateScoreMeanToP75Ratio}`,
      );
      assert.ok(
        explanation.candidateScoreMeanToP75Ratio > 0,
        `candidateScoreMeanToP75Ratio should be > 0, got ${explanation.candidateScoreMeanToP75Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('88888888-3: always >= candidateScoreMeanToP90Ratio when both present (P75 <= P90)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('h3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToP75Ratio' in explanation && 'candidateScoreMeanToP90Ratio' in explanation) {
      assert.ok(
        explanation.candidateScoreMeanToP75Ratio >= explanation.candidateScoreMeanToP90Ratio - 1e-9,
        `candidateScoreMeanToP75Ratio (${explanation.candidateScoreMeanToP75Ratio}) should be >= candidateScoreMeanToP90Ratio (${explanation.candidateScoreMeanToP90Ratio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('88888888-4: for n=2 equals (w+r) / (2*(0.75*w + 0.25*r))', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('h4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToP75Ratio' in explanation && explanation.candidateCount === 2 && explanation.candidateScoreP75 > 0) {
      const mean = (explanation.winnerScore + explanation.runnerUpScore) / 2;
      const p75 = 0.75 * explanation.winnerScore + 0.25 * explanation.runnerUpScore;
      const expected = mean / p75;
      assert.ok(
        Math.abs(explanation.candidateScoreMeanToP75Ratio - expected) < 1e-9,
        `candidateScoreMeanToP75Ratio (${explanation.candidateScoreMeanToP75Ratio}) should equal (w+r)/(2*(0.75w+0.25r)) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('88888888-5: absent on cast:no_match', async () => {
  const path = dlqPath('h5');
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
      !('candidateScoreMeanToP75Ratio' in parsed.explanation),
      `candidateScoreMeanToP75Ratio should be absent on no_match, found: ${parsed.explanation.candidateScoreMeanToP75Ratio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('88888888-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('h6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreMeanToP75Ratio' in explanation),
      `candidateScoreMeanToP75Ratio should be absent with single candidate, found: ${explanation.candidateScoreMeanToP75Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('88888888-7: identity — candidateScoreMeanToP75Ratio * candidateScoreP75 === candidateScoreMean', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('h7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToP75Ratio' in explanation && 'candidateScoreP75' in explanation && 'candidateScoreMean' in explanation) {
      const product = explanation.candidateScoreMeanToP75Ratio * explanation.candidateScoreP75;
      assert.ok(
        Math.abs(product - explanation.candidateScoreMean) < 1e-9,
        `candidateScoreMeanToP75Ratio * candidateScoreP75 (${product}) should equal candidateScoreMean (${explanation.candidateScoreMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('88888888-8: tool description documents candidateScoreMeanToP75Ratio', async () => {
  const path = dlqPath('h8');
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
      cast.description?.includes('candidateScoreMeanToP75Ratio'),
      `cast description should mention candidateScoreMeanToP75Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
