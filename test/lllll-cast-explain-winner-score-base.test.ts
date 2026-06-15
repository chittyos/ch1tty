/**
 * LLLLL: explanation.winnerScoreBase in ch1tty/cast when explain:true and focus is active.
 *
 * winnerScoreBase: number — the winning tool's relevance score before the active focus boost
 * was applied (winnerScore - winnerFocusBoost).
 *
 * Present when: focus profile active + winner exists (same conditions as winnerFocusBoost).
 * Absent when: no focus active, or no_match (no winner).
 *
 * Value: equal to winnerScore when winner is out-of-focus (no boost applied);
 *        strictly less than winnerScore when winner is in-focus.
 *        Identity: winnerScoreBase + winnerFocusBoost === winnerScore always.
 *
 * Covered:
 *   LLLLL-1: winnerScoreBase present when focus active + winner exists
 *   LLLLL-2: winnerScoreBase === winnerScore - winnerFocusBoost (mathematical identity)
 *   LLLLL-3: winnerScoreBase === winnerScore when winner is out-of-focus (no boost applied)
 *   LLLLL-4: absent on cast:no_match (no winner)
 *   LLLLL-5: absent when no focus profile is active
 *   LLLLL-6: winnerScoreBase >= 0 always when present
 *   LLLLL-7: winnerScoreBase < winnerScore when winner is in-focus (boost > 0 applied)
 *   LLLLL-8: tool description documents winnerScoreBase
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
  return join(tmpdir(), `ch1tty-lllll-${label}-${Date.now()}.jsonl`);
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

test('LLLLL-1: winnerScoreBase present when focus active + winner exists', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('l1', [STRIPE_CFG], { stripe: stripeTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('winnerScoreBase' in explanation,
      `winnerScoreBase should be present when focus active and winner exists; got keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.winnerScoreBase, 'number', 'winnerScoreBase should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('LLLLL-2: winnerScoreBase === winnerScore - winnerFocusBoost (mathematical identity)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'sql database query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('l2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('winnerScoreBase' in explanation, 'winnerScoreBase should be present');
    assert.ok('winnerScore' in explanation, 'winnerScore should be present');
    assert.ok('winnerFocusBoost' in explanation, 'winnerFocusBoost should be present');
    const expected = explanation.winnerScore - explanation.winnerFocusBoost;
    assert.ok(
      Math.abs(explanation.winnerScoreBase - expected) < 1e-9,
      `winnerScoreBase (${explanation.winnerScoreBase}) must equal winnerScore - winnerFocusBoost (${expected})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('LLLLL-3: winnerScoreBase === winnerScore when winner is out-of-focus (no boost applied)', async () => {
  // Code focus → neon in-focus; stripe out-of-focus.
  // stripe dominates the intent → stripe wins with no boost → winnerFocusBoost === 0 → winnerScoreBase === winnerScore.
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'invoice payment charge stripe fee refund transaction', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'sql database query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('l3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'code', profiles: CODE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'invoice payment charge stripe fee refund transaction', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('winnerScoreBase' in explanation, 'winnerScoreBase should be present with active focus');
    // If stripe (out-of-focus) won, no boost was applied
    if (explanation.winnerServer === 'stripe' && explanation.winnerInFocus === false) {
      assert.equal(explanation.winnerFocusBoost, 0, 'out-of-focus winner: winnerFocusBoost should be 0');
      assert.ok(
        Math.abs(explanation.winnerScoreBase - explanation.winnerScore) < 1e-9,
        `out-of-focus winner: winnerScoreBase (${explanation.winnerScoreBase}) should equal winnerScore (${explanation.winnerScore})`,
      );
    }
    // Identity always holds regardless of who won
    const expected = explanation.winnerScore - explanation.winnerFocusBoost;
    assert.ok(
      Math.abs(explanation.winnerScoreBase - expected) < 1e-9,
      `winnerScoreBase identity failed: base=${explanation.winnerScoreBase} score=${explanation.winnerScore} boost=${explanation.winnerFocusBoost}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('LLLLL-4: cast:no_match → winnerScoreBase absent (no winner)', async () => {
  const path = dlqPath('l4');
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
      !('winnerScoreBase' in parsed.explanation),
      `winnerScoreBase should be absent on no_match, found: ${parsed.explanation.winnerScoreBase}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('LLLLL-5: no focus active → winnerScoreBase absent', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('l5', [STRIPE_CFG], { stripe: stripeTools }); // no focus
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'focus key should be absent when no focus active');
    assert.ok(
      !('winnerScoreBase' in explanation),
      `winnerScoreBase should be absent when no focus active, found: ${explanation.winnerScoreBase}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('LLLLL-6: winnerScoreBase >= 0 always when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('l6', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('winnerScoreBase' in explanation, 'winnerScoreBase should be present');
    assert.ok(
      explanation.winnerScoreBase >= 0,
      `winnerScoreBase should be >= 0, got ${explanation.winnerScoreBase}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('LLLLL-7: winnerScoreBase < winnerScore when winner is in-focus (boost > 0 applied)', async () => {
  // finance focus → stripe in-focus; stripe wins; winnerFocusBoost = 0.5 > 0 → winnerScoreBase < winnerScore.
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('l7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('winnerScoreBase' in explanation, 'winnerScoreBase should be present');
    // When the winner is in-focus, the boost is non-zero → base < final score
    if (explanation.winnerInFocus === true) {
      assert.ok(
        explanation.winnerScoreBase < explanation.winnerScore,
        `in-focus winner: winnerScoreBase (${explanation.winnerScoreBase}) should be < winnerScore (${explanation.winnerScore})`,
      );
    }
    // Identity always holds
    const expected = explanation.winnerScore - explanation.winnerFocusBoost;
    assert.ok(
      Math.abs(explanation.winnerScoreBase - expected) < 1e-9,
      `identity: base=${explanation.winnerScoreBase} score=${explanation.winnerScore} boost=${explanation.winnerFocusBoost}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('LLLLL-8: tool description documents winnerScoreBase', async () => {
  const path = dlqPath('l8');
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
      cast.description?.includes('winnerScoreBase'),
      `cast description should mention winnerScoreBase, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
