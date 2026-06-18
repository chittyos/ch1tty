/**
 * 41414141: explanation.candidateScoreNonWinnerStdDev in ch1tty/cast when explain:true.
 *
 * candidateScoreNonWinnerStdDev: number — population standard deviation of all non-winner scores:
 * sqrt(sum((score_i - nonWinnerMean)^2) / (n-1)).
 *
 * Present when: >= 3 candidates (>= 2 non-winners).
 * Absent when: no_match, fewer than 3 candidates.
 * Always >= 0.
 * Always <= candidateScoreSpread: non-winner scores are bounded within the full range.
 * For n=3: equals runnerUpThirdGap / 2.
 * Identity (n=3): candidateScoreNonWinnerStdDev * 2 === runnerUpScore - thirdCandidateScore.
 *
 * Covered:
 *   41414141-1: present when >= 3 candidates
 *   41414141-2: always finite and >= 0 when present
 *   41414141-3: always <= candidateScoreSpread when present
 *   41414141-4: for n=3 equals runnerUpThirdGap / 2
 *   41414141-5: absent on cast:no_match
 *   41414141-6: absent when fewer than 3 candidates
 *   41414141-7: identity — for n=3: candidateScoreNonWinnerStdDev * 2 === runnerUpScore - thirdCandidateScore
 *   41414141-8: tool description documents candidateScoreNonWinnerStdDev
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-41414141-${label}-${Date.now()}.jsonl`);
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

test('41414141-1: present when >= 3 candidates', async () => {
  const agg = buildAgg('ppp1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3) {
      assert.ok('candidateScoreNonWinnerStdDev' in explanation,
        `candidateScoreNonWinnerStdDev should be present when candidateCount >= 3; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreNonWinnerStdDev, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('41414141-2: always finite and >= 0 when present', async () => {
  const agg = buildAgg('ppp2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerStdDev' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreNonWinnerStdDev),
        `should be finite, got ${explanation.candidateScoreNonWinnerStdDev}`,
      );
      assert.ok(
        explanation.candidateScoreNonWinnerStdDev >= 0,
        `should be >= 0, got ${explanation.candidateScoreNonWinnerStdDev}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('41414141-3: always <= candidateScoreSpread when present', async () => {
  const agg = buildAgg('ppp3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerStdDev' in explanation && 'candidateScoreSpread' in explanation) {
      assert.ok(
        explanation.candidateScoreNonWinnerStdDev <= explanation.candidateScoreSpread + 1e-9,
        `candidateScoreNonWinnerStdDev (${explanation.candidateScoreNonWinnerStdDev}) should be <= candidateScoreSpread (${explanation.candidateScoreSpread})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('41414141-4: for n=3 equals runnerUpThirdGap / 2', async () => {
  const agg = buildAgg('ppp4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerStdDev' in explanation && explanation.candidateCount === 3 &&
        'runnerUpThirdGap' in explanation) {
      assert.ok(
        Math.abs(explanation.candidateScoreNonWinnerStdDev - explanation.runnerUpThirdGap / 2) < 1e-9,
        `candidateScoreNonWinnerStdDev (${explanation.candidateScoreNonWinnerStdDev}) should equal runnerUpThirdGap / 2 (${explanation.runnerUpThirdGap / 2}) for n=3`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('41414141-5: absent on cast:no_match', async () => {
  const path = dlqPath('ppp5');
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
      !('candidateScoreNonWinnerStdDev' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.candidateScoreNonWinnerStdDev}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('41414141-6: absent when fewer than 3 candidates', async () => {
  const agg = buildAgg('ppp6', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount <= 2, `should have at most 2 candidates, got ${explanation.candidateCount}`);
    assert.ok(
      !('candidateScoreNonWinnerStdDev' in explanation),
      `should be absent with < 3 candidates, found: ${explanation.candidateScoreNonWinnerStdDev}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('41414141-7: identity — for n=3: candidateScoreNonWinnerStdDev * 2 === runnerUpScore - thirdCandidateScore', async () => {
  const agg = buildAgg('ppp7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerStdDev' in explanation && explanation.candidateCount === 3 &&
        'runnerUpScore' in explanation && 'thirdCandidateScore' in explanation) {
      const doubled = explanation.candidateScoreNonWinnerStdDev * 2;
      const expected = explanation.runnerUpScore - explanation.thirdCandidateScore;
      assert.ok(
        Math.abs(doubled - expected) < 1e-9,
        `candidateScoreNonWinnerStdDev * 2 (${doubled}) should equal runnerUpScore - thirdCandidateScore (${expected}) for n=3`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('41414141-8: tool description documents candidateScoreNonWinnerStdDev', async () => {
  const path = dlqPath('ppp8');
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
      cast.description?.includes('candidateScoreNonWinnerStdDev'),
      `cast description should mention candidateScoreNonWinnerStdDev, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
