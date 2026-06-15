/**
 * RRRRR: explanation.focusRankPercentile in ch1tty/cast when explain:true and focus is active.
 *
 * focusRankPercentile: number — the winning tool's pre-focus rank expressed as a fraction of
 * the total candidate pool (focusRank / candidateCount). Normalized [0,1] measure of how
 * deeply buried the winner was before the active focus boost was applied.
 *
 * Present when: focus profile active + winner exists (same conditions as focusRank).
 * Absent when: no focus active, or no_match (no winner).
 *
 * Identity: focusRankPercentile * candidateCount === focusRank always holds.
 * Range: (0, 1] — always > 0 (focusRank >= 1) and <= 1 (focusRank <= candidateCount).
 *
 * Covered:
 *   RRRRR-1: focusRankPercentile present when focus active + winner exists
 *   RRRRR-2: focusRankPercentile === focusRank / candidateCount (mathematical identity)
 *   RRRRR-3: focusRankPercentile in range (0, 1] always when present
 *   RRRRR-4: absent on cast:no_match (no winner)
 *   RRRRR-5: absent when no focus profile is active
 *   RRRRR-6: equals 1/candidateCount when focusRank === 1 (winner already led pre-focus)
 *   RRRRR-7: equals 1 when winner was the bottom candidate pre-focus (focusRank === candidateCount)
 *   RRRRR-8: tool description documents focusRankPercentile
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
  return join(tmpdir(), `ch1tty-rrrrr-${label}-${Date.now()}.jsonl`);
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

test('RRRRR-1: focusRankPercentile present when focus active + winner exists', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('r1', [STRIPE_CFG], { stripe: stripeTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('focusRankPercentile' in explanation,
      `focusRankPercentile should be present when focus active and winner exists; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.focusRankPercentile, 'number', 'focusRankPercentile should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('RRRRR-2: focusRankPercentile === focusRank / candidateCount (mathematical identity)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'sql database query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('r2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focusRankPercentile' in explanation, 'focusRankPercentile should be present');
    assert.ok('focusRank' in explanation, 'focusRank should be present');
    assert.ok('candidateCount' in explanation, 'candidateCount should be present');
    const expected = explanation.focusRank / explanation.candidateCount;
    assert.ok(
      Math.abs(explanation.focusRankPercentile - expected) < 1e-9,
      `focusRankPercentile (${explanation.focusRankPercentile}) must equal focusRank / candidateCount (${expected})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('RRRRR-3: focusRankPercentile in range (0, 1] always when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('r3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focusRankPercentile' in explanation, 'focusRankPercentile should be present');
    assert.ok(
      explanation.focusRankPercentile > 0,
      `focusRankPercentile must be > 0, got ${explanation.focusRankPercentile}`,
    );
    assert.ok(
      explanation.focusRankPercentile <= 1,
      `focusRankPercentile must be <= 1, got ${explanation.focusRankPercentile}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('RRRRR-4: cast:no_match → focusRankPercentile absent (no winner)', async () => {
  const path = dlqPath('r4');
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
      !('focusRankPercentile' in parsed.explanation),
      `focusRankPercentile should be absent on no_match, found: ${parsed.explanation.focusRankPercentile}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('RRRRR-5: no focus active → focusRankPercentile absent', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('r5', [STRIPE_CFG], { stripe: stripeTools }); // no focus
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'focus key should be absent when no focus active');
    assert.ok(
      !('focusRankPercentile' in explanation),
      `focusRankPercentile should be absent when no focus active, found: ${explanation.focusRankPercentile}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('RRRRR-6: focusRankPercentile === 1/candidateCount when focusRank === 1 (winner already led pre-focus)', async () => {
  // finance focus → stripe in-focus; stripe/create_invoice matches all intent terms → stripe leads pre-focus too.
  // focusRank === 1 → focusRankPercentile === 1/candidateCount.
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'sql database query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('r6', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focusRank' in explanation, 'focusRank should be present');
    assert.ok('focusRankPercentile' in explanation, 'focusRankPercentile should be present');
    assert.equal(explanation.focusRank, 1, `expected focusRank 1 (winner already led pre-focus), got ${explanation.focusRank}`);
    const expected = 1 / explanation.candidateCount;
    assert.ok(
      Math.abs(explanation.focusRankPercentile - expected) < 1e-9,
      `when focusRank===1, focusRankPercentile should be 1/candidateCount (${expected}), got ${explanation.focusRankPercentile}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('RRRRR-7: focusRankPercentile === 1 when winner was the bottom candidate pre-focus (focusRank === candidateCount)', async () => {
  // code focus → neon in-focus; neon/run_sql matches 3/4 terms; stripe/create_invoice matches all 4.
  // Without boost: stripe leads (score ~1.0 vs neon ~0.75); neon is LAST (rank 2 of 2).
  // With code focus (+0.5): neon wins (score ~1.25 > ~1.0); focusRank(neon) === 2 === candidateCount(2).
  // focusRankPercentile === 2/2 === 1.
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'sql database schema', inputSchema: { type: 'object', properties: {} } },
  ];
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'sql database schema query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('r7', [NEON_CFG, STRIPE_CFG], { neon: neonTools, stripe: stripeTools },
    { focus: 'code', profiles: CODE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'sql database schema query', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focusRankPercentile' in explanation, 'focusRankPercentile should be present');
    // Identity always holds
    assert.ok(
      Math.abs(explanation.focusRankPercentile - explanation.focusRank / explanation.candidateCount) < 1e-9,
      `identity: percentile=${explanation.focusRankPercentile} rank=${explanation.focusRank} count=${explanation.candidateCount}`,
    );
    // If focus was decisive (neon promoted from last of 2), percentile should be 1
    if (explanation.winnerServer === 'neon' && explanation.winnerInFocus === true && explanation.focusRank === explanation.candidateCount) {
      assert.ok(
        Math.abs(explanation.focusRankPercentile - 1) < 1e-9,
        `when focusRank === candidateCount, focusRankPercentile should be 1, got ${explanation.focusRankPercentile}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('RRRRR-8: tool description documents focusRankPercentile', async () => {
  const path = dlqPath('r8');
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
      cast.description?.includes('focusRankPercentile'),
      `cast description should mention focusRankPercentile, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
