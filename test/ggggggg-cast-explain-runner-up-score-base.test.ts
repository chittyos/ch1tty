/**
 * GGGGGGG: explanation.runnerUpScoreBase in ch1tty/cast when explain:true and focus active.
 *
 * runnerUpScoreBase: number — runner-up's relevance score before active focus boost was applied
 * (runnerUpScore - runnerUpFocusBoost).
 *
 * Present when: focus active + runner-up exists (same conditions as runnerUpFocusBoost).
 * Absent when: no focus active, cast:no_match, or < 2 candidates.
 * Symmetric to winnerScoreBase.
 *
 * Covered:
 *   GGGGGGG-1: present when focus active + runner-up exists
 *   GGGGGGG-2: equals runnerUpScore - focusBoost when runner-up is in-focus
 *   GGGGGGG-3: equals runnerUpScore when runner-up is out-of-focus (no boost applied)
 *   GGGGGGG-4: absent when only 1 candidate (no runner-up)
 *   GGGGGGG-5: absent when no focus active
 *   GGGGGGG-6: number type
 *   GGGGGGG-7: identity runnerUpScoreBase + runnerUpFocusBoost === runnerUpScore
 *   GGGGGGG-8: tool description documents runnerUpScoreBase
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
  return join(tmpdir(), `ch1tty-ggggggg-${label}-${Date.now()}.jsonl`);
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
// Neon with billing keywords — acts as out-of-focus runner-up
const NEON_TOOLS_BILLING: ToolEntry[] = [
  { name: 'run_sql', description: 'Run SQL billing invoice queries on the Neon database for financial analytics', inputSchema: { type: 'object', properties: {} } },
];

// Finance focus: boosts ecosystem (stripe + tasks in-focus); code (neon) out-of-focus
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

test('GGGGGGG-1: runnerUpScoreBase present when focus active + runner-up exists', async () => {
  const agg = buildAgg(
    'g1',
    [STRIPE_CFG, NEON_CFG],
    { stripe: STRIPE_TOOLS, neon: NEON_TOOLS_BILLING },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('runnerUpScoreBase' in explanation, `runnerUpScoreBase absent; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('GGGGGGG-2: runnerUpScoreBase equals runnerUpScore - focusBoost when runner-up is in-focus', async () => {
  // Both stripe and tasks are ecosystem → both in-focus under finance
  const agg = buildAgg(
    'g2',
    [STRIPE_CFG, TASKS_CFG],
    { stripe: STRIPE_TOOLS, tasks: TASKS_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(explanation.runnerUpInFocus === true, 'runner-up is in-focus');
    const expected = explanation.runnerUpScore - explanation.focusBoost;
    assert.ok(
      Math.abs(explanation.runnerUpScoreBase - expected) < 1e-9,
      `runnerUpScoreBase(${explanation.runnerUpScoreBase}) !== runnerUpScore(${explanation.runnerUpScore}) - focusBoost(${explanation.focusBoost})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GGGGGGG-3: runnerUpScoreBase equals runnerUpScore when runner-up is out-of-focus', async () => {
  // neon is out-of-focus under finance (code category)
  const agg = buildAgg(
    'g3',
    [STRIPE_CFG, NEON_CFG],
    { stripe: STRIPE_TOOLS, neon: NEON_TOOLS_BILLING },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(explanation.runnerUpInFocus === false, 'runner-up is out-of-focus');
    assert.ok(
      Math.abs(explanation.runnerUpScoreBase - explanation.runnerUpScore) < 1e-9,
      `runnerUpScoreBase(${explanation.runnerUpScoreBase}) !== runnerUpScore(${explanation.runnerUpScore}) for out-of-focus runner-up`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GGGGGGG-4: runnerUpScoreBase absent when only 1 candidate (no runner-up)', async () => {
  const agg = buildAgg(
    'g4',
    [STRIPE_CFG],
    { stripe: STRIPE_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('runnerUpScoreBase' in explanation), 'runnerUpScoreBase should be absent with only 1 candidate');
  } finally {
    await agg.shutdown();
  }
});

test('GGGGGGG-5: runnerUpScoreBase absent when no focus active', async () => {
  const agg = buildAgg(
    'g5',
    [STRIPE_CFG, NEON_CFG],
    { stripe: STRIPE_TOOLS, neon: NEON_TOOLS_BILLING },
    { profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('runnerUpScoreBase' in explanation), 'runnerUpScoreBase should be absent without active focus');
  } finally {
    await agg.shutdown();
  }
});

test('GGGGGGG-6: runnerUpScoreBase is a number', async () => {
  const agg = buildAgg(
    'g6',
    [STRIPE_CFG, NEON_CFG],
    { stripe: STRIPE_TOOLS, neon: NEON_TOOLS_BILLING },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(typeof explanation.runnerUpScoreBase, 'number', 'runnerUpScoreBase is a number');
  } finally {
    await agg.shutdown();
  }
});

test('GGGGGGG-7: identity runnerUpScoreBase + runnerUpFocusBoost === runnerUpScore', async () => {
  // Test with in-focus runner-up (tasks) to verify identity holds when boost is applied
  const agg = buildAgg(
    'g7',
    [STRIPE_CFG, TASKS_CFG],
    { stripe: STRIPE_TOOLS, tasks: TASKS_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    const sum = explanation.runnerUpScoreBase + explanation.runnerUpFocusBoost;
    assert.ok(
      Math.abs(sum - explanation.runnerUpScore) < 1e-9,
      `identity failed: runnerUpScoreBase(${explanation.runnerUpScoreBase}) + runnerUpFocusBoost(${explanation.runnerUpFocusBoost}) = ${sum} !== runnerUpScore(${explanation.runnerUpScore})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GGGGGGG-8: tool description documents runnerUpScoreBase', async () => {
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
      `cast description should mention runnerUpScoreBase; excerpt: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
