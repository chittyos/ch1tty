/**
 * 23232323: explanation.candidateScoreP75ToRunnerUpRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreP75ToRunnerUpRatio: number — ratio of P75 (Q3) to runner-up score:
 * candidateScoreP75 / runnerUpScore.
 *
 * Present when: >= 2 candidates and runnerUpScore > 0.
 * Absent when: no_match, single candidate, or runnerUpScore === 0.
 * Exact inverse of runnerUpScoreToP75Ratio: product === 1.
 * Always <= candidateScoreP90ToRunnerUpRatio when both present (P75 <= P90).
 * Identity: candidateScoreP75ToRunnerUpRatio * runnerUpScore === candidateScoreP75.
 * For n=2: (0.75*w + 0.25*r) / r.
 *
 * Covered:
 *   23232323-1: present when >= 2 candidates and runnerUpScore > 0
 *   23232323-2: > 0 and finite when present
 *   23232323-3: inverse of runnerUpScoreToP75Ratio — product === 1 when both present
 *   23232323-4: for n=2 equals (0.75*w + 0.25*r) / r
 *   23232323-5: absent on cast:no_match
 *   23232323-6: absent when only 1 candidate
 *   23232323-7: identity — candidateScoreP75ToRunnerUpRatio * runnerUpScore === candidateScoreP75
 *   23232323-8: tool description documents candidateScoreP75ToRunnerUpRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-23232323-${label}-${Date.now()}.jsonl`);
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

test('23232323-1: present when >= 2 candidates and runnerUpScore > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if (explanation.runnerUpScore > 0 && 'candidateScoreP75' in explanation) {
      assert.ok('candidateScoreP75ToRunnerUpRatio' in explanation,
        `candidateScoreP75ToRunnerUpRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreP75ToRunnerUpRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('23232323-2: > 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP75ToRunnerUpRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP75ToRunnerUpRatio),
        `should be finite, got ${explanation.candidateScoreP75ToRunnerUpRatio}`,
      );
      assert.ok(
        explanation.candidateScoreP75ToRunnerUpRatio > 0,
        `should be > 0, got ${explanation.candidateScoreP75ToRunnerUpRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('23232323-3: inverse of runnerUpScoreToP75Ratio — product === 1 when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP75ToRunnerUpRatio' in explanation && 'runnerUpScoreToP75Ratio' in explanation) {
      const product = explanation.candidateScoreP75ToRunnerUpRatio * explanation.runnerUpScoreToP75Ratio;
      assert.ok(
        Math.abs(product - 1) < 1e-9,
        `candidateScoreP75ToRunnerUpRatio * runnerUpScoreToP75Ratio (${product}) should equal 1`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('23232323-4: for n=2 equals (0.75*w + 0.25*r) / r', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP75ToRunnerUpRatio' in explanation && explanation.candidateCount === 2 && explanation.runnerUpScore > 0) {
      const w = explanation.winnerScore;
      const ru = explanation.runnerUpScore;
      const p75 = 0.75 * w + 0.25 * ru;
      const expected = p75 / ru;
      assert.ok(
        Math.abs(explanation.candidateScoreP75ToRunnerUpRatio - expected) < 1e-9,
        `candidateScoreP75ToRunnerUpRatio (${explanation.candidateScoreP75ToRunnerUpRatio}) should equal (0.75w+0.25r)/r (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('23232323-5: absent on cast:no_match', async () => {
  const path = dlqPath('t5');
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
      !('candidateScoreP75ToRunnerUpRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.candidateScoreP75ToRunnerUpRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('23232323-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP75ToRunnerUpRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.candidateScoreP75ToRunnerUpRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('23232323-7: identity — candidateScoreP75ToRunnerUpRatio * runnerUpScore === candidateScoreP75', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP75ToRunnerUpRatio' in explanation && 'candidateScoreP75' in explanation && 'runnerUpScore' in explanation) {
      const product = explanation.candidateScoreP75ToRunnerUpRatio * explanation.runnerUpScore;
      assert.ok(
        Math.abs(product - explanation.candidateScoreP75) < 1e-9,
        `candidateScoreP75ToRunnerUpRatio * runnerUpScore (${product}) should equal candidateScoreP75 (${explanation.candidateScoreP75})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('23232323-8: tool description documents candidateScoreP75ToRunnerUpRatio', async () => {
  const path = dlqPath('t8');
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
      cast.description?.includes('candidateScoreP75ToRunnerUpRatio'),
      `cast description should mention candidateScoreP75ToRunnerUpRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
