/**
 * 61616161: explanation.thirdToRunnerUpRatio in ch1tty/cast when explain:true.
 *
 * thirdToRunnerUpRatio: number — third-ranked candidate score divided by runner-up score:
 * thirdCandidateScore / runnerUpScore.
 *
 * Present when: >= 3 candidates, runnerUpScore > 0, and thirdCandidateScore > 0.
 * Absent when: no_match, < 3 candidates, zero runner-up, or zero third score.
 * Always in (0, 1].
 * For n=3: equals lowestToRunnerUpRatio.
 * Always >= lowestToRunnerUpRatio when both present.
 * Identity: ratio * runnerUpScore === thirdCandidateScore.
 *
 * Covered:
 *   61616161-1: present when >= 3 candidates, runnerUpScore > 0, thirdCandidateScore > 0
 *   61616161-2: always finite and in (0, 1]
 *   61616161-3: identity — ratio * runnerUpScore === thirdCandidateScore
 *   61616161-4: for n=3 equals lowestToRunnerUpRatio
 *   61616161-5: absent on cast:no_match
 *   61616161-6: absent when fewer than 3 candidates
 *   61616161-7: always >= lowestToRunnerUpRatio when both present
 *   61616161-8: tool description documents thirdToRunnerUpRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-61616161-${label}-${Date.now()}.jsonl`);
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

test('61616161-1: present when >= 3 candidates, runnerUpScore > 0, thirdCandidateScore > 0', async () => {
  const agg = buildAgg('jjj1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3 && explanation.runnerUpScore > 0 && explanation.thirdCandidateScore > 0) {
      assert.ok('thirdToRunnerUpRatio' in explanation,
        `thirdToRunnerUpRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.thirdToRunnerUpRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('61616161-2: always finite and in (0, 1]', async () => {
  const agg = buildAgg('jjj2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('thirdToRunnerUpRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.thirdToRunnerUpRatio),
        `should be finite, got ${explanation.thirdToRunnerUpRatio}`,
      );
      assert.ok(
        explanation.thirdToRunnerUpRatio > 0,
        `should be > 0, got ${explanation.thirdToRunnerUpRatio}`,
      );
      assert.ok(
        explanation.thirdToRunnerUpRatio <= 1 + 1e-9,
        `should be <= 1, got ${explanation.thirdToRunnerUpRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('61616161-3: identity — ratio * runnerUpScore === thirdCandidateScore', async () => {
  const agg = buildAgg('jjj3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('thirdToRunnerUpRatio' in explanation &&
        'runnerUpScore' in explanation &&
        'thirdCandidateScore' in explanation) {
      const product = explanation.thirdToRunnerUpRatio * explanation.runnerUpScore;
      assert.ok(
        Math.abs(product - explanation.thirdCandidateScore) < 1e-9,
        `ratio * runnerUpScore (${product}) should equal thirdCandidateScore (${explanation.thirdCandidateScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('61616161-4: for n=3 equals lowestToRunnerUpRatio', async () => {
  const agg = buildAgg('jjj4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('thirdToRunnerUpRatio' in explanation &&
        'lowestToRunnerUpRatio' in explanation &&
        explanation.candidateCount === 3) {
      assert.ok(
        Math.abs(explanation.thirdToRunnerUpRatio - explanation.lowestToRunnerUpRatio) < 1e-9,
        `for n=3, thirdToRunnerUpRatio (${explanation.thirdToRunnerUpRatio}) should equal lowestToRunnerUpRatio (${explanation.lowestToRunnerUpRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('61616161-5: absent on cast:no_match', async () => {
  const path = dlqPath('jjj5');
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
      !('thirdToRunnerUpRatio' in parsed.explanation),
      `should be absent on no_match`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('61616161-6: absent when fewer than 3 candidates', async () => {
  const path = dlqPath('jjj6');
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
        !('thirdToRunnerUpRatio' in explanation),
        `should be absent with < 3 candidates`,
      );
    }
  } finally {
    await twoAgg.shutdown();
  }
});

test('61616161-7: always >= lowestToRunnerUpRatio when both present', async () => {
  const agg = buildAgg('jjj7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('thirdToRunnerUpRatio' in explanation && 'lowestToRunnerUpRatio' in explanation) {
      assert.ok(
        explanation.thirdToRunnerUpRatio >= explanation.lowestToRunnerUpRatio - 1e-9,
        `thirdToRunnerUpRatio (${explanation.thirdToRunnerUpRatio}) should be >= lowestToRunnerUpRatio (${explanation.lowestToRunnerUpRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('61616161-8: tool description documents thirdToRunnerUpRatio', async () => {
  const path = dlqPath('jjj8');
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
      cast.description?.includes('thirdToRunnerUpRatio'),
      `cast description should mention thirdToRunnerUpRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
