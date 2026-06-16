/**
 * 01010101: explanation.runnerUpScoreToMedianRatio in ch1tty/cast when explain:true.
 *
 * runnerUpScoreToMedianRatio: number — ratio of runner-up score to full-pool median:
 * runnerUpScore / medianCandidateScore.
 *
 * Present when: >= 2 candidates and medianCandidateScore > 0.
 * Absent when: no_match, single candidate, or medianCandidateScore === 0.
 * Three-field invariant: winnerToMedianRatio === runnerUpScoreToMedianRatio * winnerScoreRatio.
 * Identity: runnerUpScoreToMedianRatio * medianCandidateScore === runnerUpScore.
 * For n=2: 2r / (w + r).
 *
 * Covered:
 *   01010101-1: present when >= 2 candidates and medianCandidateScore > 0
 *   01010101-2: > 0 and finite when present
 *   01010101-3: three-field invariant — winnerToMedianRatio === runnerUpScoreToMedianRatio * winnerScoreRatio
 *   01010101-4: for n=2 equals 2r / (w + r)
 *   01010101-5: absent on cast:no_match
 *   01010101-6: absent when only 1 candidate
 *   01010101-7: identity — runnerUpScoreToMedianRatio * medianCandidateScore === runnerUpScore
 *   01010101-8: tool description documents runnerUpScoreToMedianRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-01010101-${label}-${Date.now()}.jsonl`);
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

test('01010101-1: present when >= 2 candidates and medianCandidateScore > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('bb1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('medianCandidateScore' in explanation && explanation.medianCandidateScore > 0) {
      assert.ok('runnerUpScoreToMedianRatio' in explanation,
        `runnerUpScoreToMedianRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.runnerUpScoreToMedianRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('01010101-2: > 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('bb2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToMedianRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.runnerUpScoreToMedianRatio),
        `should be finite, got ${explanation.runnerUpScoreToMedianRatio}`,
      );
      assert.ok(
        explanation.runnerUpScoreToMedianRatio > 0,
        `should be > 0, got ${explanation.runnerUpScoreToMedianRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('01010101-3: winnerToMedianRatio === runnerUpScoreToMedianRatio * winnerScoreRatio when all present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('bb3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToMedianRatio' in explanation && 'winnerToMedianRatio' in explanation && 'winnerScoreRatio' in explanation) {
      const product = explanation.runnerUpScoreToMedianRatio * explanation.winnerScoreRatio;
      assert.ok(
        Math.abs(product - explanation.winnerToMedianRatio) < 1e-9,
        `runnerUpScoreToMedianRatio * winnerScoreRatio (${product}) should equal winnerToMedianRatio (${explanation.winnerToMedianRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('01010101-4: for n=2 equals 2r / (w + r)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('bb4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToMedianRatio' in explanation && explanation.candidateCount === 2 && explanation.medianCandidateScore > 0) {
      const w = explanation.winnerScore;
      const ru = explanation.runnerUpScore;
      const expected = (2 * ru) / (w + ru);
      assert.ok(
        Math.abs(explanation.runnerUpScoreToMedianRatio - expected) < 1e-9,
        `runnerUpScoreToMedianRatio (${explanation.runnerUpScoreToMedianRatio}) should equal 2r/(w+r) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('01010101-5: absent on cast:no_match', async () => {
  const path = dlqPath('bb5');
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
      !('runnerUpScoreToMedianRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.runnerUpScoreToMedianRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('01010101-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('bb6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('runnerUpScoreToMedianRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.runnerUpScoreToMedianRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('01010101-7: identity — runnerUpScoreToMedianRatio * medianCandidateScore === runnerUpScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('bb7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreToMedianRatio' in explanation && 'medianCandidateScore' in explanation && 'runnerUpScore' in explanation) {
      const product = explanation.runnerUpScoreToMedianRatio * explanation.medianCandidateScore;
      assert.ok(
        Math.abs(product - explanation.runnerUpScore) < 1e-9,
        `runnerUpScoreToMedianRatio * medianCandidateScore (${product}) should equal runnerUpScore (${explanation.runnerUpScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('01010101-8: tool description documents runnerUpScoreToMedianRatio', async () => {
  const path = dlqPath('bb8');
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
      cast.description?.includes('runnerUpScoreToMedianRatio'),
      `cast description should mention runnerUpScoreToMedianRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
