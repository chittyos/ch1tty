/**
 * 39393939: explanation.winnerThirdGap in ch1tty/cast when explain:true.
 *
 * winnerThirdGap: number — absolute score gap between winner and 3rd-ranked candidate:
 * winnerScore - thirdCandidateScore.
 *
 * Present when: >= 3 candidates.
 * Absent when: no_match, fewer than 3 candidates.
 * Always >= 0: winner >= 3rd by ranking.
 * Always >= winnerRunnerUpGap: thirdCandidateScore <= runnerUpScore.
 * Always <= candidateScoreSpread: thirdCandidateScore >= lowestCandidateScore.
 * For n=3: equals candidateScoreSpread (third === lowest when n=3).
 * Additive: winnerThirdGap === winnerRunnerUpGap + runnerUpThirdGap.
 * Identity: winnerThirdGap === winnerScore - thirdCandidateScore.
 *
 * Covered:
 *   39393939-1: present when >= 3 candidates
 *   39393939-2: always finite and >= 0 when present
 *   39393939-3: always >= winnerRunnerUpGap and <= candidateScoreSpread when all present
 *   39393939-4: for n=3 equals candidateScoreSpread
 *   39393939-5: absent on cast:no_match
 *   39393939-6: absent when fewer than 3 candidates
 *   39393939-7: additive identity — winnerThirdGap === winnerRunnerUpGap + runnerUpThirdGap
 *   39393939-8: tool description documents winnerThirdGap
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-39393939-${label}-${Date.now()}.jsonl`);
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

test('39393939-1: present when >= 3 candidates', async () => {
  const agg = buildAgg('nnn1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3) {
      assert.ok('winnerThirdGap' in explanation,
        `winnerThirdGap should be present when candidateCount >= 3; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.winnerThirdGap, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('39393939-2: always finite and >= 0 when present', async () => {
  const agg = buildAgg('nnn2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerThirdGap' in explanation) {
      assert.ok(
        Number.isFinite(explanation.winnerThirdGap),
        `should be finite, got ${explanation.winnerThirdGap}`,
      );
      assert.ok(
        explanation.winnerThirdGap >= 0,
        `should be >= 0, got ${explanation.winnerThirdGap}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('39393939-3: always >= winnerRunnerUpGap and <= candidateScoreSpread when all present', async () => {
  const agg = buildAgg('nnn3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerThirdGap' in explanation) {
      if ('winnerRunnerUpGap' in explanation) {
        assert.ok(
          explanation.winnerThirdGap >= explanation.winnerRunnerUpGap - 1e-9,
          `winnerThirdGap (${explanation.winnerThirdGap}) should be >= winnerRunnerUpGap (${explanation.winnerRunnerUpGap})`,
        );
      }
      if ('candidateScoreSpread' in explanation) {
        assert.ok(
          explanation.winnerThirdGap <= explanation.candidateScoreSpread + 1e-9,
          `winnerThirdGap (${explanation.winnerThirdGap}) should be <= candidateScoreSpread (${explanation.candidateScoreSpread})`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('39393939-4: for n=3 equals candidateScoreSpread', async () => {
  const agg = buildAgg('nnn4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerThirdGap' in explanation && explanation.candidateCount === 3 &&
        'candidateScoreSpread' in explanation) {
      assert.ok(
        Math.abs(explanation.winnerThirdGap - explanation.candidateScoreSpread) < 1e-9,
        `winnerThirdGap (${explanation.winnerThirdGap}) should equal candidateScoreSpread (${explanation.candidateScoreSpread}) for n=3`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('39393939-5: absent on cast:no_match', async () => {
  const path = dlqPath('nnn5');
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
      !('winnerThirdGap' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.winnerThirdGap}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('39393939-6: absent when fewer than 3 candidates', async () => {
  const agg = buildAgg('nnn6', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount <= 2, `should have at most 2 candidates, got ${explanation.candidateCount}`);
    assert.ok(
      !('winnerThirdGap' in explanation),
      `should be absent with < 3 candidates, found: ${explanation.winnerThirdGap}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('39393939-7: additive identity — winnerThirdGap === winnerRunnerUpGap + runnerUpThirdGap', async () => {
  const agg = buildAgg('nnn7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerThirdGap' in explanation &&
        'winnerRunnerUpGap' in explanation && 'runnerUpThirdGap' in explanation) {
      const sum = explanation.winnerRunnerUpGap + explanation.runnerUpThirdGap;
      assert.ok(
        Math.abs(explanation.winnerThirdGap - sum) < 1e-9,
        `winnerThirdGap (${explanation.winnerThirdGap}) should equal winnerRunnerUpGap + runnerUpThirdGap (${sum})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('39393939-8: tool description documents winnerThirdGap', async () => {
  const path = dlqPath('nnn8');
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
      cast.description?.includes('winnerThirdGap'),
      `cast description should mention winnerThirdGap, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
