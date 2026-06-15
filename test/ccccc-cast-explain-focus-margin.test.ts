/**
 * CCCCC: explanation.focusMargin in ch1tty/cast when explain:true and focus active.
 *
 * focusMargin: number — the raw score gap between winner and runner-up in the
 * focus-biased scoring space (winnerScore - runnerUpScore). Present when a focus
 * profile is active and there is at least one runner-up. Absent when no focus
 * is active, on no_match, or when there is only one candidate.
 *
 * Covered:
 *   CCCCC-1: focus active + runner-up → focusMargin is a number ≥ 0
 *   CCCCC-2: focusMargin === winnerScore - runnerUpScore (consistency)
 *   CCCCC-3: no focus active → focusMargin absent
 *   CCCCC-4: cast:no_match → focusMargin absent (no winner)
 *   CCCCC-5: single candidate only → focusMargin absent (no runner-up)
 *   CCCCC-6: cast:plan (confirm:true) + focus + runner-up → focusMargin present
 *   CCCCC-7: focusMargin co-present with focusDecisive under same conditions
 *   CCCCC-8: tool description documents focusMargin
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
  return join(tmpdir(), `ch1tty-ccccc-${label}-${Date.now()}.jsonl`);
}

const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe Payments', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.test/mcp',
};
const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.test/mcp',
};

const FINANCE_PROFILES: FocusProfiles = {
  profiles: {
    finance: { description: 'Financial tools', categories: ['ecosystem'], servers: ['stripe'], boost: 0.5 },
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

test('CCCCC-1: focus active + runner-up → focusMargin is a number ≥ 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg(
    'c1',
    [STRIPE_CFG, NEON_CFG],
    { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('focusMargin' in explanation, 'focusMargin should be present when focus active + runner-up exists');
    assert.equal(typeof explanation.focusMargin, 'number', 'focusMargin should be a number');
    assert.ok(explanation.focusMargin >= 0, `focusMargin should be ≥ 0 (winner always ≥ runner-up), got ${explanation.focusMargin}`);
  } finally {
    await agg.shutdown();
  }
});

test('CCCCC-2: focusMargin === winnerScore - runnerUpScore (consistency)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg(
    'c2',
    [STRIPE_CFG, NEON_CFG],
    { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focusMargin' in explanation, 'focusMargin absent — cannot verify consistency');
    const expected = explanation.winnerScore - explanation.runnerUpScore;
    assert.ok(
      Math.abs(explanation.focusMargin - expected) < 1e-9,
      `focusMargin (${explanation.focusMargin}) should equal winnerScore - runnerUpScore (${expected})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('CCCCC-3: no focus active → focusMargin absent', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg(
    'c3',
    [STRIPE_CFG, NEON_CFG],
    { stripe: stripeTools, neon: neonTools },
    // no focus
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(
      !('focusMargin' in explanation),
      `focusMargin should be absent when no focus active, got ${explanation.focusMargin}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('CCCCC-4: cast:no_match → focusMargin absent (no winner)', async () => {
  const path = dlqPath('c4');
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
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(
      !('focusMargin' in explanation),
      `focusMargin should be absent on no_match, got ${explanation.focusMargin}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('CCCCC-5: single candidate only → focusMargin absent (no runner-up)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment', inputSchema: { type: 'object', properties: {} } },
  ];
  const path = dlqPath('c5');
  const agg = new Aggregator([STRIPE_CFG], {
    backendFactory: () => makeBackend(stripeTools),
    focusProfiles: FINANCE_PROFILES,
    suggestionsCatalog: {},
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
    focus: 'finance',
  });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(
      !('focusMargin' in explanation),
      `focusMargin should be absent when only one candidate (no runner-up), got ${explanation.focusMargin}`,
    );
    assert.ok(
      !('runnerUpScore' in explanation),
      `runnerUpScore should also be absent with one candidate, got ${explanation.runnerUpScore}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('CCCCC-6: cast:plan (confirm:true) + focus + runner-up → focusMargin present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg(
    'c6',
    [STRIPE_CFG, NEON_CFG],
    { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing', confirm: true, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'plan', `expected plan, got ${parsed.cast}`);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('focusMargin' in explanation, 'focusMargin should be present on cast:plan when focus active + runner-up exists');
    assert.equal(typeof explanation.focusMargin, 'number', 'focusMargin should be a number');
    assert.ok(explanation.focusMargin >= 0, `focusMargin should be ≥ 0, got ${explanation.focusMargin}`);
  } finally {
    await agg.shutdown();
  }
});

test('CCCCC-7: focusMargin co-present with focusDecisive under same conditions', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg(
    'c7',
    [STRIPE_CFG, NEON_CFG],
    { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    const hasMargin = 'focusMargin' in explanation;
    const hasDecisive = 'focusDecisive' in explanation;
    assert.equal(
      hasMargin,
      hasDecisive,
      `focusMargin (${hasMargin}) and focusDecisive (${hasDecisive}) should be present/absent together`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('CCCCC-8: tool description documents focusMargin', async () => {
  const path = dlqPath('c8');
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
      cast.description?.includes('focusMargin'),
      `cast description should mention focusMargin, got: ${cast.description?.slice(0, 500)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
