/**
 * 19191919: explanation.candidateScoreGeometricMeanToRunnerUpRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreGeometricMeanToRunnerUpRatio: number — ratio of geometric mean to runner-up score:
 * candidateScoreGeometricMean / runnerUpScore.
 *
 * Present when: >= 2 candidates, all scores > 0 (GM defined), and runnerUpScore > 0.
 * Absent when: no_match, single candidate, any score === 0, runnerUpScore === 0.
 * No fixed bound relative to 1 (GM vs runner-up can go either way).
 * Exact inverse of runnerUpScoreToGeometricMeanRatio: product === 1.
 * For n=2: GM = sqrt(wr), runner-up = r; ratio = sqrt(w/r) = sqrt(winnerScoreRatio).
 * Identity: candidateScoreGeometricMeanToRunnerUpRatio * runnerUpScore === candidateScoreGeometricMean.
 *
 * Covered:
 *   19191919-1: present when >= 2 candidates, all scores > 0, and runnerUpScore > 0
 *   19191919-2: > 0 and finite when present
 *   19191919-3: inverse of runnerUpScoreToGeometricMeanRatio — product === 1 when both present
 *   19191919-4: for n=2 equals sqrt(winnerScoreRatio)
 *   19191919-5: absent on cast:no_match
 *   19191919-6: absent when only 1 candidate
 *   19191919-7: identity — candidateScoreGeometricMeanToRunnerUpRatio * runnerUpScore === candidateScoreGeometricMean
 *   19191919-8: tool description documents candidateScoreGeometricMeanToRunnerUpRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-19191919-${label}-${Date.now()}.jsonl`);
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

test('19191919-1: present when >= 2 candidates, all scores > 0, and runnerUpScore > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('tt1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreGeometricMean' in explanation && explanation.candidateScoreGeometricMean > 0 &&
        'runnerUpScore' in explanation && explanation.runnerUpScore > 0) {
      assert.ok('candidateScoreGeometricMeanToRunnerUpRatio' in explanation,
        `candidateScoreGeometricMeanToRunnerUpRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreGeometricMeanToRunnerUpRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('19191919-2: > 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('tt2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreGeometricMeanToRunnerUpRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreGeometricMeanToRunnerUpRatio),
        `should be finite, got ${explanation.candidateScoreGeometricMeanToRunnerUpRatio}`,
      );
      assert.ok(
        explanation.candidateScoreGeometricMeanToRunnerUpRatio > 0,
        `should be > 0, got ${explanation.candidateScoreGeometricMeanToRunnerUpRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('19191919-3: inverse of runnerUpScoreToGeometricMeanRatio — product === 1 when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('tt3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreGeometricMeanToRunnerUpRatio' in explanation && 'runnerUpScoreToGeometricMeanRatio' in explanation) {
      const product = explanation.candidateScoreGeometricMeanToRunnerUpRatio * explanation.runnerUpScoreToGeometricMeanRatio;
      assert.ok(
        Math.abs(product - 1) < 1e-9,
        `candidateScoreGeometricMeanToRunnerUpRatio * runnerUpScoreToGeometricMeanRatio (${product}) should equal 1`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('19191919-4: for n=2 equals sqrt(winnerScoreRatio)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('tt4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreGeometricMeanToRunnerUpRatio' in explanation && explanation.candidateCount === 2 &&
        explanation.winnerScore > 0 && explanation.runnerUpScore > 0) {
      const w = explanation.winnerScore;
      const ru = explanation.runnerUpScore;
      const expected = Math.sqrt(w / ru);
      assert.ok(
        Math.abs(explanation.candidateScoreGeometricMeanToRunnerUpRatio - expected) < 1e-9,
        `candidateScoreGeometricMeanToRunnerUpRatio (${explanation.candidateScoreGeometricMeanToRunnerUpRatio}) should equal sqrt(w/r) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('19191919-5: absent on cast:no_match', async () => {
  const path = dlqPath('tt5');
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
      !('candidateScoreGeometricMeanToRunnerUpRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.candidateScoreGeometricMeanToRunnerUpRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('19191919-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('tt6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreGeometricMeanToRunnerUpRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.candidateScoreGeometricMeanToRunnerUpRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('19191919-7: identity — candidateScoreGeometricMeanToRunnerUpRatio * runnerUpScore === candidateScoreGeometricMean', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('tt7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreGeometricMeanToRunnerUpRatio' in explanation &&
        'runnerUpScore' in explanation &&
        'candidateScoreGeometricMean' in explanation) {
      const product = explanation.candidateScoreGeometricMeanToRunnerUpRatio * explanation.runnerUpScore;
      assert.ok(
        Math.abs(product - explanation.candidateScoreGeometricMean) < 1e-9,
        `candidateScoreGeometricMeanToRunnerUpRatio * runnerUpScore (${product}) should equal candidateScoreGeometricMean (${explanation.candidateScoreGeometricMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('19191919-8: tool description documents candidateScoreGeometricMeanToRunnerUpRatio', async () => {
  const path = dlqPath('tt8');
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
      cast.description?.includes('candidateScoreGeometricMeanToRunnerUpRatio'),
      `cast description should mention candidateScoreGeometricMeanToRunnerUpRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
