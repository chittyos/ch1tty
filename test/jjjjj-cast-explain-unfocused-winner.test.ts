/**
 * JJJJJ: explanation.unfocusedWinner in ch1tty/cast when explain:true and focus changed the top spot.
 *
 * unfocusedWinner: string — namespaced tool that would have won without the active focus boost
 * (the tool at rank 1 in pre-focus descending score order). Present only when the pre-focus
 * leader differs from the actual winner. Absent when no focus, on no_match, or when winner
 * already led pre-focus (focusRank === 1).
 *
 * Covered:
 *   JJJJJ-1: absent when winner already led pre-focus (focusRank === 1, no displacement)
 *   JJJJJ-2: present and correct when focus promoted winner from 2nd (pre-focus leader displaced)
 *   JJJJJ-3: absent on cast:no_match (no winner)
 *   JJJJJ-4: absent when no focus profile is active
 *   JJJJJ-5: unfocusedWinner is always a namespaced tool name (contains "/")
 *   JJJJJ-6: unfocusedWinner consistent with focusRank — absent iff focusRank === 1
 *   JJJJJ-7: out-of-focus winner → unfocusedWinner absent (winner already led pre-focus)
 *   JJJJJ-8: tool description documents unfocusedWinner
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
  return join(tmpdir(), `ch1tty-jjjjj-${label}-${Date.now()}.jsonl`);
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

test('JJJJJ-1: absent when winner already led pre-focus (no displacement)', async () => {
  // stripe/create_invoice matches all intent terms → raw score ~1.0 (already #1 pre-focus)
  // neon/run_sql matches only ~0.25 of terms
  // finance focus boosts stripe, but stripe was already leading → focusRank===1 → unfocusedWinner absent
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'sql database query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('j1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    // stripe matches 4/4 intent terms (raw 1.0), neon matches 0/4 (sql/database ≠ billing/invoice/payment/charge)
    // finance focus boosts stripe further; stripe was #1 pre-focus too → focusRank===1, unfocusedWinner absent
    assert.equal(explanation.focusRank, 1, `expected focusRank 1 (stripe led pre-focus), got ${explanation.focusRank}`);
    assert.ok(
      !('unfocusedWinner' in explanation),
      `unfocusedWinner should be absent when focusRank===1, got "${explanation.unfocusedWinner}"`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('JJJJJ-2: present and correct when focus promoted winner from 2nd place', async () => {
  // code focus: neon in-focus. neon matches 3/4 terms (raw ~0.75), stripe matches 4/4 (raw ~1.0).
  // With boost: neon = 1.25, stripe = 1.0 → neon wins. Without boost: stripe led (rank 1) → neon was rank 2.
  // So unfocusedWinner should be "stripe/create_invoice" when neon wins due to focus.
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'sql database schema', inputSchema: { type: 'object', properties: {} } },
  ];
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'sql database schema query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('j2', [NEON_CFG, STRIPE_CFG], { neon: neonTools, stripe: stripeTools },
    { focus: 'code', profiles: CODE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'sql database schema query', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    // neon: 3/4 terms "sql database schema" from intent "sql database schema query" → raw 0.75
    // stripe: 4/4 terms "sql database schema query" → raw 1.0
    // code focus boost 0.5: neon=1.25, stripe=1.0 → neon wins; pre-focus stripe led (1.0 > 0.75) → focusRank>=2
    assert.equal(explanation.winnerServer, 'neon', `expected neon to win with code focus, got "${explanation.winnerServer}"`);
    assert.ok('focusRank' in explanation, 'focusRank should be present with active focus');
    assert.ok(explanation.focusRank >= 2, `expected focusRank >= 2 (neon was promoted by focus), got ${explanation.focusRank}`);
    assert.ok('unfocusedWinner' in explanation, 'unfocusedWinner should be present when focus changed top spot');
    assert.equal(typeof explanation.unfocusedWinner, 'string', 'unfocusedWinner should be a string');
    assert.ok(
      explanation.unfocusedWinner.includes('/'),
      `unfocusedWinner should be a namespaced tool name, got "${explanation.unfocusedWinner}"`,
    );
    assert.ok(
      explanation.unfocusedWinner.startsWith('stripe/'),
      `unfocusedWinner should be the stripe tool displaced by neon, got "${explanation.unfocusedWinner}"`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('JJJJJ-3: cast:no_match → unfocusedWinner absent', async () => {
  const path = dlqPath('j3');
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
      !('unfocusedWinner' in parsed.explanation),
      `unfocusedWinner should be absent on no_match, got "${parsed.explanation.unfocusedWinner}"`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('JJJJJ-4: no focus active → unfocusedWinner absent', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('j4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools }); // no focus
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'focus key should be absent when no focus active');
    assert.ok(
      !('unfocusedWinner' in explanation),
      `unfocusedWinner should be absent when no focus active, got "${explanation.unfocusedWinner}"`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('JJJJJ-5: unfocusedWinner is always a namespaced tool name (contains "/")', async () => {
  // code focus: neon in-focus. neon matches 3/4 terms, stripe matches 4/4 → stripe led pre-focus.
  // With boost neon wins → unfocusedWinner = "stripe/create_invoice" (namespaced)
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'sql database schema', inputSchema: { type: 'object', properties: {} } },
  ];
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'sql database schema query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('j5', [NEON_CFG, STRIPE_CFG], { neon: neonTools, stripe: stripeTools },
    { focus: 'code', profiles: CODE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'sql database schema query', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    // neon: 3/4 terms (raw 0.75) + code focus 0.5 = 1.25; stripe: 4/4 terms = 1.0 → neon wins, displacing stripe
    assert.ok('focusRank' in explanation, 'focusRank should be present with active focus and a winner');
    assert.ok('unfocusedWinner' in explanation, 'unfocusedWinner should be present (neon won due to focus, displacing stripe)');
    assert.equal(typeof explanation.unfocusedWinner, 'string', 'unfocusedWinner should be a string');
    assert.ok(
      explanation.unfocusedWinner.includes('/'),
      `unfocusedWinner should contain "/" (namespaced), got "${explanation.unfocusedWinner}"`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('JJJJJ-6: unfocusedWinner absent ↔ focusRank === 1 (consistency)', async () => {
  // When focusRank===1 the winner already led pre-focus → unfocusedWinner must be absent.
  // When focusRank>1 the winner did not lead pre-focus → unfocusedWinner must be present.
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge fee refund', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('j6', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge fee refund', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focusRank' in explanation, 'focusRank should be present with active focus');
    const rank = explanation.focusRank as number;
    const hasUnfocused = 'unfocusedWinner' in explanation;
    if (rank === 1) {
      assert.ok(!hasUnfocused, `focusRank===1 but unfocusedWinner present: "${explanation.unfocusedWinner}"`);
    } else {
      assert.ok(hasUnfocused, `focusRank===${rank} (>1) but unfocusedWinner absent`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('JJJJJ-7: out-of-focus winner → unfocusedWinner absent (winner already led pre-focus)', async () => {
  // Code focus → neon in-focus; stripe dominates the intent → stripe wins despite no boost.
  // Since stripe (out-of-focus) wins: it had the highest pre-focus score → focusRank===1 → unfocusedWinner absent.
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'invoice payment charge stripe fee refund transaction', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('j7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'code', profiles: CODE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'invoice payment charge stripe fee refund transaction', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    // stripe: 7/7 intent terms = 1.0 raw; neon: 0/7 terms = 0 raw + code boost 0.5 = 0.5
    // stripe wins (1.0 > 0.5) despite being out-of-focus; it also led pre-focus → focusRank===1, unfocusedWinner absent
    assert.equal(explanation.winnerServer, 'stripe', `expected stripe to win (dominates intent), got "${explanation.winnerServer}"`);
    assert.equal(explanation.winnerInFocus, false, 'stripe should be out-of-focus under code profile');
    assert.equal(explanation.focusRank, 1, `out-of-focus winner led pre-focus too → focusRank===1, got ${explanation.focusRank}`);
    assert.ok(
      !('unfocusedWinner' in explanation),
      `out-of-focus winner should have no unfocusedWinner, got "${explanation.unfocusedWinner}"`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('JJJJJ-8: tool description documents unfocusedWinner', async () => {
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
      cast.description?.includes('unfocusedWinner'),
      `cast description should mention unfocusedWinner, got: ${cast.description?.slice(0, 500)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
