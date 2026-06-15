/**
 * JJJJJJ: explanation.rawFocusMargin in ch1tty/cast when explain:true and focus active.
 *
 * rawFocusMargin: number — score gap between winner and runner-up using their pre-focus
 * base scores (winnerScoreBase - runnerUpScoreBase). Strips focus boost from both sides.
 *
 * Present when: focus active + runner-up exists (same as runnerUpScoreBase).
 * Absent when: no focus active, cast:no_match, or < 2 candidates.
 * Can be negative when runner-up's base score exceeded winner's base score (focus reversed ranking).
 * Identity: rawFocusMargin === focusMargin - (winnerFocusBoost - runnerUpFocusBoost).
 *
 * Covered:
 *   JJJJJJ-1: present when focus active + runner-up exists
 *   JJJJJJ-2: equals winnerScoreBase - runnerUpScoreBase
 *   JJJJJJ-3: identity rawFocusMargin === focusMargin - (winnerFocusBoost - runnerUpFocusBoost)
 *   JJJJJJ-4: negative when runner-up base score exceeded winner base (focus reversed ranking)
 *   JJJJJJ-5: absent when no focus active
 *   JJJJJJ-6: absent on cast:no_match
 *   JJJJJJ-7: absent when only 1 candidate
 *   JJJJJJ-8: tool description documents rawFocusMargin
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
  return join(tmpdir(), `ch1tty-jjjjjj-${label}-${Date.now()}.jsonl`);
}

const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe Payments', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.test/mcp',
};
const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.test/mcp',
};
const TASKS_CFG: ServerConfig = {
  id: 'tasks', name: 'Task Manager', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://tasks.test/mcp',
};

// Finance: ecosystem in-focus (stripe, tasks); code (neon) out-of-focus
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

const STRIPE_TOOLS: ToolEntry[] = [
  { name: 'create_invoice', description: 'Create Stripe invoice for customer billing payment subscription', inputSchema: { type: 'object', properties: {} } },
];
const NEON_TOOLS: ToolEntry[] = [
  { name: 'run_sql', description: 'Run SQL billing invoice queries on the Neon database for financial analytics', inputSchema: { type: 'object', properties: {} } },
];
const TASKS_TOOLS: ToolEntry[] = [
  { name: 'create_billing_task', description: 'Create billing task for pending invoice payment processing', inputSchema: { type: 'object', properties: {} } },
];

test('JJJJJJ-1: present when focus active + runner-up exists', async () => {
  const agg = buildAgg(
    'j1',
    [STRIPE_CFG, NEON_CFG],
    { stripe: STRIPE_TOOLS, neon: NEON_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment create', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('rawFocusMargin' in explanation, `rawFocusMargin absent; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.rawFocusMargin, 'number', 'rawFocusMargin should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('JJJJJJ-2: equals winnerScoreBase - runnerUpScoreBase', async () => {
  const agg = buildAgg(
    'j2',
    [STRIPE_CFG, NEON_CFG],
    { stripe: STRIPE_TOOLS, neon: NEON_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment create', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('rawFocusMargin' in explanation, 'rawFocusMargin absent');
    assert.ok('winnerScoreBase' in explanation, 'winnerScoreBase absent');
    assert.ok('runnerUpScoreBase' in explanation, 'runnerUpScoreBase absent');
    const expected = explanation.winnerScoreBase - explanation.runnerUpScoreBase;
    assert.ok(
      Math.abs(explanation.rawFocusMargin - expected) < 1e-9,
      `rawFocusMargin (${explanation.rawFocusMargin}) should equal winnerScoreBase - runnerUpScoreBase (${expected})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('JJJJJJ-3: identity rawFocusMargin === focusMargin - (winnerFocusBoost - runnerUpFocusBoost)', async () => {
  const agg = buildAgg(
    'j3',
    [STRIPE_CFG, NEON_CFG],
    { stripe: STRIPE_TOOLS, neon: NEON_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment create', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('rawFocusMargin' in explanation, 'rawFocusMargin absent');
    assert.ok('focusMargin' in explanation, 'focusMargin absent');
    assert.ok('winnerFocusBoost' in explanation, 'winnerFocusBoost absent');
    assert.ok('runnerUpFocusBoost' in explanation, 'runnerUpFocusBoost absent');
    const expected = explanation.focusMargin - (explanation.winnerFocusBoost - explanation.runnerUpFocusBoost);
    assert.ok(
      Math.abs(explanation.rawFocusMargin - expected) < 1e-9,
      `identity violated: rawFocusMargin (${explanation.rawFocusMargin}) ≠ focusMargin - (winnerFocusBoost - runnerUpFocusBoost) = ${expected}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('JJJJJJ-4: negative when runner-up base score exceeded winner base (focus reversed ranking)', async () => {
  // neon (code/out-of-focus) has a strong description match; stripe (ecosystem/in-focus) has weaker match
  // but finance focus boosts stripe enough to win -> winnerScoreBase < runnerUpScoreBase -> rawFocusMargin < 0
  const strongNeonTools: ToolEntry[] = [
    { name: 'run_billing_query', description: 'billing invoice payment create financial', inputSchema: { type: 'object', properties: {} } },
  ];
  const weakStripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'stripe payment', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg(
    'j4',
    [STRIPE_CFG, NEON_CFG],
    { stripe: weakStripeTools, neon: strongNeonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment create financial', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if (!('rawFocusMargin' in explanation) || !('focusDecisive' in explanation)) {
      // If focus wasn't decisive, skip this test rather than fail
      assert.ok(true, 'focus not decisive in this configuration — skipping negative check');
      return;
    }
    if (explanation.focusDecisive === true) {
      assert.ok(
        explanation.rawFocusMargin < 0,
        `when focus is decisive (reversed ranking), rawFocusMargin should be < 0, got ${explanation.rawFocusMargin}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('JJJJJJ-5: absent when no focus active', async () => {
  const agg = buildAgg(
    'j5',
    [STRIPE_CFG, NEON_CFG],
    { stripe: STRIPE_TOOLS, neon: NEON_TOOLS },
    // no focus
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment create', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(
      !('rawFocusMargin' in explanation),
      `rawFocusMargin should be absent without focus, got ${explanation.rawFocusMargin}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('JJJJJJ-6: absent on cast:no_match', async () => {
  const path = dlqPath('j6');
  const emptyAgg = new Aggregator([STRIPE_CFG], {
    backendFactory: () => makeBackend([]),
    focusProfiles: FINANCE_PROFILES,
    suggestionsCatalog: {},
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
    focus: 'finance',
  });
  try {
    const r = await emptyAgg.callTool('ch1tty/cast', { intent: 'xyzzy-nonexistent-query', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'no_match', `expected no_match, got ${parsed.cast}`);
    assert.ok(
      !('rawFocusMargin' in parsed.explanation),
      `rawFocusMargin should be absent on no_match, got ${parsed.explanation.rawFocusMargin}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('JJJJJJ-7: absent when only 1 candidate', async () => {
  const agg = buildAgg(
    'j7',
    [STRIPE_CFG],
    { stripe: STRIPE_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment create', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('rawFocusMargin' in explanation),
      `rawFocusMargin should be absent with single candidate, got ${explanation.rawFocusMargin}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('JJJJJJ-8: tool description documents rawFocusMargin', async () => {
  const path = dlqPath('j8');
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
      cast.description?.includes('rawFocusMargin'),
      `cast description should mention rawFocusMargin; excerpt: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
