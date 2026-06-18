/**
 * 67676767: explanation.candidateScoreP05ToRunnerUpRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreP05ToRunnerUpRatio: number — ratio of P05 to runner-up score:
 * candidateScoreP05 / runnerUpScore.
 *
 * Present when: >= 2 candidates and runnerUpScore > 0.
 * Absent when: no_match, single candidate, or runnerUpScore === 0.
 * Exact inverse of runnerUpScoreToP05Ratio: product === 1.
 * Always <= candidateScoreP10ToRunnerUpRatio when both present (P05 <= P10).
 * Identity: candidateScoreP05ToRunnerUpRatio * runnerUpScore === candidateScoreP05.
 * For n=2: (0.05*w + 0.95*r) / r.
 *
 * Covered:
 *   67676767-1: present when >= 2 candidates and runnerUpScore > 0
 *   67676767-2: > 0 and finite when present
 *   67676767-3: always <= candidateScoreP10ToRunnerUpRatio when both present (P05 <= P10)
 *   67676767-4: for n=2 equals (0.05*w + 0.95*r) / r
 *   67676767-5: absent on cast:no_match
 *   67676767-6: absent when only 1 candidate
 *   67676767-7: identity — candidateScoreP05ToRunnerUpRatio * runnerUpScore === candidateScoreP05
 *   67676767-8: tool description documents candidateScoreP05ToRunnerUpRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-67676767-${label}-${Date.now()}.jsonl`);
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

test('67676767-1: present when >= 2 candidates and runnerUpScore > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('x1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if (explanation.runnerUpScore > 0 && 'candidateScoreP05' in explanation) {
      assert.ok('candidateScoreP05ToRunnerUpRatio' in explanation,
        `candidateScoreP05ToRunnerUpRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreP05ToRunnerUpRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('67676767-2: > 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('x2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP05ToRunnerUpRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP05ToRunnerUpRatio),
        `should be finite, got ${explanation.candidateScoreP05ToRunnerUpRatio}`,
      );
      assert.ok(
        explanation.candidateScoreP05ToRunnerUpRatio > 0,
        `should be > 0, got ${explanation.candidateScoreP05ToRunnerUpRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('67676767-3: always <= candidateScoreP10ToRunnerUpRatio when both present (P05 <= P10)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('x3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP05ToRunnerUpRatio' in explanation && 'candidateScoreP10ToRunnerUpRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreP05ToRunnerUpRatio <= explanation.candidateScoreP10ToRunnerUpRatio + 1e-9,
        `candidateScoreP05ToRunnerUpRatio (${explanation.candidateScoreP05ToRunnerUpRatio}) should be <= candidateScoreP10ToRunnerUpRatio (${explanation.candidateScoreP10ToRunnerUpRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('67676767-4: for n=2 equals (0.05*w + 0.95*r) / r', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('x4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP05ToRunnerUpRatio' in explanation && explanation.candidateCount === 2 && explanation.runnerUpScore > 0) {
      const w = explanation.winnerScore;
      const ru = explanation.runnerUpScore;
      const p05 = 0.05 * w + 0.95 * ru;
      const expected = p05 / ru;
      assert.ok(
        Math.abs(explanation.candidateScoreP05ToRunnerUpRatio - expected) < 1e-9,
        `candidateScoreP05ToRunnerUpRatio (${explanation.candidateScoreP05ToRunnerUpRatio}) should equal (0.05w+0.95r)/r (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('67676767-5: absent on cast:no_match', async () => {
  const path = dlqPath('x5');
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
      !('candidateScoreP05ToRunnerUpRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.candidateScoreP05ToRunnerUpRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('67676767-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('x6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP05ToRunnerUpRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.candidateScoreP05ToRunnerUpRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('67676767-7: identity — candidateScoreP05ToRunnerUpRatio * runnerUpScore === candidateScoreP05', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('x7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP05ToRunnerUpRatio' in explanation && 'candidateScoreP05' in explanation && 'runnerUpScore' in explanation) {
      const product = explanation.candidateScoreP05ToRunnerUpRatio * explanation.runnerUpScore;
      assert.ok(
        Math.abs(product - explanation.candidateScoreP05) < 1e-9,
        `candidateScoreP05ToRunnerUpRatio * runnerUpScore (${product}) should equal candidateScoreP05 (${explanation.candidateScoreP05})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('67676767-8: tool description documents candidateScoreP05ToRunnerUpRatio', async () => {
  const path = dlqPath('x8');
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
      cast.description?.includes('candidateScoreP05ToRunnerUpRatio'),
      `cast description should mention candidateScoreP05ToRunnerUpRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
