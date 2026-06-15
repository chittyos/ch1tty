/**
 * FFFFFF: explanation.runnerUpFocusBoost in ch1tty/cast when explain:true and focus active.
 *
 * runnerUpFocusBoost: number — exact additive focus boost applied to the runner-up tool.
 * Equals focusBoost when runnerUpInFocus is true; 0 when runnerUpInFocus is false.
 *
 * Present when: focus active + runner-up exists (same conditions as runnerUpInFocus).
 * Absent when: no focus active, cast:no_match, or < 2 candidates.
 * Symmetric to winnerFocusBoost.
 *
 * Covered:
 *   FFFFFF-1: present when focus active + runner-up exists
 *   FFFFFF-2: equals focusBoost when runner-up is in-focus
 *   FFFFFF-3: equals 0 when runner-up is out-of-focus
 *   FFFFFF-4: absent when only 1 candidate (no runner-up)
 *   FFFFFF-5: absent when no focus active
 *   FFFFFF-6: number type
 *   FFFFFF-7: symmetric to winnerFocusBoost — both present under same focus+runner-up conditions
 *   FFFFFF-8: tool description documents runnerUpFocusBoost
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
  return join(tmpdir(), `ch1tty-ffffff-${label}-${Date.now()}.jsonl`);
}

// Stripe: ecosystem → in-focus under finance
const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe Payments', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.test/mcp',
};
// Tasks: ecosystem → in-focus under finance (for runner-up in-focus scenario)
const TASKS_CFG: ServerConfig = {
  id: 'tasks', name: 'Task Manager', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://tasks.test/mcp',
};
// Neon: code → out-of-focus under finance
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
// Neon with billing keywords so it scores as runner-up against invoice/billing intents
const NEON_TOOLS_BILLING: ToolEntry[] = [
  { name: 'run_sql', description: 'Run SQL billing invoice queries on the Neon database for financial analytics', inputSchema: { type: 'object', properties: {} } },
];

// Finance focus: boosts ecosystem servers (stripe + tasks both in-focus); code (neon) out-of-focus
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

test('FFFFFF-1: present when focus active + runner-up exists', async () => {
  const agg = buildAgg(
    'f1',
    [STRIPE_CFG, TASKS_CFG],
    { stripe: STRIPE_TOOLS, tasks: TASKS_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('runnerUpFocusBoost' in explanation, `runnerUpFocusBoost absent; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('FFFFFF-2: equals focusBoost when runner-up is in-focus', async () => {
  // Both stripe (winner) and tasks (runner-up) are ecosystem → both in-focus under finance.
  const agg = buildAgg(
    'f2',
    [STRIPE_CFG, TASKS_CFG],
    { stripe: STRIPE_TOOLS, tasks: TASKS_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('runnerUpFocusBoost' in explanation, 'runnerUpFocusBoost absent');
    assert.ok(explanation.runnerUpInFocus === true, `expected runnerUpInFocus true (tasks in-focus), got ${explanation.runnerUpInFocus}`);
    assert.equal(
      explanation.runnerUpFocusBoost,
      FINANCE_PROFILES.profiles.finance.boost,
      `runnerUpFocusBoost (${explanation.runnerUpFocusBoost}) should equal focusBoost (${FINANCE_PROFILES.profiles.finance.boost}) when runner-up in-focus`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('FFFFFF-3: equals 0 when runner-up is out-of-focus', async () => {
  // stripe (winner, ecosystem/in-focus) beats neon (runner-up, code/out-of-focus).
  const agg = buildAgg(
    'f3',
    [STRIPE_CFG, NEON_CFG],
    { stripe: STRIPE_TOOLS, neon: NEON_TOOLS_BILLING },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('runnerUpFocusBoost' in explanation, 'runnerUpFocusBoost absent');
    assert.ok(explanation.runnerUpInFocus === false, `expected runnerUpInFocus false (neon out-of-focus), got ${explanation.runnerUpInFocus}`);
    assert.equal(
      explanation.runnerUpFocusBoost,
      0,
      `runnerUpFocusBoost should be 0 when runner-up out-of-focus, got ${explanation.runnerUpFocusBoost}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('FFFFFF-4: absent when only 1 candidate (no runner-up)', async () => {
  const agg = buildAgg(
    'f4',
    [STRIPE_CFG],
    { stripe: STRIPE_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(
      !('runnerUpFocusBoost' in explanation),
      `runnerUpFocusBoost should be absent with single candidate, got ${explanation.runnerUpFocusBoost}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('FFFFFF-5: absent when no focus active', async () => {
  const agg = buildAgg(
    'f5',
    [STRIPE_CFG, NEON_CFG],
    { stripe: STRIPE_TOOLS, neon: NEON_TOOLS_BILLING },
    // no focus
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(
      !('runnerUpFocusBoost' in explanation),
      `runnerUpFocusBoost should be absent without focus, got ${explanation.runnerUpFocusBoost}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('FFFFFF-6: number type', async () => {
  const agg = buildAgg(
    'f6',
    [STRIPE_CFG, NEON_CFG],
    { stripe: STRIPE_TOOLS, neon: NEON_TOOLS_BILLING },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('runnerUpFocusBoost' in explanation, 'runnerUpFocusBoost absent');
    assert.equal(
      typeof explanation.runnerUpFocusBoost,
      'number',
      `runnerUpFocusBoost should be number, got ${typeof explanation.runnerUpFocusBoost}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('FFFFFF-7: symmetric to winnerFocusBoost — both present under same focus+runner-up conditions', async () => {
  const agg = buildAgg(
    'f7',
    [STRIPE_CFG, NEON_CFG],
    { stripe: STRIPE_TOOLS, neon: NEON_TOOLS_BILLING },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('winnerFocusBoost' in explanation, 'winnerFocusBoost absent');
    assert.ok('runnerUpFocusBoost' in explanation, 'runnerUpFocusBoost absent');
    assert.equal(typeof explanation.winnerFocusBoost, 'number', 'winnerFocusBoost not number');
    assert.equal(typeof explanation.runnerUpFocusBoost, 'number', 'runnerUpFocusBoost not number');
  } finally {
    await agg.shutdown();
  }
});

test('FFFFFF-8: tool description documents runnerUpFocusBoost', async () => {
  const path = dlqPath('f8');
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
      cast.description?.includes('runnerUpFocusBoost'),
      `cast description should mention runnerUpFocusBoost; excerpt: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
