/**
 * MMMMMM: explanation.inFocusBottomScore in ch1tty/cast when explain:true.
 *
 * inFocusBottomScore: number — lowest relevance score among all
 * in-focus candidates.
 *
 * Present when: focus active + winner exists + >= 1 in-focus candidate
 *               (same conditions as inFocusTopScore and inFocusMeanScore).
 * Absent when: no focus active, cast:no_match, or all candidates out-of-focus.
 * Identity: inFocusBottomScore <= inFocusMeanScore <= inFocusTopScore.
 * Symmetric bottom complement to inFocusTopScore.
 *
 * Covered:
 *   MMMMMM-1: present when focus active + winner exists + in-focus candidates exist
 *   MMMMMM-2: is a number >= 0 when present
 *   MMMMMM-3: <= inFocusMeanScore <= inFocusTopScore (ordering chain)
 *   MMMMMM-4: === inFocusTopScore when only one in-focus candidate
 *   MMMMMM-5: absent on cast:no_match
 *   MMMMMM-6: absent when no focus active
 *   MMMMMM-7: absent when all candidates are out-of-focus (no in-focus pool)
 *   MMMMMM-8: tool description documents inFocusBottomScore
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
  return join(tmpdir(), `ch1tty-mmmmmm-${label}-${Date.now()}.jsonl`);
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

// Finance: ecosystem in-focus, code out-of-focus
const FINANCE_PROFILES: FocusProfiles = {
  profiles: {
    finance: { description: 'Financial tools', categories: ['ecosystem'], servers: ['stripe', 'tasks'], boost: 0.5 },
  },
};

// Code only focus: code in-focus, ecosystem out-of-focus
const CODE_PROFILES: FocusProfiles = {
  profiles: {
    code: { description: 'Code tools', categories: ['code'], servers: [], boost: 0.5 },
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
const TASKS_TOOLS: ToolEntry[] = [
  { name: 'create_billing_task', description: 'Create billing task for pending invoice payment processing', inputSchema: { type: 'object', properties: {} } },
];
const NEON_TOOLS_BILLING: ToolEntry[] = [
  { name: 'run_sql', description: 'Run SQL billing invoice queries on the Neon database for financial analytics', inputSchema: { type: 'object', properties: {} } },
];

test('MMMMMM-1: present when focus active + winner exists + in-focus candidates exist', async () => {
  // Finance focus: stripe + tasks (ecosystem) are in-focus
  const agg = buildAgg('m1', [STRIPE_CFG, TASKS_CFG], { stripe: STRIPE_TOOLS, tasks: TASKS_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('focus' in explanation, 'focus should be active');
    assert.ok('inFocusTopScore' in explanation, 'inFocusTopScore should be present');
    assert.ok('inFocusBottomScore' in explanation,
      `inFocusBottomScore should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.inFocusBottomScore, 'number', 'inFocusBottomScore should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('MMMMMM-2: inFocusBottomScore >= 0 when present', async () => {
  const agg = buildAgg('m2', [STRIPE_CFG, TASKS_CFG], { stripe: STRIPE_TOOLS, tasks: TASKS_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('inFocusBottomScore' in explanation, 'inFocusBottomScore should be present');
    assert.ok(
      explanation.inFocusBottomScore >= 0,
      `inFocusBottomScore should be >= 0, got ${explanation.inFocusBottomScore}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('MMMMMM-3: inFocusBottomScore <= inFocusMeanScore <= inFocusTopScore', async () => {
  const agg = buildAgg('m3', [STRIPE_CFG, TASKS_CFG], { stripe: STRIPE_TOOLS, tasks: TASKS_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('inFocusBottomScore' in explanation, 'inFocusBottomScore should be present');
    assert.ok('inFocusMeanScore' in explanation, 'inFocusMeanScore should be present');
    assert.ok('inFocusTopScore' in explanation, 'inFocusTopScore should be present');
    assert.ok(
      explanation.inFocusBottomScore <= explanation.inFocusMeanScore + 1e-9,
      `inFocusBottomScore (${explanation.inFocusBottomScore}) should be <= inFocusMeanScore (${explanation.inFocusMeanScore})`,
    );
    assert.ok(
      explanation.inFocusMeanScore <= explanation.inFocusTopScore + 1e-9,
      `inFocusMeanScore (${explanation.inFocusMeanScore}) should be <= inFocusTopScore (${explanation.inFocusTopScore})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('MMMMMM-4: inFocusBottomScore === inFocusTopScore when only one in-focus candidate', async () => {
  // Only stripe (ecosystem) is in-focus → single in-focus candidate → bottom === top
  const agg = buildAgg('m4', [STRIPE_CFG, NEON_CFG], { stripe: STRIPE_TOOLS, neon: NEON_TOOLS_BILLING },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('inFocusBottomScore' in explanation, 'inFocusBottomScore should be present');
    assert.equal(explanation.candidatesInFocusCount, 1,
      `expected 1 in-focus candidate, got ${explanation.candidatesInFocusCount}`);
    assert.ok(
      Math.abs(explanation.inFocusBottomScore - explanation.inFocusTopScore) < 1e-9,
      `inFocusBottomScore (${explanation.inFocusBottomScore}) should equal inFocusTopScore (${explanation.inFocusTopScore}) with single in-focus candidate`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('MMMMMM-5: absent on cast:no_match', async () => {
  const path = dlqPath('m5');
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
      !('inFocusBottomScore' in parsed.explanation),
      `inFocusBottomScore should be absent on no_match, found: ${parsed.explanation.inFocusBottomScore}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('MMMMMM-6: absent when no focus active', async () => {
  const agg = buildAgg('m6', [STRIPE_CFG, TASKS_CFG], { stripe: STRIPE_TOOLS, tasks: TASKS_TOOLS }); // no focus
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok(
      !('inFocusBottomScore' in explanation),
      `inFocusBottomScore should be absent without focus, found: ${explanation.inFocusBottomScore}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('MMMMMM-7: absent when all candidates are out-of-focus', async () => {
  // Code focus: neon (code) is in-focus; stripe (ecosystem) is out-of-focus. But with only stripe, no in-focus candidates.
  const agg = buildAgg('m7', [STRIPE_CFG], { stripe: STRIPE_TOOLS },
    { focus: 'code', profiles: CODE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focus' in explanation, 'focus should be active');
    assert.equal(explanation.candidatesInFocusCount, 0, 'should have 0 in-focus candidates');
    assert.ok(
      !('inFocusBottomScore' in explanation),
      `inFocusBottomScore should be absent when all candidates are out-of-focus, found: ${explanation.inFocusBottomScore}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('MMMMMM-8: tool description documents inFocusBottomScore', async () => {
  const path = dlqPath('m8');
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
      cast.description?.includes('inFocusBottomScore'),
      `cast description should mention inFocusBottomScore, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
