/**
 * KKKKK: explanation.focusRankDelta in ch1tty/cast when explain:true and focus is active.
 *
 * focusRankDelta: number — the number of positions the active focus boost promoted the winning
 * tool in the pre-focus ranking (focusRank - 1).
 *
 * Present when: focus profile active + winner exists (same conditions as focusRank).
 * Absent when: no focus active, or no_match (no winner).
 *
 * Value: 0 = winner was already top candidate pre-focus (no promotion occurred).
 *        1 = focus promoted winner from 2nd to 1st.
 *        N = focus promoted winner N positions up.
 *
 * Covered:
 *   KKKKK-1: focusRankDelta === 0 when winner was already #1 pre-focus (focusRank === 1)
 *   KKKKK-2: focusRankDelta >= 1 when focus promoted winner from behind (focusRank >= 2)
 *   KKKKK-3: absent on cast:no_match (no winner)
 *   KKKKK-4: absent when no focus profile is active
 *   KKKKK-5: always a non-negative integer (>= 0) when present
 *   KKKKK-6: focusRankDelta === focusRank - 1 (consistency invariant)
 *   KKKKK-7: out-of-focus winner → focusRankDelta === 0 (no boost applied, winner led pre-focus)
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

test('KKKKK-1: focusRankDelta === 0 when winner was already #1 pre-focus (focusRank === 1)', async () => {
  // stripe/create_invoice matches all 4 intent terms (score ~1.0); neon/run_sql matches ~0.25.
  // With finance focus, stripe gets +0.5 → still #1. Without boost stripe was already #1.
  // So focusRank === 1 → focusRankDelta === 0.
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
    assert.equal(explanation.focusRank, 1, `expected focusRank 1, got ${explanation.focusRank}`);
    assert.equal(explanation.focusRankDelta, 0, `expected focusRankDelta 0 when focusRank===1, got ${explanation.focusRankDelta}`);
  } finally {
    await agg.shutdown();
  }
});

test('KKKKK-2: focusRankDelta >= 1 when focus promoted winner from behind (focusRank >= 2)', async () => {
  // neon matches 3 intent terms (raw ~0.75); stripe matches 4 terms (raw ~1.0).
  // code focus gives neon +0.5 → boosted score ~1.25 > stripe ~1.0 → neon wins.
  // Without boost neon was #2 → focusRank === 2 → focusRankDelta === 1.
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
    assert.ok('focusRankDelta' in explanation, 'focusRankDelta should be present when focus active and winner exists');
    assert.equal(typeof explanation.focusRankDelta, 'number', 'focusRankDelta should be a number');
    // If focus was decisive (neon promoted from behind), delta >= 1
    if (explanation.winnerServer === 'neon' && explanation.winnerInFocus === true && explanation.focusRank >= 2) {
      assert.ok(explanation.focusRankDelta >= 1,
        `expected focusRankDelta >= 1 when focus promoted winner, got ${explanation.focusRankDelta}`);
    }
    // Invariant: delta === rank - 1 regardless of scenario
    assert.equal(explanation.focusRankDelta, explanation.focusRank - 1,
      `focusRankDelta must equal focusRank - 1: delta=${explanation.focusRankDelta} rank=${explanation.focusRank}`);
  } finally {
    await agg.shutdown();
  }
});

test('KKKKK-3: cast:no_match → focusRankDelta absent (no winner)', async () => {
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
  const agg = buildAgg('k4', [STRIPE_CFG], { stripe: stripeTools }); // no focus
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'focus should be absent when no focus active');
    assert.ok(
      !('focusRankDelta' in explanation),
      `focusRankDelta should be absent when no focus active, got ${explanation.focusRankDelta}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('KKKKK-5: focusRankDelta is always a non-negative integer (>= 0) when present', async () => {
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
    assert.ok('focusRankDelta' in explanation, 'focusRankDelta should be present with active focus and winner');
    assert.equal(typeof explanation.focusRankDelta, 'number', 'focusRankDelta should be a number');
    assert.ok(Number.isInteger(explanation.focusRankDelta), 'focusRankDelta should be an integer');
    assert.ok(explanation.focusRankDelta >= 0, `focusRankDelta should be >= 0, got ${explanation.focusRankDelta}`);
  } finally {
    await agg.shutdown();
  }
});

test('KKKKK-6: focusRankDelta === focusRank - 1 (consistency invariant)', async () => {
  // Verify the identity holds across both in-focus and out-of-focus winners.
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query data', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k6', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focusRank' in explanation, 'focusRank should be present');
    assert.ok('focusRankDelta' in explanation, 'focusRankDelta should be present');
    assert.equal(
      explanation.focusRankDelta,
      explanation.focusRank - 1,
      `focusRankDelta must equal focusRank - 1: delta=${explanation.focusRankDelta} rank=${explanation.focusRank}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('KKKKK-7: out-of-focus winner → focusRankDelta === 0 (winner led pre-focus, no promotion)', async () => {
  // Code focus → neon in-focus; stripe out-of-focus.
  // stripe/create_invoice dominates intent → stripe wins despite no boost → focusRank === 1 → delta === 0.
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
    assert.ok('focusRankDelta' in explanation, 'focusRankDelta present with active focus');
    // If stripe (out-of-focus) won, it led pre-focus → delta === 0
    if (explanation.winnerServer === 'stripe' && explanation.winnerInFocus === false) {
      assert.equal(
        explanation.focusRankDelta,
        0,
        `out-of-focus winner should have focusRankDelta 0, got ${explanation.focusRankDelta}`,
      );
    }
    // Invariant always holds
    assert.equal(explanation.focusRankDelta, explanation.focusRank - 1,
      `focusRankDelta must equal focusRank - 1: delta=${explanation.focusRankDelta} rank=${explanation.focusRank}`);
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
      `cast description should mention focusRankDelta, got: ${cast.description?.slice(0, 500)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
