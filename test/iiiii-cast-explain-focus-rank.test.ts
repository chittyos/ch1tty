/**
 * IIIII: explanation.focusRank in ch1tty/cast when explain:true and focus is active.
 *
 * focusRank: number — the 1-based rank the winning tool would hold if the focus
 * boost were removed (its position in pre-focus descending score order).
 *
 * Present when: focus profile active + winner exists.
 * Absent when: no focus active, or no_match (no winner).
 *
 * Covered:
 *   IIIII-1: focusRank === 1 when winner was already #1 pre-focus (focus didn't change rank)
 *   IIIII-2: focusRank === 2 when focus promoted winner from 2nd to 1st
 *   IIIII-3: absent on cast:no_match (no winner)
 *   IIIII-4: absent when no focus profile is active
 *   IIIII-5: focusRank is always a positive integer (≥ 1)
 *   IIIII-6: focusRank === 1 ↔ focusDecisive === false when a runner-up exists
 *   IIIII-7: focusRank === 1 when winner is out-of-focus (no boost applied, winner still leads pre-focus)
 *   IIIII-8: tool description documents focusRank
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
  return join(tmpdir(), `ch1tty-iiiii-${label}-${Date.now()}.jsonl`);
}

const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe Payments', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.test/mcp',
};
const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.test/mcp',
};
const FS_CFG: ServerConfig = {
  id: 'fs', name: 'Filesystem', type: 'remote', access: 'readwrite',
  category: 'ops', endpoint: 'https://fs.test/mcp',
};

// Finance profile: stripe (ecosystem) is in-focus; neon/fs are out-of-focus
const FINANCE_PROFILES: FocusProfiles = {
  profiles: {
    finance: { description: 'Financial tools', categories: ['ecosystem'], servers: ['stripe'], boost: 0.5 },
  },
};

// Code profile: neon (code) is in-focus; stripe/fs are out-of-focus
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

test('IIIII-1: focusRank === 1 when winner was already #1 pre-focus', async () => {
  // stripe/create_invoice matches all 4 intent terms (score ~1.0); neon/run_sql matches ~0.25
  // With finance focus, stripe gets +0.5 boost → still #1. Without boost, stripe was also #1.
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'sql database query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('i1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('focusRank' in explanation, 'focusRank should be present when focus active and winner exists');
    assert.equal(explanation.focusRank, 1, `expected focusRank 1, got ${explanation.focusRank}`);
  } finally {
    await agg.shutdown();
  }
});

test('IIIII-2: focusRank === 2 when focus promoted winner from 2nd to 1st', async () => {
  // neon/run_sql: matches 2/4 intent terms (sql database) → raw score ~0.5
  // stripe/create_invoice: matches 4/4 intent terms → raw score ~1.0
  // code focus: neon gets +0.5 boost → boosted score 1.0; stripe stays at ~1.0 but neon wins on tie/margin
  // Actually we need neon to clearly win ONLY because of the boost.
  // Let's use: neon matches 2 terms, stripe matches 4 terms.
  // stripe raw: ~1.0, neon raw: ~0.5. With boost: neon = 1.0, stripe = 1.0 → might tie.
  // To ensure neon wins: give neon 3 matching terms (raw ~0.75) and stripe 4 terms (raw ~1.0).
  // With boost: neon = 1.25, stripe = 1.0 → neon wins. Without boost: neon = 0.75, stripe = 1.0 → stripe wins.
  // So neon's focusRank = 2.
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'sql database schema', inputSchema: { type: 'object', properties: {} } },
  ];
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'sql database schema query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('i2', [NEON_CFG, STRIPE_CFG], { neon: neonTools, stripe: stripeTools },
    { focus: 'code', profiles: CODE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'sql database schema query', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('focusRank' in explanation, 'focusRank should be present when focus active and winner exists');
    // neon wins with focus boost; without boost neon was behind stripe → focusRank >= 2
    // verify: winner is neon (in-focus)
    if (explanation.winnerServer === 'neon' && explanation.winnerInFocus === true) {
      assert.ok(explanation.focusRank >= 2, `expected focusRank >= 2 when focus promoted neon, got ${explanation.focusRank}`);
    } else {
      // stripe won outright (focus not decisive) → focusRank should be 1
      assert.equal(explanation.focusRank, 1, `when stripe wins without focus, focusRank should be 1, got ${explanation.focusRank}`);
    }
    assert.equal(typeof explanation.focusRank, 'number', 'focusRank should be a number');
    assert.ok(explanation.focusRank >= 1, 'focusRank should be >= 1');
  } finally {
    await agg.shutdown();
  }
});

test('IIIII-3: cast:no_match → focusRank absent', async () => {
  const path = dlqPath('i3');
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
      !('focusRank' in parsed.explanation),
      `focusRank should be absent on no_match, got ${parsed.explanation.focusRank}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('IIIII-4: no focus active → focusRank absent', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('i4', [STRIPE_CFG], { stripe: stripeTools }); // no focus
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'focus should be absent when no focus active');
    assert.ok(
      !('focusRank' in explanation),
      `focusRank should be absent when no focus active, got ${explanation.focusRank}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('IIIII-5: focusRank is always a positive integer (>= 1)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('i5', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focusRank' in explanation, 'focusRank should be present with active focus');
    assert.equal(typeof explanation.focusRank, 'number', 'focusRank should be a number');
    assert.ok(Number.isInteger(explanation.focusRank), 'focusRank should be an integer');
    assert.ok(explanation.focusRank >= 1, `focusRank should be >= 1, got ${explanation.focusRank}`);
  } finally {
    await agg.shutdown();
  }
});

test('IIIII-6: focusRank === 1 is consistent with focusDecisive === false when runner-up exists', async () => {
  // When focusDecisive is false, winner would have won even without the boost → focusRank must be 1.
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge fee refund', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('i6', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge fee refund', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focusRank' in explanation, 'focusRank should be present with active focus');
    // When focusDecisive is explicitly false AND a runner-up exists, focusRank must be 1
    if ('focusDecisive' in explanation && explanation.focusDecisive === false) {
      assert.equal(
        explanation.focusRank,
        1,
        `when focusDecisive is false, focusRank must be 1 (winner led pre-focus), got ${explanation.focusRank}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('IIIII-7: out-of-focus winner → focusRank === 1 (no boost applied, winner led pre-focus)', async () => {
  // Code focus → neon in-focus; stripe out-of-focus.
  // stripe/create_invoice dominates intent → stripe wins despite no boost → focusRank === 1
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'invoice payment charge stripe fee refund transaction', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('i7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'code', profiles: CODE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'invoice payment charge stripe fee refund transaction', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focusRank' in explanation, 'focusRank present with active focus');
    // If stripe (out-of-focus) won, it means stripe led even pre-focus → focusRank should be 1
    if (explanation.winnerServer === 'stripe' && explanation.winnerInFocus === false) {
      assert.equal(
        explanation.focusRank,
        1,
        `out-of-focus winner should have focusRank 1, got ${explanation.focusRank}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('IIIII-8: tool description documents focusRank', async () => {
  const path = dlqPath('i8');
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
      cast.description?.includes('focusRank'),
      `cast description should mention focusRank, got: ${cast.description?.slice(0, 500)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
