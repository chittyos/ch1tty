/**
 * 78787878: explanation.runnerUpScoreToMeanRatio in ch1tty/cast when explain:true.
 *
 * runnerUpScoreToMeanRatio: number — ratio of runner-up score to full-pool mean:
 * runnerUpScore / candidateScoreMean.
 *
 * Present when: >= 2 candidates and candidateScoreMean > 0 (candidateScoreEntropyTotal > 0).
 * Absent when: no_match, single candidate, or all candidates scored zero.
 * Three-way product: runnerUpScoreToMeanRatio * candidateScoreMeanRatio * winnerScoreRatio === 1.
 * Identity: runnerUpScoreToMeanRatio * candidateScoreMean === runnerUpScore.
 * For n=2: 2r / (w + r).
 *
 * Covered:
 *   78787878-1: present when >= 2 candidates and candidateScoreEntropyTotal > 0
 *   78787878-2: > 0 and finite when present
 *   78787878-3: three-way product === 1 with candidateScoreMeanRatio and winnerScoreRatio
 *   78787878-4: for n=2 equals 2r / (w + r)
 *   78787878-5: absent on cast:no_match
 *   78787878-6: absent when only 1 candidate
 *   78787878-7: identity — runnerUpScoreToMeanRatio * candidateScoreMean === runnerUpScore
 *   78787878-8: tool description documents runnerUpScoreToMeanRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-78787878-${label}-${Date.now()}.jsonl`);
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

test('78787878-1: present when >= 2 candidates and candidateScoreEntropyTotal > 0', async () => {
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
    if (explanation.candidateScoreMean > 0) {
      assert.ok('runnerUpScoreToMeanRatio' in explanation,
        `runnerUpScoreToMeanRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.runnerUpScoreToMeanRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('78787878-2: > 0 and finite when present', async () => {
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
    if ('runnerUpScoreToMeanRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.runnerUpScoreToMeanRatio),
        `should be finite, got ${explanation.runnerUpScoreToMeanRatio}`,
      );
      assert.ok(
        explanation.runnerUpScoreToMeanRatio > 0,
        `should be > 0, got ${explanation.runnerUpScoreToMeanRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('78787878-3: three-way product runnerUpScoreToMeanRatio * candidateScoreMeanRatio * winnerScoreRatio === 1', async () => {
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
    if ('runnerUpScoreToMeanRatio' in explanation && 'candidateScoreMeanRatio' in explanation && 'winnerScoreRatio' in explanation) {
      const product = explanation.runnerUpScoreToMeanRatio * explanation.candidateScoreMeanRatio * explanation.winnerScoreRatio;
      assert.ok(
        Math.abs(product - 1) < 1e-9,
        `runnerUpScoreToMeanRatio * candidateScoreMeanRatio * winnerScoreRatio (${product}) should equal 1`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('78787878-4: for n=2 equals 2r / (w + r)', async () => {
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
    if ('runnerUpScoreToMeanRatio' in explanation && explanation.candidateCount === 2) {
      const w = explanation.winnerScore;
      const ru = explanation.runnerUpScore;
      const expected = (2 * ru) / (w + ru);
      assert.ok(
        Math.abs(explanation.runnerUpScoreToMeanRatio - expected) < 1e-9,
        `runnerUpScoreToMeanRatio (${explanation.runnerUpScoreToMeanRatio}) should equal 2r/(w+r) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('78787878-5: absent on cast:no_match', async () => {
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
      !('runnerUpScoreToMeanRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.runnerUpScoreToMeanRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('78787878-6: absent when only 1 candidate', async () => {
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
      !('runnerUpScoreToMeanRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.runnerUpScoreToMeanRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('78787878-7: identity — runnerUpScoreToMeanRatio * candidateScoreMean === runnerUpScore', async () => {
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
    if ('runnerUpScoreToMeanRatio' in explanation && 'candidateScoreMean' in explanation && 'runnerUpScore' in explanation) {
      const product = explanation.runnerUpScoreToMeanRatio * explanation.candidateScoreMean;
      assert.ok(
        Math.abs(product - explanation.runnerUpScore) < 1e-9,
        `runnerUpScoreToMeanRatio * candidateScoreMean (${product}) should equal runnerUpScore (${explanation.runnerUpScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('78787878-8: tool description documents runnerUpScoreToMeanRatio', async () => {
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
      cast.description?.includes('runnerUpScoreToMeanRatio'),
      `cast description should mention runnerUpScoreToMeanRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
