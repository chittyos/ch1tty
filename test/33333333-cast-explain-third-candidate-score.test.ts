/**
 * 33333333: explanation.thirdCandidateScore in ch1tty/cast when explain:true.
 *
 * thirdCandidateScore: number — the relevance score of the 3rd-ranked candidate.
 *
 * Present when: >= 3 candidates.
 * Absent when: no_match, fewer than 3 candidates.
 * Always in [0, runnerUpScore]: 3rd-ranked <= runner-up.
 * Always >= lowestCandidateScore: 3rd-ranked >= lowest.
 * For n=3: equals lowestCandidateScore (3rd is also the last).
 * Identity: (candidateScoreTop3HeavinessRatio - top2HeavinessRatio) * total === thirdCandidateScore.
 *
 * Covered:
 *   33333333-1: present when >= 3 candidates
 *   33333333-2: always in [0, runnerUpScore] when present
 *   33333333-3: always >= lowestCandidateScore when present
 *   33333333-4: for n=3 equals lowestCandidateScore
 *   33333333-5: absent on cast:no_match
 *   33333333-6: absent when fewer than 3 candidates
 *   33333333-7: identity — (top3HeavinessRatio - top2HeavinessRatio) * total === thirdCandidateScore
 *   33333333-8: tool description documents thirdCandidateScore
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-33333333-${label}-${Date.now()}.jsonl`);
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

test('33333333-1: present when >= 3 candidates', async () => {
  const agg = buildAgg('hhh1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3) {
      assert.ok('thirdCandidateScore' in explanation,
        `thirdCandidateScore should be present when candidateCount >= 3; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.thirdCandidateScore, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('33333333-2: always in [0, runnerUpScore] when present', async () => {
  const agg = buildAgg('hhh2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('thirdCandidateScore' in explanation) {
      assert.ok(
        Number.isFinite(explanation.thirdCandidateScore),
        `should be finite, got ${explanation.thirdCandidateScore}`,
      );
      assert.ok(
        explanation.thirdCandidateScore >= 0,
        `should be >= 0, got ${explanation.thirdCandidateScore}`,
      );
      if ('runnerUpScore' in explanation) {
        assert.ok(
          explanation.thirdCandidateScore <= explanation.runnerUpScore + 1e-9,
          `should be <= runnerUpScore (${explanation.runnerUpScore}), got ${explanation.thirdCandidateScore}`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('33333333-3: always >= lowestCandidateScore when present', async () => {
  const agg = buildAgg('hhh3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('thirdCandidateScore' in explanation && 'lowestCandidateScore' in explanation) {
      assert.ok(
        explanation.thirdCandidateScore >= explanation.lowestCandidateScore - 1e-9,
        `thirdCandidateScore (${explanation.thirdCandidateScore}) should be >= lowestCandidateScore (${explanation.lowestCandidateScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('33333333-4: for n=3 equals lowestCandidateScore', async () => {
  const agg = buildAgg('hhh4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('thirdCandidateScore' in explanation && explanation.candidateCount === 3 &&
        'lowestCandidateScore' in explanation) {
      assert.ok(
        Math.abs(explanation.thirdCandidateScore - explanation.lowestCandidateScore) < 1e-9,
        `thirdCandidateScore (${explanation.thirdCandidateScore}) should equal lowestCandidateScore (${explanation.lowestCandidateScore}) for n=3`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('33333333-5: absent on cast:no_match', async () => {
  const path = dlqPath('hhh5');
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
      !('thirdCandidateScore' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.thirdCandidateScore}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('33333333-6: absent when fewer than 3 candidates', async () => {
  const agg = buildAgg('hhh6', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount <= 2, `should have at most 2 candidates, got ${explanation.candidateCount}`);
    assert.ok(
      !('thirdCandidateScore' in explanation),
      `should be absent with < 3 candidates, found: ${explanation.thirdCandidateScore}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('33333333-7: identity — (top3HeavinessRatio - top2HeavinessRatio) * total === thirdCandidateScore', async () => {
  const agg = buildAgg('hhh7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('thirdCandidateScore' in explanation &&
        'candidateScoreTop3HeavinessRatio' in explanation &&
        'top2HeavinessRatio' in explanation &&
        'candidateScoreMean' in explanation) {
      const total = explanation.candidateScoreMean * explanation.candidateCount;
      const derived = (explanation.candidateScoreTop3HeavinessRatio - explanation.top2HeavinessRatio) * total;
      assert.ok(
        Math.abs(derived - explanation.thirdCandidateScore) < 1e-9,
        `(top3 - top2) * total (${derived}) should equal thirdCandidateScore (${explanation.thirdCandidateScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('33333333-8: tool description documents thirdCandidateScore', async () => {
  const path = dlqPath('hhh8');
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
      cast.description?.includes('thirdCandidateScore'),
      `cast description should mention thirdCandidateScore, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
