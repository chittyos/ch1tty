/**
 * OOOOOO: explanation.focusMarginRatio in ch1tty/cast when explain:true and focus active.
 *
 * focusMarginRatio: number — focusMargin / winnerScore when winnerScore > 0.
 * Expresses the post-focus gap between winner and runner-up as a fraction
 * of the winner's total (post-focus) score.
 *
 * Present when: focus active + runner-up exists + winnerScore > 0.
 * Absent when: no focus active, cast:no_match, < 2 candidates, or winnerScore === 0.
 * Always in (−∞, 1]; effectively >= 0 since focusMargin >= 0 and winnerScore > 0.
 * Identity: focusMarginRatio === focusMargin / winnerScore.
 * Symmetric to rawFocusMarginRatio but in boosted score space.
 *
 * Covered:
 *   OOOOOO-1: present when focus active + runner-up exists + winnerScore > 0
 *   OOOOOO-2: identity focusMarginRatio === focusMargin / winnerScore
 *   OOOOOO-3: >= 0 (focusMargin >= 0 and winnerScore > 0)
 *   OOOOOO-4: <= 1 (winner score >= runner-up score in sorted pool)
 *   OOOOOO-5: absent when only 1 candidate
 *   OOOOOO-6: absent when no focus active
 *   OOOOOO-7: absent on cast:no_match
 *   OOOOOO-8: tool description documents focusMarginRatio
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
  return join(tmpdir(), `ch1tty-oooooo-${label}-${Date.now()}.jsonl`);
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

test('OOOOOO-1: present when focus active + runner-up exists + winnerScore > 0', async () => {
  const agg = buildAgg('o1', [STRIPE_CFG, TASKS_CFG], { stripe: STRIPE_TOOLS, tasks: TASKS_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('focus' in explanation, 'focus should be active');
    assert.ok('focusMargin' in explanation, 'focusMargin should be present');
    assert.ok('focusMarginRatio' in explanation,
      `focusMarginRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.focusMarginRatio, 'number', 'focusMarginRatio should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('OOOOOO-2: identity focusMarginRatio === focusMargin / winnerScore', async () => {
  const agg = buildAgg('o2', [STRIPE_CFG, TASKS_CFG], { stripe: STRIPE_TOOLS, tasks: TASKS_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focusMarginRatio' in explanation, 'focusMarginRatio should be present');
    assert.ok('focusMargin' in explanation, 'focusMargin should be present');
    assert.ok('winnerScore' in explanation, 'winnerScore should be present');
    const expected = explanation.focusMargin / explanation.winnerScore;
    assert.ok(
      Math.abs(explanation.focusMarginRatio - expected) < 1e-9,
      `focusMarginRatio (${explanation.focusMarginRatio}) should equal focusMargin / winnerScore (${expected})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('OOOOOO-3: focusMarginRatio >= 0', async () => {
  const agg = buildAgg('o3', [STRIPE_CFG, NEON_CFG], { stripe: STRIPE_TOOLS, neon: NEON_TOOLS_BILLING },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focusMarginRatio' in explanation, 'focusMarginRatio should be present');
    assert.ok(
      explanation.focusMarginRatio >= -1e-9,
      `focusMarginRatio should be >= 0, got ${explanation.focusMarginRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('OOOOOO-4: focusMarginRatio <= 1', async () => {
  const agg = buildAgg('o4', [STRIPE_CFG, TASKS_CFG], { stripe: STRIPE_TOOLS, tasks: TASKS_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focusMarginRatio' in explanation, 'focusMarginRatio should be present');
    assert.ok(
      explanation.focusMarginRatio <= 1 + 1e-9,
      `focusMarginRatio should be <= 1, got ${explanation.focusMarginRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('OOOOOO-5: absent when only 1 candidate', async () => {
  const agg = buildAgg('o5', [STRIPE_CFG], { stripe: STRIPE_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('focusMarginRatio' in explanation),
      `focusMarginRatio should be absent with single candidate, found: ${explanation.focusMarginRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('OOOOOO-6: absent when no focus active', async () => {
  const agg = buildAgg('o6', [STRIPE_CFG, TASKS_CFG], { stripe: STRIPE_TOOLS, tasks: TASKS_TOOLS }); // no focus
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok(
      !('focusMarginRatio' in explanation),
      `focusMarginRatio should be absent without focus, found: ${explanation.focusMarginRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('OOOOOO-7: absent on cast:no_match', async () => {
  const path = dlqPath('o7');
  const emptyAgg = new Aggregator([STRIPE_CFG], {
    backendFactory: () => makeBackend([]),
    focusProfiles: FINANCE_PROFILES,
    suggestionsCatalog: {},
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
    focus: 'finance',
  });
  try {
    const r = await emptyAgg.callTool('ch1tty/cast', { intent: 'xyzzy-nonexistent', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'no_match', `expected no_match, got ${parsed.cast}`);
    assert.ok(
      !('focusMarginRatio' in parsed.explanation),
      `focusMarginRatio should be absent on no_match, found: ${parsed.explanation.focusMarginRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('OOOOOO-8: tool description documents focusMarginRatio', async () => {
  const path = dlqPath('o8');
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
      cast.description?.includes('focusMarginRatio'),
      `cast description should mention focusMarginRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
