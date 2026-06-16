/**
 * 80808080: explanation.runnerUpScoreToP25Ratio in ch1tty/cast when explain:true.
 *
 * runnerUpScoreToP25Ratio: number — ratio of runner-up score to P25 (Q1):
 * runnerUpScore / candidateScoreP25.
 *
 * Present when: >= 2 candidates and candidateScoreP25 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP25 === 0.
 * Always <= runnerUpScoreToP10Ratio when both present (P25 >= P10).
 * Always >= runnerUpScoreToP75Ratio when both present (P25 <= P75).
 * Identity: runnerUpScoreToP25Ratio * candidateScoreP25 === runnerUpScore.
 * For n=2: r / (0.25*w + 0.75*r).
 *
 * Covered:
 *   80808080-1: present when >= 2 candidates and candidateScoreP25 > 0
 *   80808080-2: > 0 and finite when present
 *   80808080-3: always <= runnerUpScoreToP10Ratio when both present (P25 >= P10)
 *   80808080-4: for n=2 equals r / (0.25*w + 0.75*r)
 *   80808080-5: absent on cast:no_match
 *   80808080-6: absent when only 1 candidate
 *   80808080-7: identity — runnerUpScoreToP25Ratio * candidateScoreP25 === runnerUpScore
 *   80808080-8: tool description documents runnerUpScoreToP25Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-80808080-${label}-${Date.now()}.jsonl`);
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

test('80808080-1: present when >= 2 candidates and candidateScoreP25 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP25' in explanation && explanation.candidateScoreP25 > 0) {
      assert.ok('runnerUpScoreToP25Ratio' in explanation,
        `runnerUpScoreToP25Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.runnerUpScoreToP25Ratio, 'number', 'runnerUpScoreToP25Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('80808080-2: > 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToP25Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.runnerUpScoreToP25Ratio),
        `runnerUpScoreToP25Ratio should be finite, got ${explanation.runnerUpScoreToP25Ratio}`,
      );
      assert.ok(
        explanation.runnerUpScoreToP25Ratio > 0,
        `runnerUpScoreToP25Ratio should be > 0, got ${explanation.runnerUpScoreToP25Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('80808080-3: always <= runnerUpScoreToP10Ratio when both present (P25 >= P10)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToP25Ratio' in explanation && 'runnerUpScoreToP10Ratio' in explanation) {
      assert.ok(
        explanation.runnerUpScoreToP25Ratio <= explanation.runnerUpScoreToP10Ratio + 1e-9,
        `runnerUpScoreToP25Ratio (${explanation.runnerUpScoreToP25Ratio}) should be <= runnerUpScoreToP10Ratio (${explanation.runnerUpScoreToP10Ratio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('80808080-4: for n=2 equals r / (0.25*w + 0.75*r)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToP25Ratio' in explanation && explanation.candidateCount === 2 && explanation.candidateScoreP25 > 0) {
      const w = explanation.winnerScore;
      const ru = explanation.runnerUpScore;
      const p25 = 0.25 * w + 0.75 * ru;
      const expected = ru / p25;
      assert.ok(
        Math.abs(explanation.runnerUpScoreToP25Ratio - expected) < 1e-9,
        `runnerUpScoreToP25Ratio (${explanation.runnerUpScoreToP25Ratio}) should equal r/(0.25w+0.75r) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('80808080-5: absent on cast:no_match', async () => {
  const path = dlqPath('q5');
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
      !('runnerUpScoreToP25Ratio' in parsed.explanation),
      `runnerUpScoreToP25Ratio should be absent on no_match, found: ${parsed.explanation.runnerUpScoreToP25Ratio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('80808080-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('runnerUpScoreToP25Ratio' in explanation),
      `runnerUpScoreToP25Ratio should be absent with single candidate, found: ${explanation.runnerUpScoreToP25Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('80808080-7: identity — runnerUpScoreToP25Ratio * candidateScoreP25 === runnerUpScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToP25Ratio' in explanation && 'candidateScoreP25' in explanation && 'runnerUpScore' in explanation) {
      const product = explanation.runnerUpScoreToP25Ratio * explanation.candidateScoreP25;
      assert.ok(
        Math.abs(product - explanation.runnerUpScore) < 1e-9,
        `runnerUpScoreToP25Ratio * candidateScoreP25 (${product}) should equal runnerUpScore (${explanation.runnerUpScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('80808080-8: tool description documents runnerUpScoreToP25Ratio', async () => {
  const path = dlqPath('q8');
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
      cast.description?.includes('runnerUpScoreToP25Ratio'),
      `cast description should mention runnerUpScoreToP25Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
