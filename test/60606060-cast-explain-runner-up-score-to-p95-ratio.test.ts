/**
 * 60606060: explanation.runnerUpScoreToP95Ratio in ch1tty/cast when explain:true.
 *
 * runnerUpScoreToP95Ratio: number — ratio of runner-up score to P95:
 * runnerUpScore / candidateScoreP95.
 *
 * Present when: >= 2 candidates and candidateScoreP95 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP95 === 0.
 * Smallest of the runnerUp/Px family (P95 is the largest denominator).
 * Always <= runnerUpScoreToP90Ratio when both present (P95 >= P90).
 * Identity: runnerUpScoreToP95Ratio * candidateScoreP95 === runnerUpScore.
 * For n=2: r / (0.95*w + 0.05*r).
 *
 * Covered:
 *   60606060-1: present when >= 2 candidates and candidateScoreP95 > 0
 *   60606060-2: > 0 and finite when present
 *   60606060-3: always <= runnerUpScoreToP90Ratio when both present (P95 >= P90)
 *   60606060-4: for n=2 equals r / (0.95*w + 0.05*r)
 *   60606060-5: absent on cast:no_match
 *   60606060-6: absent when only 1 candidate
 *   60606060-7: identity — runnerUpScoreToP95Ratio * candidateScoreP95 === runnerUpScore
 *   60606060-8: tool description documents runnerUpScoreToP95Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-60606060-${label}-${Date.now()}.jsonl`);
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

test('60606060-1: present when >= 2 candidates and candidateScoreP95 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('o1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP95' in explanation && explanation.candidateScoreP95 > 0) {
      assert.ok('runnerUpScoreToP95Ratio' in explanation,
        `runnerUpScoreToP95Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.runnerUpScoreToP95Ratio, 'number', 'runnerUpScoreToP95Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('60606060-2: > 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('o2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToP95Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.runnerUpScoreToP95Ratio),
        `runnerUpScoreToP95Ratio should be finite, got ${explanation.runnerUpScoreToP95Ratio}`,
      );
      assert.ok(
        explanation.runnerUpScoreToP95Ratio > 0,
        `runnerUpScoreToP95Ratio should be > 0, got ${explanation.runnerUpScoreToP95Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('60606060-3: always <= runnerUpScoreToP90Ratio when both present (P95 >= P90)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('o3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToP95Ratio' in explanation && 'runnerUpScoreToP90Ratio' in explanation) {
      assert.ok(
        explanation.runnerUpScoreToP95Ratio <= explanation.runnerUpScoreToP90Ratio + 1e-9,
        `runnerUpScoreToP95Ratio (${explanation.runnerUpScoreToP95Ratio}) should be <= runnerUpScoreToP90Ratio (${explanation.runnerUpScoreToP90Ratio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('60606060-4: for n=2 equals r / (0.95*w + 0.05*r)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('o4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToP95Ratio' in explanation && explanation.candidateCount === 2 && explanation.candidateScoreP95 > 0) {
      const w = explanation.winnerScore;
      const ru = explanation.runnerUpScore;
      const p95 = 0.95 * w + 0.05 * ru;
      const expected = ru / p95;
      assert.ok(
        Math.abs(explanation.runnerUpScoreToP95Ratio - expected) < 1e-9,
        `runnerUpScoreToP95Ratio (${explanation.runnerUpScoreToP95Ratio}) should equal r/(0.95w+0.05r) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('60606060-5: absent on cast:no_match', async () => {
  const path = dlqPath('o5');
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
      !('runnerUpScoreToP95Ratio' in parsed.explanation),
      `runnerUpScoreToP95Ratio should be absent on no_match, found: ${parsed.explanation.runnerUpScoreToP95Ratio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('60606060-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('o6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('runnerUpScoreToP95Ratio' in explanation),
      `runnerUpScoreToP95Ratio should be absent with single candidate, found: ${explanation.runnerUpScoreToP95Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('60606060-7: identity — runnerUpScoreToP95Ratio * candidateScoreP95 === runnerUpScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('o7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToP95Ratio' in explanation && 'candidateScoreP95' in explanation && 'runnerUpScore' in explanation) {
      const product = explanation.runnerUpScoreToP95Ratio * explanation.candidateScoreP95;
      assert.ok(
        Math.abs(product - explanation.runnerUpScore) < 1e-9,
        `runnerUpScoreToP95Ratio * candidateScoreP95 (${product}) should equal runnerUpScore (${explanation.runnerUpScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('60606060-8: tool description documents runnerUpScoreToP95Ratio', async () => {
  const path = dlqPath('o8');
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
      cast.description?.includes('runnerUpScoreToP95Ratio'),
      `cast description should mention runnerUpScoreToP95Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
