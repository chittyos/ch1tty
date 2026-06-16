/**
 * 34343434: explanation.thirdCandidateScoreToWinnerRatio in ch1tty/cast when explain:true.
 *
 * thirdCandidateScoreToWinnerRatio: number — 3rd-ranked candidate score as fraction of winner:
 * thirdCandidateScore / winnerScore.
 *
 * Present when: >= 3 candidates and winnerScore > 0.
 * Absent when: no_match, fewer than 3 candidates, or winnerScore === 0.
 * Always in (0, 1]: thirdCandidateScore <= winnerScore.
 * Always <= runnerUpScore / winnerScore: 3rd <= runner-up.
 * For n=3: equals lowestCandidateScoreRatio (3rd === lowest when n=3).
 * Identity: thirdCandidateScoreToWinnerRatio * winnerScore === thirdCandidateScore.
 *
 * Covered:
 *   34343434-1: present when >= 3 candidates and winnerScore > 0
 *   34343434-2: always in (0, 1] when present
 *   34343434-3: always <= runnerUpScore / winnerScore when both present
 *   34343434-4: for n=3 equals lowestCandidateScoreRatio
 *   34343434-5: absent on cast:no_match
 *   34343434-6: absent when fewer than 3 candidates
 *   34343434-7: identity — thirdCandidateScoreToWinnerRatio * winnerScore === thirdCandidateScore
 *   34343434-8: tool description documents thirdCandidateScoreToWinnerRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-34343434-${label}-${Date.now()}.jsonl`);
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

test('34343434-1: present when >= 3 candidates and winnerScore > 0', async () => {
  const agg = buildAgg('iii1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3 && explanation.winnerScore > 0) {
      assert.ok('thirdCandidateScoreToWinnerRatio' in explanation,
        `thirdCandidateScoreToWinnerRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.thirdCandidateScoreToWinnerRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('34343434-2: always in (0, 1] when present', async () => {
  const agg = buildAgg('iii2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('thirdCandidateScoreToWinnerRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.thirdCandidateScoreToWinnerRatio),
        `should be finite, got ${explanation.thirdCandidateScoreToWinnerRatio}`,
      );
      assert.ok(
        explanation.thirdCandidateScoreToWinnerRatio > 0,
        `should be > 0, got ${explanation.thirdCandidateScoreToWinnerRatio}`,
      );
      assert.ok(
        explanation.thirdCandidateScoreToWinnerRatio <= 1,
        `should be <= 1, got ${explanation.thirdCandidateScoreToWinnerRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('34343434-3: always <= runnerUpScore / winnerScore when both present', async () => {
  const agg = buildAgg('iii3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('thirdCandidateScoreToWinnerRatio' in explanation &&
        'runnerUpScore' in explanation && 'winnerScore' in explanation && explanation.winnerScore > 0) {
      const runnerUpToWinner = explanation.runnerUpScore / explanation.winnerScore;
      assert.ok(
        explanation.thirdCandidateScoreToWinnerRatio <= runnerUpToWinner + 1e-9,
        `thirdCandidateScoreToWinnerRatio (${explanation.thirdCandidateScoreToWinnerRatio}) should be <= runnerUpScore/winnerScore (${runnerUpToWinner})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('34343434-4: for n=3 equals lowestCandidateScoreRatio', async () => {
  const agg = buildAgg('iii4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('thirdCandidateScoreToWinnerRatio' in explanation && explanation.candidateCount === 3 &&
        'lowestCandidateScoreRatio' in explanation) {
      assert.ok(
        Math.abs(explanation.thirdCandidateScoreToWinnerRatio - explanation.lowestCandidateScoreRatio) < 1e-9,
        `thirdCandidateScoreToWinnerRatio (${explanation.thirdCandidateScoreToWinnerRatio}) should equal lowestCandidateScoreRatio (${explanation.lowestCandidateScoreRatio}) for n=3`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('34343434-5: absent on cast:no_match', async () => {
  const path = dlqPath('iii5');
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
      !('thirdCandidateScoreToWinnerRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.thirdCandidateScoreToWinnerRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('34343434-6: absent when fewer than 3 candidates', async () => {
  const agg = buildAgg('iii6', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount <= 2, `should have at most 2 candidates, got ${explanation.candidateCount}`);
    assert.ok(
      !('thirdCandidateScoreToWinnerRatio' in explanation),
      `should be absent with < 3 candidates, found: ${explanation.thirdCandidateScoreToWinnerRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('34343434-7: identity — thirdCandidateScoreToWinnerRatio * winnerScore === thirdCandidateScore', async () => {
  const agg = buildAgg('iii7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('thirdCandidateScoreToWinnerRatio' in explanation &&
        'winnerScore' in explanation && 'thirdCandidateScore' in explanation) {
      const product = explanation.thirdCandidateScoreToWinnerRatio * explanation.winnerScore;
      assert.ok(
        Math.abs(product - explanation.thirdCandidateScore) < 1e-9,
        `thirdCandidateScoreToWinnerRatio * winnerScore (${product}) should equal thirdCandidateScore (${explanation.thirdCandidateScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('34343434-8: tool description documents thirdCandidateScoreToWinnerRatio', async () => {
  const path = dlqPath('iii8');
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
      cast.description?.includes('thirdCandidateScoreToWinnerRatio'),
      `cast description should mention thirdCandidateScoreToWinnerRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
