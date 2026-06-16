/**
 * 50505050: explanation.runnerUpScoreToP75Ratio in ch1tty/cast when explain:true.
 *
 * runnerUpScoreToP75Ratio: number — ratio of runner-up score to P75 (Q3):
 * runnerUpScore / candidateScoreP75.
 *
 * Present when: >= 2 candidates and candidateScoreP75 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP75 === 0.
 * Always <= winnerScoreToP75Ratio when both present (runnerUp <= winner).
 * Always >= runnerUpScoreToP90Ratio when both present (P75 <= P90).
 * Identity: runnerUpScoreToP75Ratio * candidateScoreP75 === runnerUpScore.
 * For n=2: r / (0.75*w + 0.25*r).
 *
 * Covered:
 *   50505050-1: present when >= 2 candidates and candidateScoreP75 > 0
 *   50505050-2: > 0 and finite when present
 *   50505050-3: always >= runnerUpScoreToP90Ratio when both present (P75 <= P90)
 *   50505050-4: for n=2 equals r / (0.75*w + 0.25*r)
 *   50505050-5: absent on cast:no_match
 *   50505050-6: absent when only 1 candidate
 *   50505050-7: identity — runnerUpScoreToP75Ratio * candidateScoreP75 === runnerUpScore
 *   50505050-8: tool description documents runnerUpScoreToP75Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-50505050-${label}-${Date.now()}.jsonl`);
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

test('50505050-1: present when >= 2 candidates and candidateScoreP75 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('n1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP75' in explanation && explanation.candidateScoreP75 > 0) {
      assert.ok('runnerUpScoreToP75Ratio' in explanation,
        `runnerUpScoreToP75Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.runnerUpScoreToP75Ratio, 'number', 'runnerUpScoreToP75Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('50505050-2: > 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('n2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToP75Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.runnerUpScoreToP75Ratio),
        `runnerUpScoreToP75Ratio should be finite, got ${explanation.runnerUpScoreToP75Ratio}`,
      );
      assert.ok(
        explanation.runnerUpScoreToP75Ratio > 0,
        `runnerUpScoreToP75Ratio should be > 0, got ${explanation.runnerUpScoreToP75Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('50505050-3: always >= runnerUpScoreToP90Ratio when both present (P75 <= P90)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('n3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToP75Ratio' in explanation && 'runnerUpScoreToP90Ratio' in explanation) {
      assert.ok(
        explanation.runnerUpScoreToP75Ratio >= explanation.runnerUpScoreToP90Ratio - 1e-9,
        `runnerUpScoreToP75Ratio (${explanation.runnerUpScoreToP75Ratio}) should be >= runnerUpScoreToP90Ratio (${explanation.runnerUpScoreToP90Ratio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('50505050-4: for n=2 equals r / (0.75*w + 0.25*r)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('n4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToP75Ratio' in explanation && explanation.candidateCount === 2 && explanation.candidateScoreP75 > 0) {
      const w = explanation.winnerScore;
      const ru = explanation.runnerUpScore;
      const p75 = 0.75 * w + 0.25 * ru;
      const expected = ru / p75;
      assert.ok(
        Math.abs(explanation.runnerUpScoreToP75Ratio - expected) < 1e-9,
        `runnerUpScoreToP75Ratio (${explanation.runnerUpScoreToP75Ratio}) should equal r/(0.75w+0.25r) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('50505050-5: absent on cast:no_match', async () => {
  const path = dlqPath('n5');
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
      !('runnerUpScoreToP75Ratio' in parsed.explanation),
      `runnerUpScoreToP75Ratio should be absent on no_match, found: ${parsed.explanation.runnerUpScoreToP75Ratio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('50505050-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('n6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('runnerUpScoreToP75Ratio' in explanation),
      `runnerUpScoreToP75Ratio should be absent with single candidate, found: ${explanation.runnerUpScoreToP75Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('50505050-7: identity — runnerUpScoreToP75Ratio * candidateScoreP75 === runnerUpScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('n7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToP75Ratio' in explanation && 'candidateScoreP75' in explanation && 'runnerUpScore' in explanation) {
      const product = explanation.runnerUpScoreToP75Ratio * explanation.candidateScoreP75;
      assert.ok(
        Math.abs(product - explanation.runnerUpScore) < 1e-9,
        `runnerUpScoreToP75Ratio * candidateScoreP75 (${product}) should equal runnerUpScore (${explanation.runnerUpScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('50505050-8: tool description documents runnerUpScoreToP75Ratio', async () => {
  const path = dlqPath('n8');
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
      cast.description?.includes('runnerUpScoreToP75Ratio'),
      `cast description should mention runnerUpScoreToP75Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
