/**
 * KKKKKK: explanation.focusNetBoostDelta in ch1tty/cast when explain:true and focus active.
 *
 * focusNetBoostDelta: number — net differential focus boost winner received vs runner-up
 * (winnerFocusBoost - runnerUpFocusBoost).
 *
 * Values: +focusBoost (winner in-focus, runner-up out), 0 (both same), -focusBoost (vice versa).
 * Identity: focusMargin === rawFocusMargin + focusNetBoostDelta.
 *
 * Present when: focus active + runner-up exists (same as rawFocusMargin).
 * Absent when: no focus active, cast:no_match, or < 2 candidates.
 *
 * Covered:
 *   KKKKKK-1: present when focus active + runner-up exists
 *   KKKKKK-2: equals +focusBoost when winner in-focus, runner-up out-of-focus
 *   KKKKKK-3: equals 0 when both in-focus (equal boosts cancel)
 *   KKKKKK-4: equals -focusBoost when winner out-of-focus, runner-up in-focus
 *   KKKKKK-5: identity focusMargin === rawFocusMargin + focusNetBoostDelta
 *   KKKKKK-6: absent when no focus active
 *   KKKKKK-7: absent when only 1 candidate
 *   KKKKKK-8: tool description documents focusNetBoostDelta
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
  return join(tmpdir(), `ch1tty-kkkkkk-${label}-${Date.now()}.jsonl`);
}

// Stripe: ecosystem → in-focus under finance
const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe Payments', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.test/mcp',
};
// Tasks: ecosystem → in-focus under finance
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
// Neon with billing keywords to score as runner-up against billing/invoice intents
const NEON_TOOLS_BILLING: ToolEntry[] = [
  { name: 'run_sql', description: 'Run SQL billing invoice queries on the Neon database for financial analytics', inputSchema: { type: 'object', properties: {} } },
];
// Strong neon tools to make neon win over stripe against SQL intent
const NEON_TOOLS_STRONG: ToolEntry[] = [
  { name: 'run_sql', description: 'Execute run SQL query database neon analytics financial reporting', inputSchema: { type: 'object', properties: {} } },
];
// Stripe with weak SQL overlap (query+database, 2/5 → score 0.4 base, 0.9 after boost) so
// neon (1.0) still wins despite stripe receiving the +0.5 focus boost as runner-up.
const STRIPE_TOOLS_WEAK: ToolEntry[] = [
  { name: 'export_transactions', description: 'Query database records for payment processing and reporting', inputSchema: { type: 'object', properties: {} } },
];

// Finance focus: boosts ecosystem (stripe + tasks); code (neon) out-of-focus
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

test('KKKKKK-1: present when focus active + runner-up exists', async () => {
  const agg = buildAgg(
    'k1',
    [STRIPE_CFG, TASKS_CFG],
    { stripe: STRIPE_TOOLS, tasks: TASKS_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('focusNetBoostDelta' in explanation, `focusNetBoostDelta absent; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKK-2: equals +focusBoost when winner in-focus, runner-up out-of-focus', async () => {
  // stripe (in-focus) wins over neon (out-of-focus): delta = focusBoost - 0 = +focusBoost
  const agg = buildAgg(
    'k2',
    [STRIPE_CFG, NEON_CFG],
    { stripe: STRIPE_TOOLS, neon: NEON_TOOLS_BILLING },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focusNetBoostDelta' in explanation, 'focusNetBoostDelta absent');
    assert.equal(explanation.winnerInFocus, true, 'expected winner in-focus');
    assert.equal(explanation.runnerUpInFocus, false, 'expected runner-up out-of-focus');
    assert.equal(
      explanation.focusNetBoostDelta,
      FINANCE_PROFILES.profiles.finance.boost,
      `focusNetBoostDelta (${explanation.focusNetBoostDelta}) should equal +focusBoost (${FINANCE_PROFILES.profiles.finance.boost})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKK-3: equals 0 when both in-focus (equal boosts cancel)', async () => {
  // Both stripe + tasks are ecosystem/in-focus: delta = focusBoost - focusBoost = 0
  const agg = buildAgg(
    'k3',
    [STRIPE_CFG, TASKS_CFG],
    { stripe: STRIPE_TOOLS, tasks: TASKS_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focusNetBoostDelta' in explanation, 'focusNetBoostDelta absent');
    assert.equal(explanation.winnerInFocus, true, 'expected winner in-focus');
    assert.equal(explanation.runnerUpInFocus, true, 'expected runner-up in-focus');
    assert.equal(
      explanation.focusNetBoostDelta,
      0,
      `focusNetBoostDelta should be 0 when both in-focus, got ${explanation.focusNetBoostDelta}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKK-4: equals -focusBoost when winner out-of-focus, runner-up in-focus', async () => {
  // neon (out-of-focus, code) beats stripe (in-focus, ecosystem) on SQL intent.
  // NEON_TOOLS_STRONG scores 1.0 base (5/5 terms). STRIPE_TOOLS_WEAK scores 0.4 base
  // (2/5 terms: query+database) → 0.9 after +0.5 focus boost. Neon (1.0) > stripe (0.9).
  // stripe is runner-up (in-focus): delta = 0 - focusBoost = -focusBoost
  const agg = buildAgg(
    'k4',
    [NEON_CFG, STRIPE_CFG],
    { neon: NEON_TOOLS_STRONG, stripe: STRIPE_TOOLS_WEAK },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query database analytics', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focusNetBoostDelta' in explanation, 'focusNetBoostDelta absent');
    assert.equal(explanation.winnerInFocus, false, `expected winner out-of-focus, got winnerInFocus=${explanation.winnerInFocus}, winnerTool=${explanation.winnerTool}`);
    assert.equal(explanation.runnerUpInFocus, true, `expected runner-up in-focus, got ${explanation.runnerUpInFocus}`);
    assert.equal(
      explanation.focusNetBoostDelta,
      -FINANCE_PROFILES.profiles.finance.boost,
      `focusNetBoostDelta (${explanation.focusNetBoostDelta}) should equal -focusBoost (${-FINANCE_PROFILES.profiles.finance.boost})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKK-5: identity focusMargin === rawFocusMargin + focusNetBoostDelta', async () => {
  const agg = buildAgg(
    'k5',
    [STRIPE_CFG, NEON_CFG],
    { stripe: STRIPE_TOOLS, neon: NEON_TOOLS_BILLING },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focusMargin' in explanation, 'focusMargin absent');
    assert.ok('rawFocusMargin' in explanation, 'rawFocusMargin absent');
    assert.ok('focusNetBoostDelta' in explanation, 'focusNetBoostDelta absent');
    const sum = explanation.rawFocusMargin + explanation.focusNetBoostDelta;
    assert.ok(
      Math.abs(sum - explanation.focusMargin) < 1e-9,
      `identity violated: rawFocusMargin (${explanation.rawFocusMargin}) + focusNetBoostDelta (${explanation.focusNetBoostDelta}) = ${sum} ≠ focusMargin (${explanation.focusMargin})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKK-6: absent when no focus active', async () => {
  const agg = buildAgg(
    'k6',
    [STRIPE_CFG, NEON_CFG],
    { stripe: STRIPE_TOOLS, neon: NEON_TOOLS_BILLING },
    // no focus
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(
      !('focusNetBoostDelta' in explanation),
      `focusNetBoostDelta should be absent without focus, got ${explanation.focusNetBoostDelta}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKK-7: absent when only 1 candidate', async () => {
  const agg = buildAgg(
    'k7',
    [STRIPE_CFG],
    { stripe: STRIPE_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(
      !('focusNetBoostDelta' in explanation),
      `focusNetBoostDelta should be absent with single candidate, got ${explanation.focusNetBoostDelta}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKK-8: tool description documents focusNetBoostDelta', async () => {
  const path = dlqPath('k8');
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
      cast.description?.includes('focusNetBoostDelta'),
      `cast description should mention focusNetBoostDelta; excerpt: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
