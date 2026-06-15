/**
 * KKKKK: explanation.focusRankDelta in ch1tty/cast when explain:true and focus is active.
 *
 * focusRankDelta: number — the number of positions focus moved the winning tool up
 * in the pre-focus ranking (focusRank - 1). A value of 0 means focus did not change
 * the winner's rank; a value of 1 means focus promoted the winner from 2nd to 1st; etc.
 *
 * Present when: focus profile active + winner exists (same as focusRank).
 * Absent when: no focus active, or no_match (no winner).
 *
 * Covered:
 *   KKKKK-1: focusRankDelta === 0 when winner already led pre-focus (no displacement)
 *   KKKKK-2: focusRankDelta === 1 when focus promoted winner from 2nd to 1st
 *   KKKKK-3: absent on cast:no_match (no winner)
 *   KKKKK-4: absent when no focus profile is active
 *   KKKKK-5: focusRankDelta is always a non-negative integer (>= 0)
 *   KKKKK-6: focusRankDelta === focusRank - 1 (mathematical consistency)
 *   KKKKK-7: focusRankDelta === 0 for out-of-focus winner (already led pre-focus)
 *   KKKKK-8: tool description documents focusRankDelta
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
  return join(tmpdir(), `ch1tty-kkkkk-${label}-${Date.now()}.jsonl`);
}

const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe Payments', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.test/mcp',
};
const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.test/mcp',
};

// Finance profile: stripe (ecosystem) is in-focus; neon is out-of-focus
const FINANCE_PROFILES: FocusProfiles = {
  profiles: {
    finance: { description: 'Financial tools', categories: ['ecosystem'], servers: ['stripe'], boost: 0.5 },
  },
};

// Code profile: neon (code) is in-focus; stripe is out-of-focus
const CODE_PROFILES: FocusProfiles = {
  profiles: {
    code: { description: 'Code tools', categories: ['code'], servers: ['neon'], boost: 0.5 },
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

test('KKKKK-1: focusRankDelta === 0 when winner already led pre-focus', async () => {
  // stripe/create_invoice matches all 4 intent terms (raw 1.0); neon/run_sql matches 0 terms (raw 0).
  // finance focus boosts stripe, but stripe was already #1 pre-focus → focusRank===1 → focusRankDelta===0.
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'sql database query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('focusRankDelta' in explanation, 'focusRankDelta should be present when focus active and winner exists');
    assert.equal(explanation.focusRankDelta, 0, `expected focusRankDelta 0 (no displacement), got ${explanation.focusRankDelta}`);
  } finally {
    await agg.shutdown();
  }
});

test('KKKKK-2: focusRankDelta === 1 when focus promoted winner from 2nd to 1st', async () => {
  // neon/run_sql: matches 3/4 intent terms "sql database schema" → raw score 0.75
  // stripe/create_invoice: matches 4/4 terms "sql database schema query" → raw score 1.0
  // code focus boost 0.5: neon=1.25, stripe=1.0 → neon wins. Pre-focus: stripe (1.0) led, neon (0.75) was 2nd.
  // neon's focusRank=2 → focusRankDelta=1 (promoted by exactly 1 position).
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'sql database schema', inputSchema: { type: 'object', properties: {} } },
  ];
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'sql database schema query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k2', [NEON_CFG, STRIPE_CFG], { neon: neonTools, stripe: stripeTools },
    { focus: 'code', profiles: CODE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'sql database schema query', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.equal(explanation.winnerServer, 'neon', `expected neon to win with code focus, got "${explanation.winnerServer}"`);
    assert.ok('focusRankDelta' in explanation, 'focusRankDelta should be present with active focus and a winner');
    assert.ok(explanation.focusRankDelta >= 1, `expected focusRankDelta >= 1 (neon was promoted by focus), got ${explanation.focusRankDelta}`);
  } finally {
    await agg.shutdown();
  }
});

test('KKKKK-3: cast:no_match → focusRankDelta absent', async () => {
  const path = dlqPath('k3');
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
      !('focusRankDelta' in parsed.explanation),
      `focusRankDelta should be absent on no_match, got ${parsed.explanation.focusRankDelta}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('KKKKK-4: no focus active → focusRankDelta absent', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools }); // no focus
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'focus key should be absent when no focus active');
    assert.ok(
      !('focusRankDelta' in explanation),
      `focusRankDelta should be absent when no focus active, got ${explanation.focusRankDelta}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('KKKKK-5: focusRankDelta is always a non-negative integer (>= 0)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k5', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focusRankDelta' in explanation, 'focusRankDelta should be present with active focus');
    assert.equal(typeof explanation.focusRankDelta, 'number', 'focusRankDelta should be a number');
    assert.ok(Number.isInteger(explanation.focusRankDelta), 'focusRankDelta should be an integer');
    assert.ok(explanation.focusRankDelta >= 0, `focusRankDelta should be >= 0, got ${explanation.focusRankDelta}`);
  } finally {
    await agg.shutdown();
  }
});

test('KKKKK-6: focusRankDelta === focusRank - 1 (mathematical consistency)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge fee refund', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k6', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge fee refund', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focusRank' in explanation, 'focusRank should be present with active focus');
    assert.ok('focusRankDelta' in explanation, 'focusRankDelta should be present with active focus');
    assert.equal(
      explanation.focusRankDelta,
      explanation.focusRank - 1,
      `focusRankDelta (${explanation.focusRankDelta}) should equal focusRank - 1 (${explanation.focusRank - 1})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('KKKKK-7: out-of-focus winner → focusRankDelta === 0 (already led pre-focus)', async () => {
  // code focus → neon in-focus; stripe dominates intent → stripe wins despite no boost.
  // stripe (out-of-focus) led pre-focus too → focusRank===1 → focusRankDelta===0.
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'invoice payment charge stripe fee refund transaction', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'code', profiles: CODE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'invoice payment charge stripe fee refund transaction', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    // stripe: 7/7 intent terms = 1.0; neon: 0/7 terms + code boost = 0.5 → stripe always wins
    assert.equal(explanation.winnerServer, 'stripe', `expected stripe to win (dominates intent), got "${explanation.winnerServer}"`);
    assert.equal(explanation.winnerInFocus, false, 'stripe should be out-of-focus under code profile');
    assert.ok('focusRankDelta' in explanation, 'focusRankDelta should be present with active focus');
    assert.equal(explanation.focusRankDelta, 0, `out-of-focus winner led pre-focus → focusRankDelta===0, got ${explanation.focusRankDelta}`);
  } finally {
    await agg.shutdown();
  }
});

test('KKKKK-8: tool description documents focusRankDelta', async () => {
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
      cast.description?.includes('focusRankDelta'),
      `cast description should mention focusRankDelta, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
