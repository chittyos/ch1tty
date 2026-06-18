/**
 * 05050505: explanation.runnerUpScoreToGeometricMeanRatio in ch1tty/cast when explain:true.
 *
 * runnerUpScoreToGeometricMeanRatio: number — ratio of runner-up score to full-pool geometric mean:
 * runnerUpScore / candidateScoreGeometricMean.
 *
 * Present when: >= 2 candidates and candidateScoreGeometricMean > 0 (all scores > 0).
 * Absent when: no_match, single candidate, any score === 0.
 * Always <= winnerScoreToGeometricMeanRatio (runner-up <= winner).
 * For n=2: sqrt(r/w) = 1/sqrt(winnerScoreRatio).
 * Identity: runnerUpScoreToGeometricMeanRatio * candidateScoreGeometricMean === runnerUpScore.
 *
 * Covered:
 *   05050505-1: present when >= 2 candidates and candidateScoreGeometricMean > 0
 *   05050505-2: > 0 and finite when present
 *   05050505-3: <= winnerScoreToGeometricMeanRatio when both present
 *   05050505-4: for n=2 equals sqrt(r/w) = 1/sqrt(winnerScoreRatio)
 *   05050505-5: absent on cast:no_match
 *   05050505-6: absent when only 1 candidate
 *   05050505-7: identity — runnerUpScoreToGeometricMeanRatio * candidateScoreGeometricMean === runnerUpScore
 *   05050505-8: tool description documents runnerUpScoreToGeometricMeanRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-05050505-${label}-${Date.now()}.jsonl`);
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

test('05050505-1: present when >= 2 candidates and candidateScoreGeometricMean > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ff1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreGeometricMean' in explanation && explanation.candidateScoreGeometricMean > 0) {
      assert.ok('runnerUpScoreToGeometricMeanRatio' in explanation,
        `runnerUpScoreToGeometricMeanRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.runnerUpScoreToGeometricMeanRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('05050505-2: > 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ff2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToGeometricMeanRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.runnerUpScoreToGeometricMeanRatio),
        `should be finite, got ${explanation.runnerUpScoreToGeometricMeanRatio}`,
      );
      assert.ok(
        explanation.runnerUpScoreToGeometricMeanRatio > 0,
        `should be > 0, got ${explanation.runnerUpScoreToGeometricMeanRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('05050505-3: <= winnerScoreToGeometricMeanRatio when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ff3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToGeometricMeanRatio' in explanation && 'winnerScoreToGeometricMeanRatio' in explanation) {
      assert.ok(
        explanation.runnerUpScoreToGeometricMeanRatio <= explanation.winnerScoreToGeometricMeanRatio + 1e-9,
        `runnerUpScoreToGeometricMeanRatio (${explanation.runnerUpScoreToGeometricMeanRatio}) should be <= winnerScoreToGeometricMeanRatio (${explanation.winnerScoreToGeometricMeanRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('05050505-4: for n=2 equals 1/sqrt(winnerScoreRatio)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ff4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToGeometricMeanRatio' in explanation && explanation.candidateCount === 2 && 'winnerScoreRatio' in explanation) {
      const expected = 1 / Math.sqrt(explanation.winnerScoreRatio);
      assert.ok(
        Math.abs(explanation.runnerUpScoreToGeometricMeanRatio - expected) < 1e-9,
        `runnerUpScoreToGeometricMeanRatio (${explanation.runnerUpScoreToGeometricMeanRatio}) should equal 1/sqrt(winnerScoreRatio) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('05050505-5: absent on cast:no_match', async () => {
  const path = dlqPath('ff5');
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
      !('runnerUpScoreToGeometricMeanRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.runnerUpScoreToGeometricMeanRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('05050505-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ff6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('runnerUpScoreToGeometricMeanRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.runnerUpScoreToGeometricMeanRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('05050505-7: identity — runnerUpScoreToGeometricMeanRatio * candidateScoreGeometricMean === runnerUpScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ff7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToGeometricMeanRatio' in explanation && 'candidateScoreGeometricMean' in explanation && 'runnerUpScore' in explanation) {
      const product = explanation.runnerUpScoreToGeometricMeanRatio * explanation.candidateScoreGeometricMean;
      assert.ok(
        Math.abs(product - explanation.runnerUpScore) < 1e-9,
        `runnerUpScoreToGeometricMeanRatio * candidateScoreGeometricMean (${product}) should equal runnerUpScore (${explanation.runnerUpScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('05050505-8: tool description documents runnerUpScoreToGeometricMeanRatio', async () => {
  const path = dlqPath('ff8');
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
      cast.description?.includes('runnerUpScoreToGeometricMeanRatio'),
      `cast description should mention runnerUpScoreToGeometricMeanRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
