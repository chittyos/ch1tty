/**
 * HHHHHH: explanation.runnerUpFocusBoostRatio in ch1tty/cast when explain:true and focus active.
 *
 * runnerUpFocusBoostRatio: number — fraction of runner-up's total score from focus boost
 * (runnerUpFocusBoost / runnerUpScore), value in [0,1].
 *
 * Present when: focus active + runner-up exists + runnerUpScore > 0 (division guard).
 * Absent when: no focus active, cast:no_match, < 2 candidates, or runnerUpScore === 0.
 * Symmetric to winnerFocusBoostRatio.
 * Identity: runnerUpScoreBase / runnerUpScore + runnerUpFocusBoostRatio === 1.
 *
 * Covered:
 *   HHHHHH-1: present when focus active + runner-up exists + runnerUpScore > 0
 *   HHHHHH-2: equals 0 when runner-up out-of-focus (no boost)
 *   HHHHHH-3: equals focusBoost / runnerUpScore when runner-up in-focus
 *   HHHHHH-4: identity: runnerUpScoreBase / runnerUpScore + runnerUpFocusBoostRatio === 1
 *   HHHHHH-5: absent when only 1 candidate (no runner-up)
 *   HHHHHH-6: absent when no focus active
 *   HHHHHH-7: symmetric to winnerFocusBoostRatio — both present under same focus+runner-up conditions
 *   HHHHHH-8: tool description documents runnerUpFocusBoostRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';
import type { FocusProfiles } from '../src/focus.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-hhhhhh-${label}-${Date.now()}.jsonl`);
}

const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe Payments', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.test/mcp',
};
const TASKS_CFG: ServerConfig = {
  id: 'tasks', name: 'Task Manager', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://tasks.test/mcp',
};
const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.test/mcp',
};

const STRIPE_TOOLS: ToolEntry[] = [
  { name: 'create_invoice', description: 'Create Stripe invoice for customer billing payment subscription', inputSchema: { type: 'object', properties: {} } },
];
const TASKS_TOOLS: ToolEntry[] = [
  { name: 'create_billing_task', description: 'Create billing task for pending invoice payment processing', inputSchema: { type: 'object', properties: {} } },
];
const NEON_TOOLS_BILLING: ToolEntry[] = [
  { name: 'run_sql', description: 'Run SQL billing invoice queries on the Neon database for financial analytics', inputSchema: { type: 'object', properties: {} } },
];

// Finance focus: ecosystem (stripe + tasks) in-focus; code (neon) out-of-focus
const FINANCE_PROFILES: FocusProfiles = {
  profiles: {
    finance: { description: 'Financial tools', categories: ['ecosystem'], servers: ['stripe', 'tasks'], boost: 0.5 },
  },
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

function buildAgg(
  label: string,
  configs: ServerConfig[],
  toolMap: Record<string, ToolEntry[]>,
  opts: { focus?: string; profiles?: FocusProfiles } = {},
): Aggregator {
  const path = dlqPath(label);
  return new Aggregator(configs, {
    backendFactory: (cfg) => makeBackend(toolMap[cfg.id] ?? []),
    focusProfiles: opts.profiles ?? { profiles: {} },
    suggestionsCatalog: {},
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
    focus: opts.focus,
  });
}

test('HHHHHH-1: present when focus active + runner-up exists + runnerUpScore > 0', async () => {
  const agg = buildAgg(
    'h1',
    [STRIPE_CFG, TASKS_CFG],
    { stripe: STRIPE_TOOLS, tasks: TASKS_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('runnerUpFocusBoostRatio' in explanation, `runnerUpFocusBoostRatio absent; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('HHHHHH-2: equals 0 when runner-up out-of-focus (no boost)', async () => {
  // stripe (winner, in-focus) beats neon (runner-up, code/out-of-focus) → runnerUpFocusBoost === 0
  const agg = buildAgg(
    'h2',
    [STRIPE_CFG, NEON_CFG],
    { stripe: STRIPE_TOOLS, neon: NEON_TOOLS_BILLING },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('runnerUpFocusBoostRatio' in explanation, 'runnerUpFocusBoostRatio absent');
    assert.equal(explanation.runnerUpInFocus, false, 'expected runner-up out-of-focus');
    assert.equal(
      explanation.runnerUpFocusBoostRatio,
      0,
      `runnerUpFocusBoostRatio should be 0 when runner-up out-of-focus, got ${explanation.runnerUpFocusBoostRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('HHHHHH-3: equals focusBoost / runnerUpScore when runner-up in-focus', async () => {
  // Both stripe + tasks are ecosystem/in-focus under finance
  const agg = buildAgg(
    'h3',
    [STRIPE_CFG, TASKS_CFG],
    { stripe: STRIPE_TOOLS, tasks: TASKS_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('runnerUpFocusBoostRatio' in explanation, 'runnerUpFocusBoostRatio absent');
    assert.equal(explanation.runnerUpInFocus, true, 'expected runner-up in-focus');
    const expected = FINANCE_PROFILES.profiles.finance.boost / explanation.runnerUpScore;
    assert.ok(
      Math.abs(explanation.runnerUpFocusBoostRatio - expected) < 1e-9,
      `runnerUpFocusBoostRatio (${explanation.runnerUpFocusBoostRatio}) should equal focusBoost/runnerUpScore (${expected})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('HHHHHH-4: identity: runnerUpScoreBase / runnerUpScore + runnerUpFocusBoostRatio === 1', async () => {
  const agg = buildAgg(
    'h4',
    [STRIPE_CFG, NEON_CFG],
    { stripe: STRIPE_TOOLS, neon: NEON_TOOLS_BILLING },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('runnerUpScoreBase' in explanation, 'runnerUpScoreBase absent');
    assert.ok('runnerUpFocusBoostRatio' in explanation, 'runnerUpFocusBoostRatio absent');
    assert.ok('runnerUpScore' in explanation, 'runnerUpScore absent');
    const sum = explanation.runnerUpScoreBase / explanation.runnerUpScore + explanation.runnerUpFocusBoostRatio;
    assert.ok(
      Math.abs(sum - 1) < 1e-9,
      `identity violated: runnerUpScoreBase/runnerUpScore + runnerUpFocusBoostRatio = ${sum} ≠ 1`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('HHHHHH-5: absent when only 1 candidate (no runner-up)', async () => {
  const agg = buildAgg(
    'h5',
    [STRIPE_CFG],
    { stripe: STRIPE_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(
      !('runnerUpFocusBoostRatio' in explanation),
      `runnerUpFocusBoostRatio should be absent with single candidate, got ${explanation.runnerUpFocusBoostRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('HHHHHH-6: absent when no focus active', async () => {
  const agg = buildAgg(
    'h6',
    [STRIPE_CFG, NEON_CFG],
    { stripe: STRIPE_TOOLS, neon: NEON_TOOLS_BILLING },
    // no focus
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(
      !('runnerUpFocusBoostRatio' in explanation),
      `runnerUpFocusBoostRatio should be absent without focus, got ${explanation.runnerUpFocusBoostRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('HHHHHH-7: symmetric to winnerFocusBoostRatio — both present under same conditions', async () => {
  const agg = buildAgg(
    'h7',
    [STRIPE_CFG, NEON_CFG],
    { stripe: STRIPE_TOOLS, neon: NEON_TOOLS_BILLING },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('winnerFocusBoostRatio' in explanation, 'winnerFocusBoostRatio absent');
    assert.ok('runnerUpFocusBoostRatio' in explanation, 'runnerUpFocusBoostRatio absent');
    assert.equal(typeof explanation.winnerFocusBoostRatio, 'number', 'winnerFocusBoostRatio not number');
    assert.equal(typeof explanation.runnerUpFocusBoostRatio, 'number', 'runnerUpFocusBoostRatio not number');
    assert.ok(explanation.winnerFocusBoostRatio >= 0 && explanation.winnerFocusBoostRatio <= 1, 'winnerFocusBoostRatio not in [0,1]');
    assert.ok(explanation.runnerUpFocusBoostRatio >= 0 && explanation.runnerUpFocusBoostRatio <= 1, 'runnerUpFocusBoostRatio not in [0,1]');
  } finally {
    await agg.shutdown();
  }
});

test('HHHHHH-8: tool description documents runnerUpFocusBoostRatio', async () => {
  const path = dlqPath('h8');
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
      cast.description?.includes('runnerUpFocusBoostRatio'),
      `cast description should mention runnerUpFocusBoostRatio; excerpt: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
