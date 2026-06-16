/**
 * 56565656: explanation.candidateScoreP25ToRunnerUpRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreP25ToRunnerUpRatio: number — ratio of P25 (Q1) to runner-up score:
 * candidateScoreP25 / runnerUpScore.
 *
 * Present when: >= 2 candidates and runnerUpScore > 0.
 * Absent when: no_match, single candidate, or runnerUpScore === 0.
 * Exact inverse of runnerUpScoreToP25Ratio: product === 1.
 * Always >= candidateScoreP10ToRunnerUpRatio when both present (P25 >= P10).
 * Identity: candidateScoreP25ToRunnerUpRatio * runnerUpScore === candidateScoreP25.
 * For n=2: (0.25*w + 0.75*r) / r.
 *
 * Covered:
 *   56565656-1: present when >= 2 candidates and runnerUpScore > 0
 *   56565656-2: > 0 and finite when present
 *   56565656-3: always >= candidateScoreP10ToRunnerUpRatio when both present (P25 >= P10)
 *   56565656-4: for n=2 equals (0.25*w + 0.75*r) / r
 *   56565656-5: absent on cast:no_match
 *   56565656-6: absent when only 1 candidate
 *   56565656-7: identity — candidateScoreP25ToRunnerUpRatio * runnerUpScore === candidateScoreP25
 *   56565656-8: tool description documents candidateScoreP25ToRunnerUpRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-56565656-${label}-${Date.now()}.jsonl`);
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

test('56565656-1: present when >= 2 candidates and runnerUpScore > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if (explanation.runnerUpScore > 0 && 'candidateScoreP25' in explanation) {
      assert.ok('candidateScoreP25ToRunnerUpRatio' in explanation,
        `candidateScoreP25ToRunnerUpRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreP25ToRunnerUpRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('56565656-2: > 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP25ToRunnerUpRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP25ToRunnerUpRatio),
        `should be finite, got ${explanation.candidateScoreP25ToRunnerUpRatio}`,
      );
      assert.ok(
        explanation.candidateScoreP25ToRunnerUpRatio > 0,
        `should be > 0, got ${explanation.candidateScoreP25ToRunnerUpRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('56565656-3: always >= candidateScoreP10ToRunnerUpRatio when both present (P25 >= P10)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP25ToRunnerUpRatio' in explanation && 'candidateScoreP10ToRunnerUpRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreP25ToRunnerUpRatio >= explanation.candidateScoreP10ToRunnerUpRatio - 1e-9,
        `candidateScoreP25ToRunnerUpRatio (${explanation.candidateScoreP25ToRunnerUpRatio}) should be >= candidateScoreP10ToRunnerUpRatio (${explanation.candidateScoreP10ToRunnerUpRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('56565656-4: for n=2 equals (0.25*w + 0.75*r) / r', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP25ToRunnerUpRatio' in explanation && explanation.candidateCount === 2 && explanation.runnerUpScore > 0) {
      const w = explanation.winnerScore;
      const ru = explanation.runnerUpScore;
      const p25 = 0.25 * w + 0.75 * ru;
      const expected = p25 / ru;
      assert.ok(
        Math.abs(explanation.candidateScoreP25ToRunnerUpRatio - expected) < 1e-9,
        `candidateScoreP25ToRunnerUpRatio (${explanation.candidateScoreP25ToRunnerUpRatio}) should equal (0.25w+0.75r)/r (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('56565656-5: absent on cast:no_match', async () => {
  const path = dlqPath('w5');
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
      !('candidateScoreP25ToRunnerUpRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.candidateScoreP25ToRunnerUpRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('56565656-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP25ToRunnerUpRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.candidateScoreP25ToRunnerUpRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('56565656-7: identity — candidateScoreP25ToRunnerUpRatio * runnerUpScore === candidateScoreP25', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP25ToRunnerUpRatio' in explanation && 'candidateScoreP25' in explanation && 'runnerUpScore' in explanation) {
      const product = explanation.candidateScoreP25ToRunnerUpRatio * explanation.runnerUpScore;
      assert.ok(
        Math.abs(product - explanation.candidateScoreP25) < 1e-9,
        `candidateScoreP25ToRunnerUpRatio * runnerUpScore (${product}) should equal candidateScoreP25 (${explanation.candidateScoreP25})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('56565656-8: tool description documents candidateScoreP25ToRunnerUpRatio', async () => {
  const path = dlqPath('w8');
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
      cast.description?.includes('candidateScoreP25ToRunnerUpRatio'),
      `cast description should mention candidateScoreP25ToRunnerUpRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
