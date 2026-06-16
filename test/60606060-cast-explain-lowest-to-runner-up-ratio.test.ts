/**
 * 60606060: explanation.lowestToRunnerUpRatio in ch1tty/cast when explain:true.
 *
 * lowestToRunnerUpRatio: number — lowest candidate score divided by runner-up score:
 * lowestCandidateScore / runnerUpScore.
 *
 * Present when: >= 2 candidates, runnerUpScore > 0, and lowestCandidateScore > 0.
 * Absent when: no_match, single candidate, zero runner-up, or zero lowest score.
 * Always in (0, 1].
 * For n=2: equals 1 (lowest = runner-up).
 * Identity: ratio * runnerUpScore === lowestCandidateScore.
 *
 * Covered:
 *   60606060-1: present when >= 2 candidates, runnerUpScore > 0, lowestScore > 0
 *   60606060-2: always finite and in (0, 1]
 *   60606060-3: identity — ratio * runnerUpScore === lowestCandidateScore
 *   60606060-4: for n=2 equals 1
 *   60606060-5: absent on cast:no_match
 *   60606060-6: absent when single candidate
 *   60606060-7: always <= 1
 *   60606060-8: tool description documents lowestToRunnerUpRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-60606060-${label}-${Date.now()}.jsonl`);
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

test('60606060-1: present when >= 2 candidates, runnerUpScore > 0, lowestScore > 0', async () => {
  const agg = buildAgg('iii1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 2 && explanation.runnerUpScore > 0 && explanation.lowestCandidateScore > 0) {
      assert.ok('lowestToRunnerUpRatio' in explanation,
        `lowestToRunnerUpRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.lowestToRunnerUpRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('60606060-2: always finite and in (0, 1]', async () => {
  const agg = buildAgg('iii2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('lowestToRunnerUpRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.lowestToRunnerUpRatio),
        `should be finite, got ${explanation.lowestToRunnerUpRatio}`,
      );
      assert.ok(
        explanation.lowestToRunnerUpRatio > 0,
        `should be > 0, got ${explanation.lowestToRunnerUpRatio}`,
      );
      assert.ok(
        explanation.lowestToRunnerUpRatio <= 1 + 1e-9,
        `should be <= 1, got ${explanation.lowestToRunnerUpRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('60606060-3: identity — ratio * runnerUpScore === lowestCandidateScore', async () => {
  const agg = buildAgg('iii3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('lowestToRunnerUpRatio' in explanation &&
        'runnerUpScore' in explanation &&
        'lowestCandidateScore' in explanation) {
      const product = explanation.lowestToRunnerUpRatio * explanation.runnerUpScore;
      assert.ok(
        Math.abs(product - explanation.lowestCandidateScore) < 1e-9,
        `ratio * runnerUpScore (${product}) should equal lowestCandidateScore (${explanation.lowestCandidateScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('60606060-4: for n=2 equals 1', async () => {
  const agg = buildAgg('iii4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('lowestToRunnerUpRatio' in explanation && explanation.candidateCount === 2) {
      assert.ok(
        Math.abs(explanation.lowestToRunnerUpRatio - 1) < 1e-9,
        `for n=2, lowestToRunnerUpRatio (${explanation.lowestToRunnerUpRatio}) should equal 1`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('60606060-5: absent on cast:no_match', async () => {
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
      !('lowestToRunnerUpRatio' in parsed.explanation),
      `should be absent on no_match`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('60606060-6: absent when single candidate', async () => {
  const path = dlqPath('iii6');
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
        !('lowestToRunnerUpRatio' in explanation),
        `should be absent with single candidate`,
      );
    }
  } finally {
    await singleAgg.shutdown();
  }
});

test('60606060-7: always <= 1', async () => {
  const agg = buildAgg('iii7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('lowestToRunnerUpRatio' in explanation) {
      assert.ok(
        explanation.lowestToRunnerUpRatio <= 1 + 1e-9,
        `lowestToRunnerUpRatio (${explanation.lowestToRunnerUpRatio}) should be <= 1`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('60606060-8: tool description documents lowestToRunnerUpRatio', async () => {
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
      cast.description?.includes('lowestToRunnerUpRatio'),
      `cast description should mention lowestToRunnerUpRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
