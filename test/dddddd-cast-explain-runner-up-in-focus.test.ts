/**
 * DDDDDD: explanation.runnerUpInFocus in ch1tty/cast when explain:true and focus active.
 *
 * runnerUpInFocus: boolean — whether the runner-up tool's server or category matches
 * the active focus profile (i.e. the runner-up received an additive boost).
 *
 * Present when: focus active + runner-up exists (same conditions as focusDecisive/focusMargin).
 * Absent when: no focus active, cast:no_match, or < 2 candidates.
 * Symmetric to winnerInFocus.
 *
 * Covered:
 *   DDDDDD-1: present when focus active + runner-up exists
 *   DDDDDD-2: true when runner-up is in-focus
 *   DDDDDD-3: false when runner-up is out-of-focus
 *   DDDDDD-4: absent when only 1 candidate (no runner-up)
 *   DDDDDD-5: absent when no focus active
 *   DDDDDD-6: boolean type
 *   DDDDDD-7: symmetric to winnerInFocus (both present when focus + runner-up)
 *   DDDDDD-8: tool description documents runnerUpInFocus
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
  return join(tmpdir(), `ch1tty-dddddd-${label}-${Date.now()}.jsonl`);
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
const NEON_TOOLS: ToolEntry[] = [
  { name: 'run_sql', description: 'Execute SQL queries on the Neon database for code analysis', inputSchema: { type: 'object', properties: {} } },
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

test('DDDDDD-1: present when focus active + runner-up exists', async () => {
  const agg = buildAgg(
    'd1',
    [STRIPE_CFG, TASKS_CFG],
    { stripe: STRIPE_TOOLS, tasks: TASKS_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('runnerUpInFocus' in explanation, `runnerUpInFocus absent; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('DDDDDD-2: true when runner-up is in-focus', async () => {
  // Both stripe (winner) and tasks (runner-up) are ecosystem → both in-focus under finance.
  const agg = buildAgg(
    'd2',
    [STRIPE_CFG, TASKS_CFG],
    { stripe: STRIPE_TOOLS, tasks: TASKS_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('runnerUpInFocus' in explanation, 'runnerUpInFocus absent');
    assert.equal(
      explanation.runnerUpInFocus,
      true,
      `expected runnerUpInFocus true (tasks is ecosystem/in-focus), got ${explanation.runnerUpInFocus}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('DDDDDD-3: false when runner-up is out-of-focus', async () => {
  // stripe (winner, ecosystem/in-focus) beats neon (runner-up, code/out-of-focus).
  // NEON_TOOLS_BILLING ensures neon scores as runner-up against billing/invoice intent.
  const agg = buildAgg(
    'd3',
    [STRIPE_CFG, NEON_CFG],
    { stripe: STRIPE_TOOLS, neon: NEON_TOOLS_BILLING },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('runnerUpInFocus' in explanation, 'runnerUpInFocus absent');
    assert.equal(
      explanation.runnerUpInFocus,
      false,
      `expected runnerUpInFocus false (neon is code/out-of-focus), got ${explanation.runnerUpInFocus}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('DDDDDD-4: absent when only 1 candidate (no runner-up)', async () => {
  // Only stripe in registry → winner exists but no runner-up → runnerUpInFocus absent.
  const agg = buildAgg(
    'd4',
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
      !('runnerUpInFocus' in explanation),
      `runnerUpInFocus should be absent with single candidate, got ${explanation.runnerUpInFocus}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('DDDDDD-5: absent when no focus active', async () => {
  // 2 tools, no focus → runner-up exists but focus is off → runnerUpInFocus absent.
  const agg = buildAgg(
    'd5',
    [STRIPE_CFG, NEON_CFG],
    { stripe: STRIPE_TOOLS, neon: NEON_TOOLS },
    // no focus
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(
      !('runnerUpInFocus' in explanation),
      `runnerUpInFocus should be absent without focus, got ${explanation.runnerUpInFocus}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('DDDDDD-6: boolean type', async () => {
  const agg = buildAgg(
    'd6',
    [STRIPE_CFG, NEON_CFG],
    { stripe: STRIPE_TOOLS, neon: NEON_TOOLS_BILLING },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('runnerUpInFocus' in explanation, 'runnerUpInFocus absent');
    assert.equal(
      typeof explanation.runnerUpInFocus,
      'boolean',
      `runnerUpInFocus should be boolean, got ${typeof explanation.runnerUpInFocus}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('DDDDDD-7: symmetric to winnerInFocus — both present under same focus+runner-up conditions', async () => {
  const agg = buildAgg(
    'd7',
    [STRIPE_CFG, NEON_CFG],
    { stripe: STRIPE_TOOLS, neon: NEON_TOOLS_BILLING },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('winnerInFocus' in explanation, 'winnerInFocus absent');
    assert.ok('runnerUpInFocus' in explanation, 'runnerUpInFocus absent');
    assert.equal(typeof explanation.winnerInFocus, 'boolean', 'winnerInFocus not boolean');
    assert.equal(typeof explanation.runnerUpInFocus, 'boolean', 'runnerUpInFocus not boolean');
  } finally {
    await agg.shutdown();
  }
});

test('DDDDDD-8: tool description documents runnerUpInFocus', async () => {
  const path = dlqPath('d8');
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
      cast.description?.includes('runnerUpInFocus'),
      `cast description should mention runnerUpInFocus; excerpt: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
