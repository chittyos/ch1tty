/**
 * 42424242: explanation.thirdCandidateScoreZScore in ch1tty/cast when explain:true.
 *
 * thirdCandidateScoreZScore: number — standardised score of the 3rd-ranked candidate:
 * (thirdCandidateScore - candidateScoreMean) / candidateScoreStdDev.
 *
 * Present when: >= 3 candidates and candidateScoreStdDev > 0.
 * Absent when: no_match, fewer than 3 candidates, or stdDev === 0.
 * Always <= runnerUpScoreZScore: same ordering as raw scores, same mean and stddev.
 * For n=3: always <= 0 (3rd ranked score <= pool mean for 3-candidate pools).
 * For n=3: winnerScoreZScore + runnerUpScoreZScore + thirdCandidateScoreZScore === 0.
 * Identity: thirdCandidateScoreZScore * candidateScoreStdDev === thirdCandidateScore - candidateScoreMean.
 *
 * Covered:
 *   42424242-1: present when >= 3 candidates and stdDev > 0
 *   42424242-2: always finite and <= runnerUpScoreZScore when both present
 *   42424242-3: for n=3 winnerZScore + runnerUpZScore + thirdZScore === 0
 *   42424242-4: for n=3 thirdCandidateScoreZScore <= 0
 *   42424242-5: absent on cast:no_match
 *   42424242-6: absent when fewer than 3 candidates
 *   42424242-7: identity — thirdCandidateScoreZScore * stdDev === thirdCandidateScore - mean
 *   42424242-8: tool description documents thirdCandidateScoreZScore
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-42424242-${label}-${Date.now()}.jsonl`);
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

test('42424242-1: present when >= 3 candidates and stdDev > 0', async () => {
  const agg = buildAgg('qqq1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3 && explanation.candidateScoreStdDev > 0) {
      assert.ok('thirdCandidateScoreZScore' in explanation,
        `thirdCandidateScoreZScore should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.thirdCandidateScoreZScore, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('42424242-2: always finite and <= runnerUpScoreZScore when both present', async () => {
  const agg = buildAgg('qqq2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('thirdCandidateScoreZScore' in explanation) {
      assert.ok(
        Number.isFinite(explanation.thirdCandidateScoreZScore),
        `should be finite, got ${explanation.thirdCandidateScoreZScore}`,
      );
      if ('runnerUpScoreZScore' in explanation) {
        assert.ok(
          explanation.thirdCandidateScoreZScore <= explanation.runnerUpScoreZScore + 1e-9,
          `thirdCandidateScoreZScore (${explanation.thirdCandidateScoreZScore}) should be <= runnerUpScoreZScore (${explanation.runnerUpScoreZScore})`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('42424242-3: for n=3 winnerScoreZScore + runnerUpScoreZScore + thirdCandidateScoreZScore === 0', async () => {
  const agg = buildAgg('qqq3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('thirdCandidateScoreZScore' in explanation && explanation.candidateCount === 3 &&
        'winnerScoreZScore' in explanation && 'runnerUpScoreZScore' in explanation) {
      const sum = explanation.winnerScoreZScore + explanation.runnerUpScoreZScore + explanation.thirdCandidateScoreZScore;
      assert.ok(
        Math.abs(sum) < 1e-9,
        `winnerScoreZScore + runnerUpScoreZScore + thirdCandidateScoreZScore (${sum}) should equal 0 for n=3`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('42424242-4: for n=3 thirdCandidateScoreZScore <= 0', async () => {
  const agg = buildAgg('qqq4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('thirdCandidateScoreZScore' in explanation && explanation.candidateCount === 3) {
      assert.ok(
        explanation.thirdCandidateScoreZScore <= 1e-9,
        `thirdCandidateScoreZScore (${explanation.thirdCandidateScoreZScore}) should be <= 0 for n=3`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('42424242-5: absent on cast:no_match', async () => {
  const path = dlqPath('qqq5');
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
      !('thirdCandidateScoreZScore' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.thirdCandidateScoreZScore}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('42424242-6: absent when fewer than 3 candidates', async () => {
  const agg = buildAgg('qqq6', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount <= 2, `should have at most 2 candidates, got ${explanation.candidateCount}`);
    assert.ok(
      !('thirdCandidateScoreZScore' in explanation),
      `should be absent with < 3 candidates, found: ${explanation.thirdCandidateScoreZScore}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('42424242-7: identity — thirdCandidateScoreZScore * stdDev === thirdCandidateScore - mean', async () => {
  const agg = buildAgg('qqq7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('thirdCandidateScoreZScore' in explanation &&
        'candidateScoreStdDev' in explanation &&
        'thirdCandidateScore' in explanation &&
        'candidateScoreMean' in explanation) {
      const product = explanation.thirdCandidateScoreZScore * explanation.candidateScoreStdDev;
      const expected = explanation.thirdCandidateScore - explanation.candidateScoreMean;
      assert.ok(
        Math.abs(product - expected) < 1e-9,
        `thirdCandidateScoreZScore * stdDev (${product}) should equal thirdCandidateScore - mean (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('42424242-8: tool description documents thirdCandidateScoreZScore', async () => {
  const path = dlqPath('qqq8');
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
      cast.description?.includes('thirdCandidateScoreZScore'),
      `cast description should mention thirdCandidateScoreZScore, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
