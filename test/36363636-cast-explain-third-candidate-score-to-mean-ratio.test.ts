/**
 * 36363636: explanation.thirdCandidateScoreToMeanRatio in ch1tty/cast when explain:true.
 *
 * thirdCandidateScoreToMeanRatio: number — 3rd-ranked candidate score as fraction of pool mean:
 * thirdCandidateScore / candidateScoreMean.
 *
 * Present when: >= 3 candidates and candidateScoreMean > 0.
 * Absent when: no_match, fewer than 3 candidates, or all scores 0.
 * Always >= 0: thirdCandidateScore is non-negative.
 * Always >= candidateScoreLowestToMeanRatio: 3rd >= lowest, same denominator.
 * Always <= runnerUpScoreToMeanRatio: 3rd <= runner-up, same denominator.
 * For n=3: equals candidateScoreLowestToMeanRatio (3rd === lowest when n=3).
 * Identity: thirdCandidateScoreToMeanRatio * candidateScoreMean === thirdCandidateScore.
 *
 * Covered:
 *   36363636-1: present when >= 3 candidates and mean > 0
 *   36363636-2: always finite and >= 0 when present
 *   36363636-3: always >= candidateScoreLowestToMeanRatio and <= runnerUpScoreToMeanRatio when all present
 *   36363636-4: for n=3 equals candidateScoreLowestToMeanRatio
 *   36363636-5: absent on cast:no_match
 *   36363636-6: absent when fewer than 3 candidates
 *   36363636-7: identity — thirdCandidateScoreToMeanRatio * candidateScoreMean === thirdCandidateScore
 *   36363636-8: tool description documents thirdCandidateScoreToMeanRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-36363636-${label}-${Date.now()}.jsonl`);
}

const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe Payments', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.test/mcp',
};
const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.test/mcp',
};
const LINEAR_CFG: ServerConfig = {
  id: 'linear', name: 'Linear', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://linear.test/mcp',
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

const stripeTools: ToolEntry[] = [
  { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
];
const neonTools: ToolEntry[] = [
  { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
];
const linearTools: ToolEntry[] = [
  { name: 'create_issue', description: 'billing issue tracking project', inputSchema: { type: 'object', properties: {} } },
];

test('36363636-1: present when >= 3 candidates and mean > 0', async () => {
  const agg = buildAgg('kkk1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3 && explanation.candidateScoreMean > 0) {
      assert.ok('thirdCandidateScoreToMeanRatio' in explanation,
        `thirdCandidateScoreToMeanRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.thirdCandidateScoreToMeanRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('36363636-2: always finite and >= 0 when present', async () => {
  const agg = buildAgg('kkk2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('thirdCandidateScoreToMeanRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.thirdCandidateScoreToMeanRatio),
        `should be finite, got ${explanation.thirdCandidateScoreToMeanRatio}`,
      );
      assert.ok(
        explanation.thirdCandidateScoreToMeanRatio >= 0,
        `should be >= 0, got ${explanation.thirdCandidateScoreToMeanRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('36363636-3: always >= candidateScoreLowestToMeanRatio and <= runnerUpScoreToMeanRatio when all present', async () => {
  const agg = buildAgg('kkk3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('thirdCandidateScoreToMeanRatio' in explanation) {
      if ('candidateScoreLowestToMeanRatio' in explanation) {
        assert.ok(
          explanation.thirdCandidateScoreToMeanRatio >= explanation.candidateScoreLowestToMeanRatio - 1e-9,
          `thirdCandidateScoreToMeanRatio (${explanation.thirdCandidateScoreToMeanRatio}) should be >= candidateScoreLowestToMeanRatio (${explanation.candidateScoreLowestToMeanRatio})`,
        );
      }
      if ('runnerUpScoreToMeanRatio' in explanation) {
        assert.ok(
          explanation.thirdCandidateScoreToMeanRatio <= explanation.runnerUpScoreToMeanRatio + 1e-9,
          `thirdCandidateScoreToMeanRatio (${explanation.thirdCandidateScoreToMeanRatio}) should be <= runnerUpScoreToMeanRatio (${explanation.runnerUpScoreToMeanRatio})`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('36363636-4: for n=3 equals candidateScoreLowestToMeanRatio', async () => {
  const agg = buildAgg('kkk4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('thirdCandidateScoreToMeanRatio' in explanation && explanation.candidateCount === 3 &&
        'candidateScoreLowestToMeanRatio' in explanation) {
      assert.ok(
        Math.abs(explanation.thirdCandidateScoreToMeanRatio - explanation.candidateScoreLowestToMeanRatio) < 1e-9,
        `thirdCandidateScoreToMeanRatio (${explanation.thirdCandidateScoreToMeanRatio}) should equal candidateScoreLowestToMeanRatio (${explanation.candidateScoreLowestToMeanRatio}) for n=3`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('36363636-5: absent on cast:no_match', async () => {
  const path = dlqPath('kkk5');
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
      !('thirdCandidateScoreToMeanRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.thirdCandidateScoreToMeanRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('36363636-6: absent when fewer than 3 candidates', async () => {
  const agg = buildAgg('kkk6', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount <= 2, `should have at most 2 candidates, got ${explanation.candidateCount}`);
    assert.ok(
      !('thirdCandidateScoreToMeanRatio' in explanation),
      `should be absent with < 3 candidates, found: ${explanation.thirdCandidateScoreToMeanRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('36363636-7: identity — thirdCandidateScoreToMeanRatio * candidateScoreMean === thirdCandidateScore', async () => {
  const agg = buildAgg('kkk7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('thirdCandidateScoreToMeanRatio' in explanation &&
        'candidateScoreMean' in explanation && 'thirdCandidateScore' in explanation) {
      const product = explanation.thirdCandidateScoreToMeanRatio * explanation.candidateScoreMean;
      assert.ok(
        Math.abs(product - explanation.thirdCandidateScore) < 1e-9,
        `thirdCandidateScoreToMeanRatio * candidateScoreMean (${product}) should equal thirdCandidateScore (${explanation.thirdCandidateScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('36363636-8: tool description documents thirdCandidateScoreToMeanRatio', async () => {
  const path = dlqPath('kkk8');
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
      cast.description?.includes('thirdCandidateScoreToMeanRatio'),
      `cast description should mention thirdCandidateScoreToMeanRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
