/**
 * GGGGGG: explanation.runnerUpScoreBase in ch1tty/cast when explain:true and focus active.
 *
 * runnerUpScoreBase: number — runner-up's pre-focus relevance score
 * (runnerUpScore - runnerUpFocusBoost).
 *
 * Present when: focus active + runner-up exists (same as runnerUpFocusBoost).
 * Absent when: no focus active, cast:no_match, or < 2 candidates.
 * Identity: runnerUpScoreBase + runnerUpFocusBoost === runnerUpScore.
 * Symmetric to winnerScoreBase.
 *
 * Covered:
 *   GGGGGG-1: present when focus active + runner-up exists
 *   GGGGGG-2: equals runnerUpScore when runner-up is out-of-focus
 *   GGGGGG-3: equals runnerUpScore - focusBoost when runner-up is in-focus
 *   GGGGGG-4: identity runnerUpScoreBase + runnerUpFocusBoost === runnerUpScore
 *   GGGGGG-5: absent when only 1 candidate
 *   GGGGGG-6: absent when no focus active
 *   GGGGGG-7: absent on cast:no_match
 *   GGGGGG-8: tool description documents runnerUpScoreBase
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
  return join(tmpdir(), `ch1tty-gggggg-${label}-${Date.now()}.jsonl`);
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

test('GGGGGG-1: present when focus active + runner-up exists', async () => {
  const agg = buildAgg('g1', [STRIPE_CFG, TASKS_CFG], { stripe: STRIPE_TOOLS, tasks: TASKS_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('focus' in explanation, 'focus should be active');
    assert.ok('runnerUpScore' in explanation, 'runnerUpScore should be present');
    assert.ok('runnerUpScoreBase' in explanation,
      `runnerUpScoreBase should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.runnerUpScoreBase, 'number', 'runnerUpScoreBase should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('GGGGGG-2: equals runnerUpScore when runner-up is out-of-focus', async () => {
  // Finance focus: neon (code) is out-of-focus → runnerUpFocusBoost === 0 → runnerUpScoreBase === runnerUpScore
  const agg = buildAgg('g2', [STRIPE_CFG, NEON_CFG], { stripe: STRIPE_TOOLS, neon: NEON_TOOLS_BILLING },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('runnerUpScoreBase' in explanation, 'runnerUpScoreBase should be present');
    assert.equal(explanation.runnerUpInFocus, false, 'runner-up should be out-of-focus');
    assert.ok(
      Math.abs(explanation.runnerUpScoreBase - explanation.runnerUpScore) < 1e-9,
      `runnerUpScoreBase (${explanation.runnerUpScoreBase}) should equal runnerUpScore (${explanation.runnerUpScore}) when out-of-focus`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GGGGGG-3: equals runnerUpScore - focusBoost when runner-up is in-focus', async () => {
  // Both stripe + tasks are ecosystem/in-focus under finance
  const agg = buildAgg('g3', [STRIPE_CFG, TASKS_CFG], { stripe: STRIPE_TOOLS, tasks: TASKS_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('runnerUpScoreBase' in explanation, 'runnerUpScoreBase should be present');
    assert.equal(explanation.runnerUpInFocus, true, 'runner-up should be in-focus');
    const expected = explanation.runnerUpScore - explanation.focusBoost;
    assert.ok(
      Math.abs(explanation.runnerUpScoreBase - expected) < 1e-9,
      `runnerUpScoreBase (${explanation.runnerUpScoreBase}) should equal runnerUpScore - focusBoost (${expected}) when in-focus`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GGGGGG-4: identity runnerUpScoreBase + runnerUpFocusBoost === runnerUpScore', async () => {
  const agg = buildAgg('g4', [STRIPE_CFG, TASKS_CFG], { stripe: STRIPE_TOOLS, tasks: TASKS_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('runnerUpScoreBase' in explanation, 'runnerUpScoreBase should be present');
    assert.ok('runnerUpFocusBoost' in explanation, 'runnerUpFocusBoost should be present');
    const computed = explanation.runnerUpScoreBase + explanation.runnerUpFocusBoost;
    assert.ok(
      Math.abs(computed - explanation.runnerUpScore) < 1e-9,
      `runnerUpScoreBase + runnerUpFocusBoost (${computed}) should equal runnerUpScore (${explanation.runnerUpScore})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GGGGGG-5: absent when only 1 candidate', async () => {
  const agg = buildAgg('g5', [STRIPE_CFG], { stripe: STRIPE_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok('focus' in explanation, 'focus should be active');
    assert.ok(
      !('runnerUpScoreBase' in explanation),
      `runnerUpScoreBase should be absent with single candidate, found: ${explanation.runnerUpScoreBase}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GGGGGG-6: absent when no focus active', async () => {
  const agg = buildAgg('g6', [STRIPE_CFG, TASKS_CFG], { stripe: STRIPE_TOOLS, tasks: TASKS_TOOLS }); // no focus
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok(
      !('runnerUpScoreBase' in explanation),
      `runnerUpScoreBase should be absent without focus, found: ${explanation.runnerUpScoreBase}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GGGGGG-7: absent on cast:no_match', async () => {
  const path = dlqPath('g7');
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
      !('runnerUpScoreBase' in parsed.explanation),
      `runnerUpScoreBase should be absent on no_match, found: ${parsed.explanation.runnerUpScoreBase}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('GGGGGG-8: tool description documents runnerUpScoreBase', async () => {
  const path = dlqPath('g8');
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
      cast.description?.includes('runnerUpScoreBase'),
      `cast description should mention runnerUpScoreBase, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
