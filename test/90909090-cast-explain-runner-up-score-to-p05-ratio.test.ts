/**
 * 90909090: explanation.runnerUpScoreToP05Ratio in ch1tty/cast when explain:true.
 *
 * runnerUpScoreToP05Ratio: number — ratio of runner-up score to P05:
 * runnerUpScore / candidateScoreP05.
 *
 * Present when: >= 2 candidates and candidateScoreP05 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP05 === 0.
 * Largest of the runnerUp/Px family (P05 is the smallest denominator).
 * Always >= runnerUpScoreToP10Ratio when both present (P05 <= P10).
 * Identity: runnerUpScoreToP05Ratio * candidateScoreP05 === runnerUpScore.
 * For n=2: r / (0.05*w + 0.95*r).
 *
 * Covered:
 *   90909090-1: present when >= 2 candidates and candidateScoreP05 > 0
 *   90909090-2: > 0 and finite when present
 *   90909090-3: always >= runnerUpScoreToP10Ratio when both present (P05 <= P10)
 *   90909090-4: for n=2 equals r / (0.05*w + 0.95*r)
 *   90909090-5: absent on cast:no_match
 *   90909090-6: absent when only 1 candidate
 *   90909090-7: identity — runnerUpScoreToP05Ratio * candidateScoreP05 === runnerUpScore
 *   90909090-8: tool description documents runnerUpScoreToP05Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-90909090-${label}-${Date.now()}.jsonl`);
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

test('90909090-1: present when >= 2 candidates and candidateScoreP05 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('r1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP05' in explanation && explanation.candidateScoreP05 > 0) {
      assert.ok('runnerUpScoreToP05Ratio' in explanation,
        `runnerUpScoreToP05Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.runnerUpScoreToP05Ratio, 'number', 'runnerUpScoreToP05Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('90909090-2: > 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('r2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToP05Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.runnerUpScoreToP05Ratio),
        `runnerUpScoreToP05Ratio should be finite, got ${explanation.runnerUpScoreToP05Ratio}`,
      );
      assert.ok(
        explanation.runnerUpScoreToP05Ratio > 0,
        `runnerUpScoreToP05Ratio should be > 0, got ${explanation.runnerUpScoreToP05Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('90909090-3: always >= runnerUpScoreToP10Ratio when both present (P05 <= P10)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('r3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToP05Ratio' in explanation && 'runnerUpScoreToP10Ratio' in explanation) {
      assert.ok(
        explanation.runnerUpScoreToP05Ratio >= explanation.runnerUpScoreToP10Ratio - 1e-9,
        `runnerUpScoreToP05Ratio (${explanation.runnerUpScoreToP05Ratio}) should be >= runnerUpScoreToP10Ratio (${explanation.runnerUpScoreToP10Ratio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('90909090-4: for n=2 equals r / (0.05*w + 0.95*r)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('r4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToP05Ratio' in explanation && explanation.candidateCount === 2 && explanation.candidateScoreP05 > 0) {
      const w = explanation.winnerScore;
      const ru = explanation.runnerUpScore;
      const p05 = 0.05 * w + 0.95 * ru;
      const expected = ru / p05;
      assert.ok(
        Math.abs(explanation.runnerUpScoreToP05Ratio - expected) < 1e-9,
        `runnerUpScoreToP05Ratio (${explanation.runnerUpScoreToP05Ratio}) should equal r/(0.05w+0.95r) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('90909090-5: absent on cast:no_match', async () => {
  const path = dlqPath('r5');
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
      !('runnerUpScoreToP05Ratio' in parsed.explanation),
      `runnerUpScoreToP05Ratio should be absent on no_match, found: ${parsed.explanation.runnerUpScoreToP05Ratio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('90909090-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('r6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('runnerUpScoreToP05Ratio' in explanation),
      `runnerUpScoreToP05Ratio should be absent with single candidate, found: ${explanation.runnerUpScoreToP05Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('90909090-7: identity — runnerUpScoreToP05Ratio * candidateScoreP05 === runnerUpScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('r7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToP05Ratio' in explanation && 'candidateScoreP05' in explanation && 'runnerUpScore' in explanation) {
      const product = explanation.runnerUpScoreToP05Ratio * explanation.candidateScoreP05;
      assert.ok(
        Math.abs(product - explanation.runnerUpScore) < 1e-9,
        `runnerUpScoreToP05Ratio * candidateScoreP05 (${product}) should equal runnerUpScore (${explanation.runnerUpScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('90909090-8: tool description documents runnerUpScoreToP05Ratio', async () => {
  const path = dlqPath('r8');
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
      cast.description?.includes('runnerUpScoreToP05Ratio'),
      `cast description should mention runnerUpScoreToP05Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
