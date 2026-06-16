/**
 * 37373737: explanation.runnerUpThirdGap in ch1tty/cast when explain:true.
 *
 * runnerUpThirdGap: number — absolute score gap between runner-up and 3rd-ranked candidate:
 * runnerUpScore - thirdCandidateScore.
 *
 * Present when: >= 3 candidates.
 * Absent when: no_match, fewer than 3 candidates.
 * Always >= 0: runner-up score >= 3rd by ranking.
 * Cross-field bound: winnerRunnerUpGap + runnerUpThirdGap <= candidateScoreSpread.
 * For n=3: winnerRunnerUpGap + runnerUpThirdGap === candidateScoreSpread exactly.
 * Identity: runnerUpThirdGap + thirdCandidateScore === runnerUpScore.
 *
 * Covered:
 *   37373737-1: present when >= 3 candidates
 *   37373737-2: always finite and >= 0 when present
 *   37373737-3: winnerRunnerUpGap + runnerUpThirdGap <= candidateScoreSpread when all present
 *   37373737-4: for n=3 winnerRunnerUpGap + runnerUpThirdGap === candidateScoreSpread
 *   37373737-5: absent on cast:no_match
 *   37373737-6: absent when fewer than 3 candidates
 *   37373737-7: identity — runnerUpThirdGap + thirdCandidateScore === runnerUpScore
 *   37373737-8: tool description documents runnerUpThirdGap
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-37373737-${label}-${Date.now()}.jsonl`);
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

test('37373737-1: present when >= 3 candidates', async () => {
  const agg = buildAgg('lll1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3) {
      assert.ok('runnerUpThirdGap' in explanation,
        `runnerUpThirdGap should be present when candidateCount >= 3; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.runnerUpThirdGap, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('37373737-2: always finite and >= 0 when present', async () => {
  const agg = buildAgg('lll2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpThirdGap' in explanation) {
      assert.ok(
        Number.isFinite(explanation.runnerUpThirdGap),
        `should be finite, got ${explanation.runnerUpThirdGap}`,
      );
      assert.ok(
        explanation.runnerUpThirdGap >= 0,
        `should be >= 0, got ${explanation.runnerUpThirdGap}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('37373737-3: winnerRunnerUpGap + runnerUpThirdGap <= candidateScoreSpread when all present', async () => {
  const agg = buildAgg('lll3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpThirdGap' in explanation &&
        'winnerRunnerUpGap' in explanation && 'candidateScoreSpread' in explanation) {
      const sum = explanation.winnerRunnerUpGap + explanation.runnerUpThirdGap;
      assert.ok(
        sum <= explanation.candidateScoreSpread + 1e-9,
        `winnerRunnerUpGap + runnerUpThirdGap (${sum}) should be <= candidateScoreSpread (${explanation.candidateScoreSpread})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('37373737-4: for n=3 winnerRunnerUpGap + runnerUpThirdGap === candidateScoreSpread', async () => {
  const agg = buildAgg('lll4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpThirdGap' in explanation && explanation.candidateCount === 3 &&
        'winnerRunnerUpGap' in explanation && 'candidateScoreSpread' in explanation) {
      const sum = explanation.winnerRunnerUpGap + explanation.runnerUpThirdGap;
      assert.ok(
        Math.abs(sum - explanation.candidateScoreSpread) < 1e-9,
        `winnerRunnerUpGap + runnerUpThirdGap (${sum}) should equal candidateScoreSpread (${explanation.candidateScoreSpread}) for n=3`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('37373737-5: absent on cast:no_match', async () => {
  const path = dlqPath('lll5');
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
      !('runnerUpThirdGap' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.runnerUpThirdGap}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('37373737-6: absent when fewer than 3 candidates', async () => {
  const agg = buildAgg('lll6', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount <= 2, `should have at most 2 candidates, got ${explanation.candidateCount}`);
    assert.ok(
      !('runnerUpThirdGap' in explanation),
      `should be absent with < 3 candidates, found: ${explanation.runnerUpThirdGap}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('37373737-7: identity — runnerUpThirdGap + thirdCandidateScore === runnerUpScore', async () => {
  const agg = buildAgg('lll7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpThirdGap' in explanation &&
        'thirdCandidateScore' in explanation && 'runnerUpScore' in explanation) {
      const sum = explanation.runnerUpThirdGap + explanation.thirdCandidateScore;
      assert.ok(
        Math.abs(sum - explanation.runnerUpScore) < 1e-9,
        `runnerUpThirdGap + thirdCandidateScore (${sum}) should equal runnerUpScore (${explanation.runnerUpScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('37373737-8: tool description documents runnerUpThirdGap', async () => {
  const path = dlqPath('lll8');
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
      cast.description?.includes('runnerUpThirdGap'),
      `cast description should mention runnerUpThirdGap, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
