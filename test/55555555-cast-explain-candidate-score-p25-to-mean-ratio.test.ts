/**
 * 55555555: explanation.candidateScoreP25ToMeanRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreP25ToMeanRatio: number — ratio of P25 (Q1) to mean score:
 * candidateScoreP25 / candidateScoreMean.
 *
 * Present when: >= 2 candidates and candidateScoreEntropyTotal > 0.
 * Absent when: no_match, single candidate, or all scores === 0.
 * Typically < 1 (P25 < mean in right-skewed distributions).
 * Always >= candidateScoreP10ToMeanRatio when both present (P25 >= P10).
 * Always <= candidateScoreP75ToMeanRatio when both present (P25 <= P75).
 * Always >= candidateScoreP25ToWinnerRatio when both present (mean <= winner).
 * Identity: candidateScoreP25ToMeanRatio * candidateScoreMean === candidateScoreP25.
 * For n=2: 2*(0.25*w + 0.75*r) / (w+r).
 *
 * Covered:
 *   55555555-1: present when >= 2 candidates and candidateScoreEntropyTotal > 0
 *   55555555-2: > 0 and finite when present
 *   55555555-3: always >= candidateScoreP10ToMeanRatio when both present (P25 >= P10)
 *   55555555-4: for n=2 equals 2*(0.25*w + 0.75*r) / (w+r)
 *   55555555-5: absent on cast:no_match
 *   55555555-6: absent when only 1 candidate
 *   55555555-7: identity — candidateScoreP25ToMeanRatio * candidateScoreMean === candidateScoreP25
 *   55555555-8: tool description documents candidateScoreP25ToMeanRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-55555555-${label}-${Date.now()}.jsonl`);
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

test('55555555-1: present when >= 2 candidates and candidateScoreEntropyTotal > 0', async () => {
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
    if (explanation.candidateScoreMean > 0 && 'candidateScoreP25' in explanation) {
      assert.ok('candidateScoreP25ToMeanRatio' in explanation,
        `candidateScoreP25ToMeanRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreP25ToMeanRatio, 'number', 'candidateScoreP25ToMeanRatio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('55555555-2: > 0 and finite when present', async () => {
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
    if ('candidateScoreP25ToMeanRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP25ToMeanRatio),
        `candidateScoreP25ToMeanRatio should be finite, got ${explanation.candidateScoreP25ToMeanRatio}`,
      );
      assert.ok(
        explanation.candidateScoreP25ToMeanRatio > 0,
        `candidateScoreP25ToMeanRatio should be > 0, got ${explanation.candidateScoreP25ToMeanRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('55555555-3: always >= candidateScoreP10ToMeanRatio when both present (P25 >= P10)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('e3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP25ToMeanRatio' in explanation && 'candidateScoreP10ToMeanRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreP25ToMeanRatio >= explanation.candidateScoreP10ToMeanRatio - 1e-9,
        `candidateScoreP25ToMeanRatio (${explanation.candidateScoreP25ToMeanRatio}) should be >= candidateScoreP10ToMeanRatio (${explanation.candidateScoreP10ToMeanRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('55555555-4: for n=2 equals 2*(0.25*w + 0.75*r) / (w+r)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('e4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP25ToMeanRatio' in explanation && explanation.candidateCount === 2 && explanation.candidateScoreMean > 0) {
      const p25 = 0.25 * explanation.winnerScore + 0.75 * explanation.runnerUpScore;
      const mean = (explanation.winnerScore + explanation.runnerUpScore) / 2;
      const expected = p25 / mean;
      assert.ok(
        Math.abs(explanation.candidateScoreP25ToMeanRatio - expected) < 1e-9,
        `candidateScoreP25ToMeanRatio (${explanation.candidateScoreP25ToMeanRatio}) should equal 2*(0.25w+0.75r)/(w+r) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('55555555-5: absent on cast:no_match', async () => {
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
      !('candidateScoreP25ToMeanRatio' in parsed.explanation),
      `candidateScoreP25ToMeanRatio should be absent on no_match, found: ${parsed.explanation.candidateScoreP25ToMeanRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('55555555-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('e6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP25ToMeanRatio' in explanation),
      `candidateScoreP25ToMeanRatio should be absent with single candidate, found: ${explanation.candidateScoreP25ToMeanRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('55555555-7: identity — candidateScoreP25ToMeanRatio * candidateScoreMean === candidateScoreP25', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('e7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP25ToMeanRatio' in explanation && 'candidateScoreMean' in explanation && 'candidateScoreP25' in explanation) {
      const product = explanation.candidateScoreP25ToMeanRatio * explanation.candidateScoreMean;
      assert.ok(
        Math.abs(product - explanation.candidateScoreP25) < 1e-9,
        `candidateScoreP25ToMeanRatio * candidateScoreMean (${product}) should equal candidateScoreP25 (${explanation.candidateScoreP25})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('55555555-8: tool description documents candidateScoreP25ToMeanRatio', async () => {
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
      cast.description?.includes('candidateScoreP25ToMeanRatio'),
      `cast description should mention candidateScoreP25ToMeanRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
