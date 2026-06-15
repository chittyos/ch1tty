/**
 * CCCCCC: explanation.winnerFocusBoostRatio in ch1tty/cast when explain:true.
 *
 * winnerFocusBoostRatio: number — fraction of winner's total score from focus
 * boost (winnerFocusBoost / winnerScore), value in [0,1].
 *
 * Present when: focus active + winner exists + winnerScore > 0.
 * Absent when: no focus active, cast:no_match, or winnerScore === 0.
 * Identity: winnerScoreBase / winnerScore + winnerFocusBoostRatio === 1 (when both present).
 *
 * Covered:
 *   CCCCCC-1: winnerFocusBoostRatio present when focus active + winner exists
 *   CCCCCC-2: winnerFocusBoostRatio is in [0,1]
 *   CCCCCC-3: winnerFocusBoostRatio === winnerFocusBoost / winnerScore
 *   CCCCCC-4: winnerFocusBoostRatio === 0 when winner is out-of-focus
 *   CCCCCC-5: winnerFocusBoostRatio absent on cast:no_match
 *   CCCCCC-6: winnerFocusBoostRatio absent when no focus active
 *   CCCCCC-7: winnerFocusBoostRatio > 0 when winner is in-focus
 *   CCCCCC-8: tool description documents winnerFocusBoostRatio
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
  return join(tmpdir(), `ch1tty-cccccc-${label}-${Date.now()}.jsonl`);
}

const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe Payments', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.test/mcp',
};
const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.test/mcp',
};

// Finance focus: only stripe (ecosystem) is in-focus
const FINANCE_PROFILES: FocusProfiles = {
  profiles: {
    finance: { description: 'Financial tools', categories: ['ecosystem'], servers: ['stripe'], boost: 0.5 },
  },
};

// Code focus: only neon (code) is in-focus — stripe/ecosystem is out-of-focus
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

test('CCCCCC-1: winnerFocusBoostRatio present when focus active + winner exists', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('c1', [STRIPE_CFG], { stripe: stripeTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('focus' in explanation, 'focus should be active');
    assert.ok('winnerScore' in explanation, 'winnerScore should be present (winner exists)');
    assert.ok('winnerFocusBoostRatio' in explanation,
      `winnerFocusBoostRatio should be present when focus active + winner; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.winnerFocusBoostRatio, 'number', 'winnerFocusBoostRatio should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('CCCCCC-2: winnerFocusBoostRatio is in [0,1]', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('c2', [STRIPE_CFG], { stripe: stripeTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('winnerFocusBoostRatio' in explanation, 'winnerFocusBoostRatio should be present');
    assert.ok(
      explanation.winnerFocusBoostRatio >= 0 && explanation.winnerFocusBoostRatio <= 1,
      `winnerFocusBoostRatio should be in [0,1], got ${explanation.winnerFocusBoostRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('CCCCCC-3: winnerFocusBoostRatio === winnerFocusBoost / winnerScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('c3', [STRIPE_CFG], { stripe: stripeTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('winnerFocusBoostRatio' in explanation, 'winnerFocusBoostRatio should be present');
    assert.ok('winnerFocusBoost' in explanation, 'winnerFocusBoost should be present');
    assert.ok('winnerScore' in explanation, 'winnerScore should be present');
    const expected = explanation.winnerFocusBoost / explanation.winnerScore;
    assert.ok(
      Math.abs(explanation.winnerFocusBoostRatio - expected) < 1e-9,
      `winnerFocusBoostRatio (${explanation.winnerFocusBoostRatio}) should equal winnerFocusBoost/winnerScore (${expected})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('CCCCCC-4: winnerFocusBoostRatio === 0 when winner is out-of-focus', async () => {
  // code focus covers only 'code', stripe is 'ecosystem' — out-of-focus
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('c4', [STRIPE_CFG], { stripe: stripeTools },
    { focus: 'code', profiles: CODE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focus' in explanation, 'focus should be active');
    assert.ok('winnerFocusBoostRatio' in explanation, 'winnerFocusBoostRatio should be present');
    assert.equal(explanation.winnerInFocus, false, 'winner should be out-of-focus');
    assert.equal(
      explanation.winnerFocusBoostRatio, 0,
      `winnerFocusBoostRatio should be 0 when winner is out-of-focus, got ${explanation.winnerFocusBoostRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('CCCCCC-5: winnerFocusBoostRatio absent on cast:no_match', async () => {
  const path = dlqPath('c5');
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
      !('winnerFocusBoostRatio' in parsed.explanation),
      `winnerFocusBoostRatio should be absent on no_match, found: ${parsed.explanation.winnerFocusBoostRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('CCCCCC-6: winnerFocusBoostRatio absent when no focus active', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('c6', [STRIPE_CFG], { stripe: stripeTools }); // no focus
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok(
      !('winnerFocusBoostRatio' in explanation),
      `winnerFocusBoostRatio should be absent without focus, found: ${explanation.winnerFocusBoostRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('CCCCCC-7: winnerFocusBoostRatio > 0 when winner is in-focus', async () => {
  // finance focus covers 'ecosystem', stripe is 'ecosystem' — in-focus
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('c7', [STRIPE_CFG], { stripe: stripeTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focus' in explanation, 'focus should be active');
    assert.ok('winnerFocusBoostRatio' in explanation, 'winnerFocusBoostRatio should be present');
    assert.equal(explanation.winnerInFocus, true, 'winner should be in-focus');
    assert.ok(
      explanation.winnerFocusBoostRatio > 0,
      `winnerFocusBoostRatio should be > 0 when winner is in-focus, got ${explanation.winnerFocusBoostRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('CCCCCC-8: tool description documents winnerFocusBoostRatio', async () => {
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
      cast.description?.includes('winnerFocusBoostRatio'),
      `cast description should mention winnerFocusBoostRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
