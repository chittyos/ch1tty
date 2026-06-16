/**
 * 11111111: explanation.candidateScoreP90ToMeanRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreP90ToMeanRatio: number — ratio of P90 to mean score:
 * candidateScoreP90 / candidateScoreMean.
 *
 * Present when: >= 2 candidates and candidateScoreEntropyTotal > 0.
 * Absent when: no_match, single candidate, or all scores === 0.
 * Typically > 1 (P90 > mean in right-skewed distributions).
 * Always >= candidateScoreP90ToWinnerRatio when both present (mean <= winner).
 * Identity: candidateScoreP90ToMeanRatio * candidateScoreMean === candidateScoreP90.
 * For n=2: 2*(0.9*w + 0.1*r) / (w+r).
 *
 * Covered:
 *   11111111-1: present when >= 2 candidates and candidateScoreEntropyTotal > 0
 *   11111111-2: > 0 and finite when present
 *   11111111-3: always >= candidateScoreP90ToWinnerRatio when both present (mean <= winner)
 *   11111111-4: for n=2 equals 2*(0.9*w + 0.1*r) / (w+r)
 *   11111111-5: absent on cast:no_match
 *   11111111-6: absent when only 1 candidate
 *   11111111-7: identity — candidateScoreP90ToMeanRatio * candidateScoreMean === candidateScoreP90
 *   11111111-8: tool description documents candidateScoreP90ToMeanRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-11111111-${label}-${Date.now()}.jsonl`);
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

test('11111111-1: present when >= 2 candidates and candidateScoreEntropyTotal > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('a1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if (explanation.candidateScoreMean > 0 && 'candidateScoreP90' in explanation) {
      assert.ok('candidateScoreP90ToMeanRatio' in explanation,
        `candidateScoreP90ToMeanRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreP90ToMeanRatio, 'number', 'candidateScoreP90ToMeanRatio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('11111111-2: > 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('a2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP90ToMeanRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP90ToMeanRatio),
        `candidateScoreP90ToMeanRatio should be finite, got ${explanation.candidateScoreP90ToMeanRatio}`,
      );
      assert.ok(
        explanation.candidateScoreP90ToMeanRatio > 0,
        `candidateScoreP90ToMeanRatio should be > 0, got ${explanation.candidateScoreP90ToMeanRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('11111111-3: always >= candidateScoreP90ToWinnerRatio when both present (mean <= winner)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('a3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP90ToMeanRatio' in explanation && 'candidateScoreP90ToWinnerRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreP90ToMeanRatio >= explanation.candidateScoreP90ToWinnerRatio - 1e-9,
        `candidateScoreP90ToMeanRatio (${explanation.candidateScoreP90ToMeanRatio}) should be >= candidateScoreP90ToWinnerRatio (${explanation.candidateScoreP90ToWinnerRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('11111111-4: for n=2 equals 2*(0.9*w + 0.1*r) / (w+r)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('a4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP90ToMeanRatio' in explanation && explanation.candidateCount === 2 && explanation.candidateScoreMean > 0) {
      const p90 = 0.9 * explanation.winnerScore + 0.1 * explanation.runnerUpScore;
      const mean = (explanation.winnerScore + explanation.runnerUpScore) / 2;
      const expected = p90 / mean;
      assert.ok(
        Math.abs(explanation.candidateScoreP90ToMeanRatio - expected) < 1e-9,
        `candidateScoreP90ToMeanRatio (${explanation.candidateScoreP90ToMeanRatio}) should equal 2*(0.9w+0.1r)/(w+r) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('11111111-5: absent on cast:no_match', async () => {
  const path = dlqPath('a5');
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
      !('candidateScoreP90ToMeanRatio' in parsed.explanation),
      `candidateScoreP90ToMeanRatio should be absent on no_match, found: ${parsed.explanation.candidateScoreP90ToMeanRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('11111111-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('a6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP90ToMeanRatio' in explanation),
      `candidateScoreP90ToMeanRatio should be absent with single candidate, found: ${explanation.candidateScoreP90ToMeanRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('11111111-7: identity — candidateScoreP90ToMeanRatio * candidateScoreMean === candidateScoreP90', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('a7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP90ToMeanRatio' in explanation && 'candidateScoreMean' in explanation && 'candidateScoreP90' in explanation) {
      const product = explanation.candidateScoreP90ToMeanRatio * explanation.candidateScoreMean;
      assert.ok(
        Math.abs(product - explanation.candidateScoreP90) < 1e-9,
        `candidateScoreP90ToMeanRatio * candidateScoreMean (${product}) should equal candidateScoreP90 (${explanation.candidateScoreP90})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('11111111-8: tool description documents candidateScoreP90ToMeanRatio', async () => {
  const path = dlqPath('a8');
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
      cast.description?.includes('candidateScoreP90ToMeanRatio'),
      `cast description should mention candidateScoreP90ToMeanRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
