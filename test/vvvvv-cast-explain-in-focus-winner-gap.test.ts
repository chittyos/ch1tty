/**
 * VVVVV: explanation.inFocusWinnerGap in ch1tty/cast when explain:true.
 *
 * inFocusWinnerGap: number — the score margin by which the out-of-focus winner
 * beat the best in-focus candidate (winnerScore - inFocusTopScore).
 *
 * Present when: focus profile active + winner exists + winnerInFocus === false
 *               + at least one in-focus candidate exists.
 * Absent when: no focus active, no_match, winner is in-focus, or no in-focus candidates.
 *
 * Always >= 0 (winner holds the highest post-boost score).
 *
 * Covered:
 *   VVVVV-1: inFocusWinnerGap present when winner is out-of-focus and in-focus candidates exist
 *   VVVVV-2: inFocusWinnerGap >= 0 always when present
 *   VVVVV-3: inFocusWinnerGap === winnerScore - inFocusTopScore
 *   VVVVV-4: inFocusWinnerGap absent when winner is in-focus
 *   VVVVV-5: inFocusWinnerGap absent on cast:no_match
 *   VVVVV-6: inFocusWinnerGap absent when no focus is active
 *   VVVVV-7: inFocusWinnerGap absent when all candidates are out-of-focus (no in-focus candidates)
 *   VVVVV-8: tool description documents inFocusWinnerGap
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
  return join(tmpdir(), `ch1tty-vvvvv-${label}-${Date.now()}.jsonl`);
}

const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe Payments', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.test/mcp',
};
const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.test/mcp',
};

// code focus: neon (code) in-focus; stripe (ecosystem) out-of-focus
const CODE_PROFILES: FocusProfiles = {
  profiles: {
    code: { description: 'Code tools', categories: ['code'], servers: ['neon'], boost: 0.5 },
  },
};

// finance focus: stripe (ecosystem) in-focus; neon (code) out-of-focus
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

test('VVVVV-1: inFocusWinnerGap present when winner is out-of-focus and in-focus candidates exist', async () => {
  // code focus: neon in-focus, stripe out-of-focus.
  // Strong stripe intent wins despite no boost → stripe is out-of-focus winner.
  // neon tool shares "billing" keyword so it scores > 0.1 and appears as in-focus candidate.
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge stripe refund', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing database query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('v1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'code', profiles: CODE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge stripe refund', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.equal(explanation.winnerServer, 'stripe', 'expected stripe (out-of-focus) to win');
    assert.equal(explanation.winnerInFocus, false, 'winner should be out-of-focus');
    assert.ok('inFocusTopScore' in explanation, 'inFocusTopScore should be present (neon is in-focus)');
    assert.ok('inFocusWinnerGap' in explanation,
      `inFocusWinnerGap should be present when winner is out-of-focus and in-focus candidates exist; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.inFocusWinnerGap, 'number', 'inFocusWinnerGap should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('VVVVV-2: inFocusWinnerGap >= 0 always when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge stripe refund', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing database query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('v2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'code', profiles: CODE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge stripe refund', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('inFocusWinnerGap' in explanation, 'inFocusWinnerGap should be present');
    assert.ok(
      explanation.inFocusWinnerGap >= 0,
      `inFocusWinnerGap should be >= 0, got ${explanation.inFocusWinnerGap}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('VVVVV-3: inFocusWinnerGap === winnerScore - inFocusTopScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge stripe refund', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing database query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('v3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'code', profiles: CODE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge stripe refund', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('inFocusWinnerGap' in explanation, 'inFocusWinnerGap should be present');
    const expected = explanation.winnerScore - explanation.inFocusTopScore;
    assert.ok(
      Math.abs(explanation.inFocusWinnerGap - expected) < 1e-9,
      `inFocusWinnerGap (${explanation.inFocusWinnerGap}) should equal winnerScore - inFocusTopScore (${expected})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('VVVVV-4: inFocusWinnerGap absent when winner is in-focus', async () => {
  // finance focus: stripe in-focus, neon out-of-focus. Strong stripe intent → stripe wins in-focus.
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('v4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.winnerInFocus, true, 'winner should be in-focus for this scenario');
    assert.ok(
      !('inFocusWinnerGap' in explanation),
      `inFocusWinnerGap should be absent when winner is in-focus, found: ${explanation.inFocusWinnerGap}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('VVVVV-5: inFocusWinnerGap absent on cast:no_match', async () => {
  const path = dlqPath('v5');
  const emptyAgg = new Aggregator([STRIPE_CFG], {
    backendFactory: () => makeBackend([]),
    focusProfiles: CODE_PROFILES,
    suggestionsCatalog: {},
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
    focus: 'code',
  });
  try {
    const r = await emptyAgg.callTool('ch1tty/cast', { intent: 'xyzzy-nonexistent', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'no_match', `expected no_match, got ${parsed.cast}`);
    assert.ok('explanation' in parsed, 'explanation absent');
    assert.ok(
      !('inFocusWinnerGap' in parsed.explanation),
      `inFocusWinnerGap should be absent on no_match, found: ${parsed.explanation.inFocusWinnerGap}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('VVVVV-6: inFocusWinnerGap absent when no focus is active', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('v6', [STRIPE_CFG], { stripe: stripeTools }); // no focus
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok(
      !('inFocusWinnerGap' in explanation),
      `inFocusWinnerGap should be absent when no focus active, found: ${explanation.inFocusWinnerGap}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('VVVVV-7: inFocusWinnerGap absent when all candidates are out-of-focus', async () => {
  // code focus → neon in-focus. Only stripe tools → all candidates out-of-focus → no inFocusTopScore → no inFocusWinnerGap.
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge fee', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('v7', [STRIPE_CFG], { stripe: stripeTools },
    { focus: 'code', profiles: CODE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge fee', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focus' in explanation, 'focus should be active');
    assert.ok(
      !('inFocusTopScore' in explanation),
      'inFocusTopScore should be absent (all candidates out-of-focus)',
    );
    assert.ok(
      !('inFocusWinnerGap' in explanation),
      `inFocusWinnerGap should be absent when no in-focus candidates, found: ${explanation.inFocusWinnerGap}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('VVVVV-8: tool description documents inFocusWinnerGap', async () => {
  const path = dlqPath('v8');
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
      cast.description?.includes('inFocusWinnerGap'),
      `cast description should mention inFocusWinnerGap, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
