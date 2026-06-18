/**
 * QQQQQ: explanation.outOfFocusWinnerGap in ch1tty/cast when explain:true and focus is active.
 *
 * outOfFocusWinnerGap: number — score gap between the winning tool and the best out-of-focus
 * candidate (winnerScore - topOutOfFocusScore).
 *
 * Present when: focus profile active + winner exists + at least one out-of-focus candidate.
 * Absent when: no focus active, no_match (no winner), or all candidates are in-focus.
 *
 * Always >= 0: winner holds the maximum post-boost score, so topOutOfFocusScore <= winnerScore.
 *
 * Covered:
 *   QQQQQ-1: outOfFocusWinnerGap present when focus active + winner exists + out-of-focus candidates
 *   QQQQQ-2: outOfFocusWinnerGap >= 0 always when present
 *   QQQQQ-3: outOfFocusWinnerGap === winnerScore - topOutOfFocusScore (identity)
 *   QQQQQ-4: absent when all candidates are in-focus (no out-of-focus candidates)
 *   QQQQQ-5: absent on cast:no_match (no winner)
 *   QQQQQ-6: absent when no focus profile is active
 *   QQQQQ-7: outOfFocusWinnerGap is a number when present
 *   QQQQQ-8: tool description documents outOfFocusWinnerGap
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
  return join(tmpdir(), `ch1tty-qqqqq-${label}-${Date.now()}.jsonl`);
}

const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe Payments', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.test/mcp',
};
const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.test/mcp',
};

// Finance profile: stripe (ecosystem) in-focus; neon (code) out-of-focus
const FINANCE_PROFILES: FocusProfiles = {
  profiles: {
    finance: { description: 'Financial tools', categories: ['ecosystem'], servers: ['stripe'], boost: 0.5 },
  },
};

// Code profile: neon (code) in-focus; stripe (ecosystem) out-of-focus
const CODE_PROFILES: FocusProfiles = {
  profiles: {
    code: { description: 'Code tools', categories: ['code'], servers: ['neon'], boost: 0.5 },
  },
};

// All-focus profile: both stripe and neon in-focus
const ALL_FOCUS_PROFILES: FocusProfiles = {
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

test('QQQQQ-1: outOfFocusWinnerGap present when focus active + winner exists + out-of-focus candidates', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(
      'outOfFocusWinnerGap' in explanation,
      `outOfFocusWinnerGap should be present when focus active, winner exists, and out-of-focus candidates exist; got keys: ${Object.keys(explanation).join(', ')}`,
    );
    assert.equal(typeof explanation.outOfFocusWinnerGap, 'number', 'outOfFocusWinnerGap should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQ-2: outOfFocusWinnerGap >= 0 always when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('outOfFocusWinnerGap' in explanation, 'outOfFocusWinnerGap should be present');
    assert.ok(
      explanation.outOfFocusWinnerGap >= 0,
      `outOfFocusWinnerGap should be >= 0, got ${explanation.outOfFocusWinnerGap}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQ-3: outOfFocusWinnerGap === winnerScore - topOutOfFocusScore (identity)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('outOfFocusWinnerGap' in explanation, 'outOfFocusWinnerGap should be present');
    assert.ok('winnerScore' in explanation, 'winnerScore should be present');
    assert.ok('topOutOfFocusScore' in explanation, 'topOutOfFocusScore should be present');
    const expected = explanation.winnerScore - explanation.topOutOfFocusScore;
    assert.ok(
      Math.abs(explanation.outOfFocusWinnerGap - expected) < 1e-9,
      `outOfFocusWinnerGap (${explanation.outOfFocusWinnerGap}) should equal winnerScore - topOutOfFocusScore (${expected})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQ-4: outOfFocusWinnerGap absent when all candidates are in-focus', async () => {
  // finance focus → stripe in-focus. Only stripe tools → all candidates in-focus → absent.
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
    { name: 'refund', description: 'billing refund payment', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q4', [STRIPE_CFG], { stripe: stripeTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focus' in explanation, 'focus should be present (focus is active)');
    assert.ok(
      !('outOfFocusWinnerGap' in explanation),
      `outOfFocusWinnerGap should be absent when all candidates are in-focus, found: ${explanation.outOfFocusWinnerGap}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQ-5: cast:no_match → outOfFocusWinnerGap absent (no winner)', async () => {
  const path = dlqPath('q5');
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
      !('outOfFocusWinnerGap' in parsed.explanation),
      `outOfFocusWinnerGap should be absent on no_match, found: ${parsed.explanation.outOfFocusWinnerGap}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('QQQQQ-6: no focus active → outOfFocusWinnerGap absent', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q6', [STRIPE_CFG], { stripe: stripeTools }); // no focus
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'focus key should be absent when no focus active');
    assert.ok(
      !('outOfFocusWinnerGap' in explanation),
      `outOfFocusWinnerGap should be absent when no focus active, found: ${explanation.outOfFocusWinnerGap}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQ-7: outOfFocusWinnerGap is a number and co-present with topOutOfFocusScore', async () => {
  // code focus: neon in-focus. stripe out-of-focus.
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'sql database query billing schema', inputSchema: { type: 'object', properties: {} } },
  ];
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice sql query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q7', [NEON_CFG, STRIPE_CFG], { neon: neonTools, stripe: stripeTools },
    { focus: 'code', profiles: CODE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'sql database query billing schema', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('winnerScore' in explanation, 'winnerScore should be present');
    // Both should be present or both absent (same conditions)
    const hasTop = 'topOutOfFocusScore' in explanation;
    const hasGap = 'outOfFocusWinnerGap' in explanation;
    assert.equal(hasTop, hasGap,
      `topOutOfFocusScore (${hasTop}) and outOfFocusWinnerGap (${hasGap}) must have identical presence`);
    if (hasGap) {
      assert.equal(typeof explanation.outOfFocusWinnerGap, 'number', 'outOfFocusWinnerGap must be a number');
      assert.ok(explanation.outOfFocusWinnerGap >= 0, 'outOfFocusWinnerGap must be >= 0');
    }
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQ-8: tool description documents outOfFocusWinnerGap', async () => {
  const path = dlqPath('q8');
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
      cast.description?.includes('outOfFocusWinnerGap'),
      `cast description should mention outOfFocusWinnerGap, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
