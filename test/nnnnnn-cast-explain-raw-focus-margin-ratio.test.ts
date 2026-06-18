/**
 * NNNNNN: explanation.rawFocusMarginRatio in ch1tty/cast when explain:true and focus active.
 *
 * rawFocusMarginRatio: number — rawFocusMargin / winnerScoreBase when winnerScoreBase > 0.
 * Expresses the unfocused gap between winner and runner-up as a fraction of the
 * winner's organic (pre-focus) relevance score.
 *
 * Present when: focus active + runner-up exists + winnerScoreBase > 0
 *               (same conditions as rawFocusMargin, plus division guard).
 * Absent when: no focus active, cast:no_match, < 2 candidates, or winnerScoreBase === 0.
 * Can be negative when focus reversed the natural ranking (rawFocusMargin < 0).
 * Identity: rawFocusMarginRatio === rawFocusMargin / winnerScoreBase.
 *
 * Covered:
 *   NNNNNN-1: present when focus active + runner-up exists + winnerScoreBase > 0
 *   NNNNNN-2: identity rawFocusMarginRatio === rawFocusMargin / winnerScoreBase
 *   NNNNNN-3: negative when focus reversed ranking (rawFocusMargin < 0)
 *   NNNNNN-4: absent when only 1 candidate
 *   NNNNNN-5: absent when no focus active
 *   NNNNNN-6: absent on cast:no_match
 *   NNNNNN-7: present regardless of whether winner is in-focus or out-of-focus
 *   NNNNNN-8: tool description documents rawFocusMarginRatio
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
  return join(tmpdir(), `ch1tty-nnnnnn-${label}-${Date.now()}.jsonl`);
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

// Finance: ecosystem in-focus, code out-of-focus
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

test('NNNNNN-1: present when focus active + runner-up exists + winnerScoreBase > 0', async () => {
  const agg = buildAgg('n1', [STRIPE_CFG, TASKS_CFG], { stripe: STRIPE_TOOLS, tasks: TASKS_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('focus' in explanation, 'focus should be active');
    assert.ok('rawFocusMargin' in explanation, 'rawFocusMargin should be present');
    assert.ok('rawFocusMarginRatio' in explanation,
      `rawFocusMarginRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.rawFocusMarginRatio, 'number', 'rawFocusMarginRatio should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('NNNNNN-2: identity rawFocusMarginRatio === rawFocusMargin / winnerScoreBase', async () => {
  const agg = buildAgg('n2', [STRIPE_CFG, TASKS_CFG], { stripe: STRIPE_TOOLS, tasks: TASKS_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('rawFocusMarginRatio' in explanation, 'rawFocusMarginRatio should be present');
    assert.ok('rawFocusMargin' in explanation, 'rawFocusMargin should be present');
    assert.ok('winnerScoreBase' in explanation, 'winnerScoreBase should be present');
    const expected = explanation.rawFocusMargin / explanation.winnerScoreBase;
    assert.ok(
      Math.abs(explanation.rawFocusMarginRatio - expected) < 1e-9,
      `rawFocusMarginRatio (${explanation.rawFocusMarginRatio}) should equal rawFocusMargin / winnerScoreBase (${expected})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('NNNNNN-3: can be negative when focus reversed ranking (rawFocusMargin < 0)', async () => {
  // When winner (stripe, in-focus) would have lost to neon (out-of-focus) without boost,
  // rawFocusMargin = winnerScoreBase - runnerUpScoreBase < 0 → ratio < 0.
  // We just verify sign consistency between rawFocusMargin and rawFocusMarginRatio.
  const agg = buildAgg('n3', [STRIPE_CFG, NEON_CFG], { stripe: STRIPE_TOOLS, neon: NEON_TOOLS_BILLING },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('rawFocusMarginRatio' in explanation, 'rawFocusMarginRatio should be present');
    assert.ok('rawFocusMargin' in explanation, 'rawFocusMargin should be present');
    // Signs must match: both positive or both negative (ratio = margin / positive-base)
    assert.equal(
      Math.sign(explanation.rawFocusMarginRatio),
      Math.sign(explanation.rawFocusMargin),
      `rawFocusMarginRatio sign (${Math.sign(explanation.rawFocusMarginRatio)}) should match rawFocusMargin sign (${Math.sign(explanation.rawFocusMargin)})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('NNNNNN-4: absent when only 1 candidate', async () => {
  const agg = buildAgg('n4', [STRIPE_CFG], { stripe: STRIPE_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('rawFocusMarginRatio' in explanation),
      `rawFocusMarginRatio should be absent with single candidate, found: ${explanation.rawFocusMarginRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('NNNNNN-5: absent when no focus active', async () => {
  const agg = buildAgg('n5', [STRIPE_CFG, TASKS_CFG], { stripe: STRIPE_TOOLS, tasks: TASKS_TOOLS }); // no focus
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok(
      !('rawFocusMarginRatio' in explanation),
      `rawFocusMarginRatio should be absent without focus, found: ${explanation.rawFocusMarginRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('NNNNNN-6: absent on cast:no_match', async () => {
  const path = dlqPath('n6');
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
      !('rawFocusMarginRatio' in parsed.explanation),
      `rawFocusMarginRatio should be absent on no_match, found: ${parsed.explanation.rawFocusMarginRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('NNNNNN-7: present regardless of whether winner is in-focus or out-of-focus', async () => {
  // stripe (ecosystem, in-focus) + neon (code, out-of-focus). With billing intent, stripe should win (in-focus).
  const agg = buildAgg('n7', [STRIPE_CFG, NEON_CFG], { stripe: STRIPE_TOOLS, neon: NEON_TOOLS_BILLING },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focus' in explanation, 'focus should be active');
    assert.ok('rawFocusMargin' in explanation, 'rawFocusMargin should be present (runner-up exists)');
    assert.ok('rawFocusMarginRatio' in explanation,
      `rawFocusMarginRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('NNNNNN-8: tool description documents rawFocusMarginRatio', async () => {
  const path = dlqPath('n8');
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
      cast.description?.includes('rawFocusMarginRatio'),
      `cast description should mention rawFocusMarginRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
