/**
 * KKKKKK: explanation.outOfFocusMeanScore in ch1tty/cast when explain:true.
 *
 * outOfFocusMeanScore: number — arithmetic mean relevance score of all
 * out-of-focus candidates.
 *
 * Present when: focus active + winner exists + >= 1 out-of-focus candidate
 *               (same conditions as topOutOfFocusScore).
 * Absent when: no focus active, cast:no_match, or all candidates in-focus.
 * Identity: outOfFocusMeanScore <= topOutOfFocusScore.
 * Symmetric to inFocusMeanScore.
 *
 * Covered:
 *   KKKKKK-1: present when focus active + winner exists + out-of-focus candidates exist
 *   KKKKKK-2: is a number >= 0 when present
 *   KKKKKK-3: <= topOutOfFocusScore (mean is at most the top score)
 *   KKKKKK-4: === topOutOfFocusScore when only one out-of-focus candidate
 *   KKKKKK-5: absent on cast:no_match
 *   KKKKKK-6: absent when no focus active
 *   KKKKKK-7: absent when all candidates are in-focus (no out-of-focus pool)
 *   KKKKKK-8: tool description documents outOfFocusMeanScore
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

// All focus: both categories in-focus → no out-of-focus candidates
const ALL_PROFILES: FocusProfiles = {
  profiles: {
    all: { description: 'All tools', categories: ['ecosystem', 'code'], servers: [], boost: 0.5 },
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
const NEON_TOOLS_BILLING: ToolEntry[] = [
  { name: 'run_sql', description: 'Run SQL billing invoice queries on the Neon database for financial analytics', inputSchema: { type: 'object', properties: {} } },
];
const TASKS_TOOLS: ToolEntry[] = [
  { name: 'create_billing_task', description: 'Create billing task for pending invoice payment processing', inputSchema: { type: 'object', properties: {} } },
];

test('KKKKKK-1: present when focus active + winner exists + out-of-focus candidates exist', async () => {
  // Finance focus: neon (code) is out-of-focus
  const agg = buildAgg('j1', [STRIPE_CFG, NEON_CFG], { stripe: STRIPE_TOOLS, neon: NEON_TOOLS_BILLING },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('focus' in explanation, 'focus should be active');
    assert.ok('topOutOfFocusScore' in explanation, 'topOutOfFocusScore should be present (out-of-focus candidates exist)');
    assert.ok('outOfFocusMeanScore' in explanation,
      `outOfFocusMeanScore should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.outOfFocusMeanScore, 'number', 'outOfFocusMeanScore should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKK-2: outOfFocusMeanScore >= 0 when present', async () => {
  const agg = buildAgg('j2', [STRIPE_CFG, NEON_CFG], { stripe: STRIPE_TOOLS, neon: NEON_TOOLS_BILLING },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('outOfFocusMeanScore' in explanation, 'outOfFocusMeanScore should be present');
    assert.ok(
      explanation.outOfFocusMeanScore >= 0,
      `outOfFocusMeanScore should be >= 0, got ${explanation.outOfFocusMeanScore}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKK-3: outOfFocusMeanScore <= topOutOfFocusScore', async () => {
  const agg = buildAgg('j3', [STRIPE_CFG, NEON_CFG], { stripe: STRIPE_TOOLS, neon: NEON_TOOLS_BILLING },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('outOfFocusMeanScore' in explanation, 'outOfFocusMeanScore should be present');
    assert.ok('topOutOfFocusScore' in explanation, 'topOutOfFocusScore should be present');
    assert.ok(
      explanation.outOfFocusMeanScore <= explanation.topOutOfFocusScore + 1e-9,
      `outOfFocusMeanScore (${explanation.outOfFocusMeanScore}) should be <= topOutOfFocusScore (${explanation.topOutOfFocusScore})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKK-4: outOfFocusMeanScore === topOutOfFocusScore when only one out-of-focus candidate', async () => {
  // Only one out-of-focus candidate (neon) → mean equals top
  const agg = buildAgg('j4', [STRIPE_CFG, NEON_CFG], { stripe: STRIPE_TOOLS, neon: NEON_TOOLS_BILLING },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('outOfFocusMeanScore' in explanation, 'outOfFocusMeanScore should be present');
    // With only 1 out-of-focus tool, mean === top
    assert.equal(explanation.outOfFocusCandidatesCount, 1,
      `expected 1 out-of-focus candidate, got ${explanation.outOfFocusCandidatesCount}`);
    assert.ok(
      Math.abs(explanation.outOfFocusMeanScore - explanation.topOutOfFocusScore) < 1e-9,
      `outOfFocusMeanScore (${explanation.outOfFocusMeanScore}) should equal topOutOfFocusScore (${explanation.topOutOfFocusScore}) with single out-of-focus candidate`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKK-5: absent on cast:no_match', async () => {
  const path = dlqPath('j5');
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
      !('outOfFocusMeanScore' in parsed.explanation),
      `outOfFocusMeanScore should be absent on no_match, found: ${parsed.explanation.outOfFocusMeanScore}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('KKKKKK-6: absent when no focus active', async () => {
  const agg = buildAgg('j6', [STRIPE_CFG, NEON_CFG], { stripe: STRIPE_TOOLS, neon: NEON_TOOLS_BILLING }); // no focus
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok(
      !('outOfFocusMeanScore' in explanation),
      `outOfFocusMeanScore should be absent without focus, found: ${explanation.outOfFocusMeanScore}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKK-7: absent when all candidates are in-focus', async () => {
  // All focus: both stripe (ecosystem) and tasks (ecosystem) are in-focus → no out-of-focus candidates
  const agg = buildAgg('j7', [STRIPE_CFG, TASKS_CFG], { stripe: STRIPE_TOOLS, tasks: TASKS_TOOLS },
    { focus: 'all', profiles: ALL_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focus' in explanation, 'focus should be active');
    assert.equal(explanation.outOfFocusCandidatesCount, 0, 'should have 0 out-of-focus candidates');
    assert.ok(
      !('outOfFocusMeanScore' in explanation),
      `outOfFocusMeanScore should be absent when all candidates are in-focus, found: ${explanation.outOfFocusMeanScore}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKK-8: tool description documents outOfFocusMeanScore', async () => {
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
      cast.description?.includes('outOfFocusMeanScore'),
      `cast description should mention outOfFocusMeanScore, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
