/**
 * 70707070: explanation.runnerUpScoreToP10Ratio in ch1tty/cast when explain:true.
 *
 * runnerUpScoreToP10Ratio: number — ratio of runner-up score to P10:
 * runnerUpScore / candidateScoreP10.
 *
 * Present when: >= 2 candidates and candidateScoreP10 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP10 === 0.
 * Always >= runnerUpScoreToP75Ratio when both present (P10 <= P75).
 * Identity: runnerUpScoreToP10Ratio * candidateScoreP10 === runnerUpScore.
 * For n=2: r / (0.1*w + 0.9*r).
 *
 * Covered:
 *   70707070-1: present when >= 2 candidates and candidateScoreP10 > 0
 *   70707070-2: > 0 and finite when present
 *   70707070-3: always >= runnerUpScoreToP75Ratio when both present (P10 <= P75)
 *   70707070-4: for n=2 equals r / (0.1*w + 0.9*r)
 *   70707070-5: absent on cast:no_match
 *   70707070-6: absent when only 1 candidate
 *   70707070-7: identity — runnerUpScoreToP10Ratio * candidateScoreP10 === runnerUpScore
 *   70707070-8: tool description documents runnerUpScoreToP10Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-70707070-${label}-${Date.now()}.jsonl`);
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

test('70707070-1: present when >= 2 candidates and candidateScoreP10 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('p1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP10' in explanation && explanation.candidateScoreP10 > 0) {
      assert.ok('runnerUpScoreToP10Ratio' in explanation,
        `runnerUpScoreToP10Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.runnerUpScoreToP10Ratio, 'number', 'runnerUpScoreToP10Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('70707070-2: > 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('p2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToP10Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.runnerUpScoreToP10Ratio),
        `runnerUpScoreToP10Ratio should be finite, got ${explanation.runnerUpScoreToP10Ratio}`,
      );
      assert.ok(
        explanation.runnerUpScoreToP10Ratio > 0,
        `runnerUpScoreToP10Ratio should be > 0, got ${explanation.runnerUpScoreToP10Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('70707070-3: always >= runnerUpScoreToP75Ratio when both present (P10 <= P75)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('p3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToP10Ratio' in explanation && 'runnerUpScoreToP75Ratio' in explanation) {
      assert.ok(
        explanation.runnerUpScoreToP10Ratio >= explanation.runnerUpScoreToP75Ratio - 1e-9,
        `runnerUpScoreToP10Ratio (${explanation.runnerUpScoreToP10Ratio}) should be >= runnerUpScoreToP75Ratio (${explanation.runnerUpScoreToP75Ratio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('70707070-4: for n=2 equals r / (0.1*w + 0.9*r)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('p4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToP10Ratio' in explanation && explanation.candidateCount === 2 && explanation.candidateScoreP10 > 0) {
      const w = explanation.winnerScore;
      const ru = explanation.runnerUpScore;
      const p10 = 0.1 * w + 0.9 * ru;
      const expected = ru / p10;
      assert.ok(
        Math.abs(explanation.runnerUpScoreToP10Ratio - expected) < 1e-9,
        `runnerUpScoreToP10Ratio (${explanation.runnerUpScoreToP10Ratio}) should equal r/(0.1w+0.9r) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('70707070-5: absent on cast:no_match', async () => {
  const path = dlqPath('p5');
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
      !('runnerUpScoreToP10Ratio' in parsed.explanation),
      `runnerUpScoreToP10Ratio should be absent on no_match, found: ${parsed.explanation.runnerUpScoreToP10Ratio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('70707070-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('p6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('runnerUpScoreToP10Ratio' in explanation),
      `runnerUpScoreToP10Ratio should be absent with single candidate, found: ${explanation.runnerUpScoreToP10Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('70707070-7: identity — runnerUpScoreToP10Ratio * candidateScoreP10 === runnerUpScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('p7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToP10Ratio' in explanation && 'candidateScoreP10' in explanation && 'runnerUpScore' in explanation) {
      const product = explanation.runnerUpScoreToP10Ratio * explanation.candidateScoreP10;
      assert.ok(
        Math.abs(product - explanation.runnerUpScore) < 1e-9,
        `runnerUpScoreToP10Ratio * candidateScoreP10 (${product}) should equal runnerUpScore (${explanation.runnerUpScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('70707070-8: tool description documents runnerUpScoreToP10Ratio', async () => {
  const path = dlqPath('p8');
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
      cast.description?.includes('runnerUpScoreToP10Ratio'),
      `cast description should mention runnerUpScoreToP10Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
