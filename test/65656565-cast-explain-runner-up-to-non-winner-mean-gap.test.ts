/**
 * 65656565: explanation.runnerUpToNonWinnerMeanGap in ch1tty/cast when explain:true.
 *
 * runnerUpToNonWinnerMeanGap: number — gap between runner-up score and non-winner mean:
 * runnerUpScore - candidateScoreNonWinnerMean.
 *
 * Present when: >= 3 candidates.
 * Absent when: no_match or < 3 candidates.
 * Always >= 0 (runner-up >= non-winner mean).
 * Always <= candidateScoreNonWinnerSpread.
 * For n=3: equals candidateScoreNonWinnerSpread / 2.
 * Zero when all non-winners are tied.
 * Identity: runnerUpToNonWinnerMeanGap === runnerUpScore - candidateScoreNonWinnerMean.
 *
 * Covered:
 *   65656565-1: present when >= 3 candidates
 *   65656565-2: always finite and >= 0
 *   65656565-3: identity — runnerUpToNonWinnerMeanGap === runnerUpScore - candidateScoreNonWinnerMean
 *   65656565-4: for n=3 equals candidateScoreNonWinnerSpread / 2
 *   65656565-5: absent on cast:no_match
 *   65656565-6: absent when fewer than 3 candidates
 *   65656565-7: always <= candidateScoreNonWinnerSpread
 *   65656565-8: tool description documents runnerUpToNonWinnerMeanGap
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-65656565-${label}-${Date.now()}.jsonl`);
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

test('65656565-1: present when >= 3 candidates', async () => {
  const agg = buildAgg('nnn1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3) {
      assert.ok('runnerUpToNonWinnerMeanGap' in explanation,
        `runnerUpToNonWinnerMeanGap should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.runnerUpToNonWinnerMeanGap, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('65656565-2: always finite and >= 0', async () => {
  const agg = buildAgg('nnn2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpToNonWinnerMeanGap' in explanation) {
      assert.ok(
        Number.isFinite(explanation.runnerUpToNonWinnerMeanGap),
        `should be finite, got ${explanation.runnerUpToNonWinnerMeanGap}`,
      );
      assert.ok(
        explanation.runnerUpToNonWinnerMeanGap >= -1e-9,
        `should be >= 0, got ${explanation.runnerUpToNonWinnerMeanGap}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('65656565-3: identity — runnerUpToNonWinnerMeanGap === runnerUpScore - candidateScoreNonWinnerMean', async () => {
  const agg = buildAgg('nnn3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpToNonWinnerMeanGap' in explanation &&
        'runnerUpScore' in explanation &&
        'candidateScoreNonWinnerMean' in explanation) {
      const expected = explanation.runnerUpScore - explanation.candidateScoreNonWinnerMean;
      assert.ok(
        Math.abs(explanation.runnerUpToNonWinnerMeanGap - expected) < 1e-9,
        `runnerUpToNonWinnerMeanGap (${explanation.runnerUpToNonWinnerMeanGap}) should equal runnerUpScore - nonWinnerMean (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('65656565-4: for n=3 equals candidateScoreNonWinnerSpread / 2', async () => {
  const agg = buildAgg('nnn4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpToNonWinnerMeanGap' in explanation &&
        'candidateScoreNonWinnerSpread' in explanation &&
        explanation.candidateCount === 3) {
      const expected = explanation.candidateScoreNonWinnerSpread / 2;
      assert.ok(
        Math.abs(explanation.runnerUpToNonWinnerMeanGap - expected) < 1e-9,
        `for n=3, runnerUpToNonWinnerMeanGap (${explanation.runnerUpToNonWinnerMeanGap}) should equal nonWinnerSpread/2 (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('65656565-5: absent on cast:no_match', async () => {
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
      !('runnerUpToNonWinnerMeanGap' in parsed.explanation),
      `should be absent on no_match`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('65656565-6: absent when fewer than 3 candidates', async () => {
  const path = dlqPath('nnn6');
  const twoAgg = new Aggregator([STRIPE_CFG, NEON_CFG], {
    backendFactory: (cfg) => makeBackend(cfg.id === 'stripe' ? stripeTools : neonTools),
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
  });
  try {
    const r = await twoAgg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if (explanation.candidateCount < 3) {
      assert.ok(
        !('runnerUpToNonWinnerMeanGap' in explanation),
        `should be absent with < 3 candidates`,
      );
    }
  } finally {
    await twoAgg.shutdown();
  }
});

test('65656565-7: always <= candidateScoreNonWinnerSpread', async () => {
  const agg = buildAgg('nnn7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpToNonWinnerMeanGap' in explanation && 'candidateScoreNonWinnerSpread' in explanation) {
      assert.ok(
        explanation.runnerUpToNonWinnerMeanGap <= explanation.candidateScoreNonWinnerSpread + 1e-9,
        `runnerUpToNonWinnerMeanGap (${explanation.runnerUpToNonWinnerMeanGap}) should be <= candidateScoreNonWinnerSpread (${explanation.candidateScoreNonWinnerSpread})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('65656565-8: tool description documents runnerUpToNonWinnerMeanGap', async () => {
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
      cast.description?.includes('runnerUpToNonWinnerMeanGap'),
      `cast description should mention runnerUpToNonWinnerMeanGap, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
