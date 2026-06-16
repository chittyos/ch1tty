/**
 * 59595959: explanation.lowestToNonWinnerMassRatio in ch1tty/cast when explain:true.
 *
 * lowestToNonWinnerMassRatio: number — lowest candidate score as fraction of total non-winner pool mass:
 * lowestCandidateScore / (candidateScoreEntropyTotal - winnerScore).
 *
 * Present when: >= 2 candidates, total > 0, non-winner mass > 0, and lowestScore > 0.
 * Absent when: no_match, single candidate, zero total, zero non-winner mass, or zero lowest score.
 * Always in (0, 1].
 * For n=2: equals 1 (lowest is the entire non-winner pool).
 * Always <= runnerUpToNonWinnerMassRatio.
 * Identity: equals lowestCandidateScoreHeavinessRatio / nonWinnerScoreHeavinessRatio.
 *
 * Covered:
 *   59595959-1: present when >= 2 candidates, total > 0, non-winner mass > 0, lowestScore > 0
 *   59595959-2: always finite and in (0, 1]
 *   59595959-3: identity — equals lowestCandidateScoreHeavinessRatio / nonWinnerScoreHeavinessRatio
 *   59595959-4: for n=2 equals 1
 *   59595959-5: absent on cast:no_match
 *   59595959-6: absent when single candidate
 *   59595959-7: always <= runnerUpToNonWinnerMassRatio
 *   59595959-8: tool description documents lowestToNonWinnerMassRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-59595959-${label}-${Date.now()}.jsonl`);
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

test('59595959-1: present when >= 2 candidates, total > 0, non-winner mass > 0, lowestScore > 0', async () => {
  const agg = buildAgg('hhh1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    const total = explanation.candidateScoreMean * explanation.candidateCount;
    const nonWinnerMass = total - explanation.winnerScore;
    if (explanation.candidateCount >= 2 && total > 0 && nonWinnerMass > 0 && explanation.lowestCandidateScore > 0) {
      assert.ok('lowestToNonWinnerMassRatio' in explanation,
        `lowestToNonWinnerMassRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.lowestToNonWinnerMassRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('59595959-2: always finite and in (0, 1]', async () => {
  const agg = buildAgg('hhh2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('lowestToNonWinnerMassRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.lowestToNonWinnerMassRatio),
        `should be finite, got ${explanation.lowestToNonWinnerMassRatio}`,
      );
      assert.ok(
        explanation.lowestToNonWinnerMassRatio > 0,
        `should be > 0, got ${explanation.lowestToNonWinnerMassRatio}`,
      );
      assert.ok(
        explanation.lowestToNonWinnerMassRatio <= 1 + 1e-9,
        `should be <= 1, got ${explanation.lowestToNonWinnerMassRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('59595959-3: identity — equals lowestCandidateScoreHeavinessRatio / nonWinnerScoreHeavinessRatio', async () => {
  const agg = buildAgg('hhh3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('lowestToNonWinnerMassRatio' in explanation &&
        'lowestCandidateScoreHeavinessRatio' in explanation &&
        'nonWinnerScoreHeavinessRatio' in explanation &&
        explanation.nonWinnerScoreHeavinessRatio > 0) {
      const expected = explanation.lowestCandidateScoreHeavinessRatio / explanation.nonWinnerScoreHeavinessRatio;
      assert.ok(
        Math.abs(explanation.lowestToNonWinnerMassRatio - expected) < 1e-9,
        `lowestToNonWinnerMassRatio (${explanation.lowestToNonWinnerMassRatio}) should equal lowestHeaviness/nonWinnerHeaviness (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('59595959-4: for n=2 equals 1', async () => {
  const agg = buildAgg('hhh4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('lowestToNonWinnerMassRatio' in explanation && explanation.candidateCount === 2) {
      assert.ok(
        Math.abs(explanation.lowestToNonWinnerMassRatio - 1) < 1e-9,
        `for n=2, lowestToNonWinnerMassRatio (${explanation.lowestToNonWinnerMassRatio}) should equal 1`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('59595959-5: absent on cast:no_match', async () => {
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
      !('lowestToNonWinnerMassRatio' in parsed.explanation),
      `should be absent on no_match`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('59595959-6: absent when single candidate', async () => {
  const path = dlqPath('hhh6');
  const singleAgg = new Aggregator([STRIPE_CFG], {
    backendFactory: () => makeBackend([stripeTools[0]]),
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
  });
  try {
    const r = await singleAgg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if (explanation.candidateCount <= 1) {
      assert.ok(
        !('lowestToNonWinnerMassRatio' in explanation),
        `should be absent with single candidate`,
      );
    }
  } finally {
    await singleAgg.shutdown();
  }
});

test('59595959-7: always <= runnerUpToNonWinnerMassRatio', async () => {
  const agg = buildAgg('hhh7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('lowestToNonWinnerMassRatio' in explanation && 'runnerUpToNonWinnerMassRatio' in explanation) {
      assert.ok(
        explanation.lowestToNonWinnerMassRatio <= explanation.runnerUpToNonWinnerMassRatio + 1e-9,
        `lowestToNonWinnerMassRatio (${explanation.lowestToNonWinnerMassRatio}) should be <= runnerUpToNonWinnerMassRatio (${explanation.runnerUpToNonWinnerMassRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('59595959-8: tool description documents lowestToNonWinnerMassRatio', async () => {
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
      cast.description?.includes('lowestToNonWinnerMassRatio'),
      `cast description should mention lowestToNonWinnerMassRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
