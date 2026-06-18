/**
 * MMMMMMMM: explanation.candidateScoreFieldStrengthRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreFieldStrengthRatio: number — ratio of non-winner field mean to
 * winner score: candidateScoreNonWinnerMean / winnerScore.
 *
 * Present when: >= 2 candidates and winnerScore > 0.
 * Absent when: no_match, single candidate, or winnerScore === 0.
 * Always in [0, 1].
 * Always <= candidateScoreMeanRatio (non-winner mean <= full mean).
 * For n=2: equals runnerUpScore / winnerScore = 1 / winnerScoreRatio.
 * Identity: candidateScoreFieldStrengthRatio * winnerScore === candidateScoreNonWinnerMean.
 *
 * Covered:
 *   MMMMMMMM-1: present when >= 2 candidates and winnerScore > 0
 *   MMMMMMMM-2: always in [0, 1] and finite when present
 *   MMMMMMMM-3: always <= candidateScoreMeanRatio when both present
 *   MMMMMMMM-4: for n=2 equals runnerUpScore / winnerScore
 *   MMMMMMMM-5: absent on cast:no_match
 *   MMMMMMMM-6: absent when only 1 candidate
 *   MMMMMMMM-7: identity — equals candidateScoreNonWinnerMean / winnerScore
 *   MMMMMMMM-8: tool description documents candidateScoreFieldStrengthRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-mmmmmmmm-${label}-${Date.now()}.jsonl`);
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

test('MMMMMMMM-1: present when >= 2 candidates and winnerScore > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('m1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if (explanation.winnerScore > 0) {
      assert.ok('candidateScoreFieldStrengthRatio' in explanation,
        `candidateScoreFieldStrengthRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreFieldStrengthRatio, 'number', 'candidateScoreFieldStrengthRatio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('MMMMMMMM-2: always in [0, 1] and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('m2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreFieldStrengthRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreFieldStrengthRatio),
        `candidateScoreFieldStrengthRatio should be finite, got ${explanation.candidateScoreFieldStrengthRatio}`,
      );
      assert.ok(
        explanation.candidateScoreFieldStrengthRatio >= -1e-9,
        `candidateScoreFieldStrengthRatio should be >= 0, got ${explanation.candidateScoreFieldStrengthRatio}`,
      );
      assert.ok(
        explanation.candidateScoreFieldStrengthRatio <= 1 + 1e-9,
        `candidateScoreFieldStrengthRatio should be <= 1, got ${explanation.candidateScoreFieldStrengthRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('MMMMMMMM-3: always <= candidateScoreMeanRatio when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('m3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreFieldStrengthRatio' in explanation && 'candidateScoreMeanRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreFieldStrengthRatio <= explanation.candidateScoreMeanRatio + 1e-9,
        `candidateScoreFieldStrengthRatio (${explanation.candidateScoreFieldStrengthRatio}) should be <= candidateScoreMeanRatio (${explanation.candidateScoreMeanRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('MMMMMMMM-4: for n=2 equals runnerUpScore / winnerScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('m4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreFieldStrengthRatio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0) {
      const expected = explanation.runnerUpScore / explanation.winnerScore;
      assert.ok(
        Math.abs(explanation.candidateScoreFieldStrengthRatio - expected) < 1e-9,
        `candidateScoreFieldStrengthRatio (${explanation.candidateScoreFieldStrengthRatio}) should equal runnerUpScore/winnerScore (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('MMMMMMMM-5: absent on cast:no_match', async () => {
  const path = dlqPath('m5');
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
      !('candidateScoreFieldStrengthRatio' in parsed.explanation),
      `candidateScoreFieldStrengthRatio should be absent on no_match, found: ${parsed.explanation.candidateScoreFieldStrengthRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('MMMMMMMM-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('m6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreFieldStrengthRatio' in explanation),
      `candidateScoreFieldStrengthRatio should be absent with single candidate, found: ${explanation.candidateScoreFieldStrengthRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('MMMMMMMM-7: identity — equals candidateScoreNonWinnerMean / winnerScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('m7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreFieldStrengthRatio' in explanation && 'candidateScoreNonWinnerMean' in explanation && explanation.winnerScore > 0) {
      const expected = explanation.candidateScoreNonWinnerMean / explanation.winnerScore;
      assert.ok(
        Math.abs(explanation.candidateScoreFieldStrengthRatio - expected) < 1e-9,
        `candidateScoreFieldStrengthRatio (${explanation.candidateScoreFieldStrengthRatio}) should equal candidateScoreNonWinnerMean/winnerScore (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('MMMMMMMM-8: tool description documents candidateScoreFieldStrengthRatio', async () => {
  const path = dlqPath('m8');
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
      cast.description?.includes('candidateScoreFieldStrengthRatio'),
      `cast description should mention candidateScoreFieldStrengthRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
