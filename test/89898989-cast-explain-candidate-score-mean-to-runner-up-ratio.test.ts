/**
 * 89898989: explanation.candidateScoreMeanToRunnerUpRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreMeanToRunnerUpRatio: number — ratio of full-pool mean to runner-up score:
 * candidateScoreMean / runnerUpScore.
 *
 * Present when: >= 2 candidates and runnerUpScore > 0.
 * Absent when: no_match, single candidate, or runnerUpScore === 0.
 * Exact inverse of runnerUpScoreToMeanRatio: product === 1.
 * Identity: candidateScoreMeanToRunnerUpRatio * runnerUpScore === candidateScoreMean.
 * For n=2: (w + r) / (2 * r).
 *
 * Covered:
 *   89898989-1: present when >= 2 candidates and runnerUpScore > 0
 *   89898989-2: > 0 and finite when present
 *   89898989-3: inverse of runnerUpScoreToMeanRatio — product === 1 when both present
 *   89898989-4: for n=2 equals (w + r) / (2 * r)
 *   89898989-5: absent on cast:no_match
 *   89898989-6: absent when only 1 candidate
 *   89898989-7: identity — candidateScoreMeanToRunnerUpRatio * runnerUpScore === candidateScoreMean
 *   89898989-8: tool description documents candidateScoreMeanToRunnerUpRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-89898989-${label}-${Date.now()}.jsonl`);
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

test('89898989-1: present when >= 2 candidates and runnerUpScore > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if (explanation.runnerUpScore > 0) {
      assert.ok('candidateScoreMeanToRunnerUpRatio' in explanation,
        `candidateScoreMeanToRunnerUpRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreMeanToRunnerUpRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('89898989-2: > 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToRunnerUpRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreMeanToRunnerUpRatio),
        `should be finite, got ${explanation.candidateScoreMeanToRunnerUpRatio}`,
      );
      assert.ok(
        explanation.candidateScoreMeanToRunnerUpRatio > 0,
        `should be > 0, got ${explanation.candidateScoreMeanToRunnerUpRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('89898989-3: inverse of runnerUpScoreToMeanRatio — product === 1 when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToRunnerUpRatio' in explanation && 'runnerUpScoreToMeanRatio' in explanation) {
      const product = explanation.candidateScoreMeanToRunnerUpRatio * explanation.runnerUpScoreToMeanRatio;
      assert.ok(
        Math.abs(product - 1) < 1e-9,
        `candidateScoreMeanToRunnerUpRatio * runnerUpScoreToMeanRatio (${product}) should equal 1`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('89898989-4: for n=2 equals (w + r) / (2 * r)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToRunnerUpRatio' in explanation && explanation.candidateCount === 2 && explanation.runnerUpScore > 0) {
      const w = explanation.winnerScore;
      const ru = explanation.runnerUpScore;
      const expected = (w + ru) / (2 * ru);
      assert.ok(
        Math.abs(explanation.candidateScoreMeanToRunnerUpRatio - expected) < 1e-9,
        `candidateScoreMeanToRunnerUpRatio (${explanation.candidateScoreMeanToRunnerUpRatio}) should equal (w+r)/(2r) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('89898989-5: absent on cast:no_match', async () => {
  const path = dlqPath('z5');
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
      !('candidateScoreMeanToRunnerUpRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.candidateScoreMeanToRunnerUpRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('89898989-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreMeanToRunnerUpRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.candidateScoreMeanToRunnerUpRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('89898989-7: identity — candidateScoreMeanToRunnerUpRatio * runnerUpScore === candidateScoreMean', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToRunnerUpRatio' in explanation && 'candidateScoreMean' in explanation && 'runnerUpScore' in explanation) {
      const product = explanation.candidateScoreMeanToRunnerUpRatio * explanation.runnerUpScore;
      assert.ok(
        Math.abs(product - explanation.candidateScoreMean) < 1e-9,
        `candidateScoreMeanToRunnerUpRatio * runnerUpScore (${product}) should equal candidateScoreMean (${explanation.candidateScoreMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('89898989-8: tool description documents candidateScoreMeanToRunnerUpRatio', async () => {
  const path = dlqPath('z8');
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
      cast.description?.includes('candidateScoreMeanToRunnerUpRatio'),
      `cast description should mention candidateScoreMeanToRunnerUpRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
