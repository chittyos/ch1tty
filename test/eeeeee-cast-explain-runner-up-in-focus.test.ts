/**
 * EEEEEE: explanation.runnerUpInFocus in ch1tty/cast when explain:true.
 *
 * runnerUpInFocus: boolean — whether the runner-up tool is within the active
 * focus profile (server or category match).
 *
 * Present when: focus active + runner-up exists (same conditions as focusDecisive).
 * Absent when: no focus active, cast:no_match, or only one candidate.
 *
 * Covered:
 *   EEEEEE-1: runnerUpInFocus present when focus active + runner-up exists
 *   EEEEEE-2: runnerUpInFocus is a boolean
 *   EEEEEE-3: runnerUpInFocus === true when runner-up's server is in focus
 *   EEEEEE-4: runnerUpInFocus === false when runner-up's server is out of focus
 *   EEEEEE-5: runnerUpInFocus absent on cast:no_match
 *   EEEEEE-6: runnerUpInFocus absent when no focus active
 *   EEEEEE-7: runnerUpInFocus absent when only one candidate
 *   EEEEEE-8: tool description documents runnerUpInFocus
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
  return join(tmpdir(), `ch1tty-eeeeee-${label}-${Date.now()}.jsonl`);
}

const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe Payments', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.test/mcp',
};
const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.test/mcp',
};

// Finance focus: only stripe (ecosystem) is in-focus; neon (code) is out
const FINANCE_PROFILES: FocusProfiles = {
  profiles: {
    finance: { description: 'Financial tools', categories: ['ecosystem'], servers: ['stripe'], boost: 0.5 },
  },
};

// All focus: both categories in-focus
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

test('EEEEEE-1: runnerUpInFocus present when focus active + runner-up exists', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('e1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('focus' in explanation, 'focus should be active');
    assert.ok('runnerUpScore' in explanation, 'runnerUpScore should be present (runner-up exists)');
    assert.ok('runnerUpInFocus' in explanation,
      `runnerUpInFocus should be present when focus active + runner-up; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('EEEEEE-2: runnerUpInFocus is a boolean', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('e2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('runnerUpInFocus' in explanation, 'runnerUpInFocus should be present');
    assert.equal(typeof explanation.runnerUpInFocus, 'boolean', 'runnerUpInFocus should be a boolean');
  } finally {
    await agg.shutdown();
  }
});

test('EEEEEE-3: runnerUpInFocus === true when runner-up server is in focus', async () => {
  // All focus: both stripe and neon in-focus — both winner and runner-up should be in-focus
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('e3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'all', profiles: ALL_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('runnerUpInFocus' in explanation, 'runnerUpInFocus should be present');
    assert.equal(
      explanation.runnerUpInFocus, true,
      `runnerUpInFocus should be true when runner-up (${explanation.runnerUpServer}) is in all-focus profile, got ${explanation.runnerUpInFocus}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('EEEEEE-4: runnerUpInFocus === false when runner-up server is out of focus', async () => {
  // Finance focus: stripe (ecosystem) is in, neon (code) is out
  // With strong billing-oriented intent, stripe should win and neon be runner-up (out-of-focus)
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('e4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('runnerUpInFocus' in explanation, 'runnerUpInFocus should be present');
    // neon is the runner-up (out-of-focus under finance profile)
    assert.equal(explanation.runnerUpServer, 'neon', `expected neon as runner-up, got ${explanation.runnerUpServer}`);
    assert.equal(
      explanation.runnerUpInFocus, false,
      `runnerUpInFocus should be false for neon (code/out-of-focus under finance), got ${explanation.runnerUpInFocus}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('EEEEEE-5: runnerUpInFocus absent on cast:no_match', async () => {
  const path = dlqPath('e5');
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
    assert.ok(
      !('runnerUpInFocus' in parsed.explanation),
      `runnerUpInFocus should be absent on no_match, found: ${parsed.explanation.runnerUpInFocus}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('EEEEEE-6: runnerUpInFocus absent when no focus active', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('e6', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools }); // no focus
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok(
      !('runnerUpInFocus' in explanation),
      `runnerUpInFocus should be absent without focus, found: ${explanation.runnerUpInFocus}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('EEEEEE-7: runnerUpInFocus absent when only one candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('e7', [STRIPE_CFG], { stripe: stripeTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok('focus' in explanation, 'focus should be active');
    assert.ok(
      !('runnerUpInFocus' in explanation),
      `runnerUpInFocus should be absent with single candidate, found: ${explanation.runnerUpInFocus}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('EEEEEE-8: tool description documents runnerUpInFocus', async () => {
  const path = dlqPath('e8');
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
      `cast description should mention runnerUpInFocus, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
