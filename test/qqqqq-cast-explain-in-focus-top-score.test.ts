/**
 * QQQQQ: explanation.inFocusTopScore in ch1tty/cast when explain:true and focus is active.
 *
 * inFocusTopScore: number — the highest relevance score among all in-focus candidates
 * (candidates whose server or category matches the active focus profile).
 *
 * Present when: focus profile active + winner exists + at least one in-focus candidate.
 * Absent when: no focus active, no_match (no winner), or all candidates are out-of-focus.
 *
 * When winner is in-focus: inFocusTopScore === winnerScore (winner is top in-focus candidate).
 * When winner is out-of-focus: inFocusTopScore shows the best in-focus score achieved even
 * though focus didn't produce the winner.
 *
 * Covered:
 *   QQQQQ-1: inFocusTopScore present when focus active + winner exists + in-focus candidates
 *   QQQQQ-2: inFocusTopScore >= 0 always when present
 *   QQQQQ-3: inFocusTopScore === winnerScore when winner is in-focus
 *   QQQQQ-4: inFocusTopScore <= winnerScore when winner is out-of-focus
 *   QQQQQ-5: absent when all candidates are out-of-focus
 *   QQQQQ-6: absent on cast:no_match (no winner)
 *   QQQQQ-7: absent when no focus profile is active
 *   QQQQQ-8: tool description documents inFocusTopScore
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

test('QQQQQ-1: inFocusTopScore present when focus active + winner exists + in-focus candidates', async () => {
  // finance focus: stripe in-focus, neon out-of-focus. Both present → inFocusTopScore present.
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
    assert.ok('inFocusTopScore' in explanation,
      `inFocusTopScore should be present when focus active, winner exists, and in-focus candidates exist; got keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.inFocusTopScore, 'number', 'inFocusTopScore should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQ-2: inFocusTopScore >= 0 always when present', async () => {
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
    assert.ok('inFocusTopScore' in explanation, 'inFocusTopScore should be present');
    assert.ok(
      explanation.inFocusTopScore >= 0,
      `inFocusTopScore should be >= 0, got ${explanation.inFocusTopScore}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQ-3: inFocusTopScore === winnerScore when winner is in-focus', async () => {
  // finance focus: stripe in-focus wins → inFocusTopScore equals winnerScore.
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'sql database query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('inFocusTopScore' in explanation, 'inFocusTopScore should be present');
    assert.equal(explanation.winnerInFocus, true, 'expected in-focus winner for this scenario');
    assert.ok(
      Math.abs(explanation.inFocusTopScore - explanation.winnerScore) < 1e-9,
      `in-focus winner: inFocusTopScore (${explanation.inFocusTopScore}) should equal winnerScore (${explanation.winnerScore})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQ-4: inFocusTopScore <= winnerScore when winner is out-of-focus', async () => {
  // code focus: neon in-focus. stripe wins with strong intent match despite no boost.
  // stripe (out-of-focus) wins → inFocusTopScore = best neon score ≤ winnerScore.
  // neon tool description shares "billing" with the intent so it scores > 0.1 and
  // appears in scoredTools (scoreIntent filters out tools scoring ≤ 0.1).
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge stripe refund', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing database query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'code', profiles: CODE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge stripe refund', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('inFocusTopScore' in explanation, 'inFocusTopScore should be present (neon is in-focus)');
    assert.equal(explanation.winnerServer, 'stripe', 'expected stripe to win this scenario');
    assert.equal(explanation.winnerInFocus, false, 'expected out-of-focus winner');
    assert.ok(
      explanation.inFocusTopScore <= explanation.winnerScore + 1e-9,
      `out-of-focus winner: inFocusTopScore (${explanation.inFocusTopScore}) must be <= winnerScore (${explanation.winnerScore})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQ-5: inFocusTopScore absent when all candidates are out-of-focus', async () => {
  // code focus → neon in-focus. Only stripe tools → all candidates out-of-focus → absent.
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge fee', inputSchema: { type: 'object', properties: {} } },
    { name: 'refund', description: 'billing refund payment', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q5', [STRIPE_CFG], { stripe: stripeTools },
    { focus: 'code', profiles: CODE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge fee', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focus' in explanation, 'focus should be present (focus is active)');
    assert.ok(
      !('inFocusTopScore' in explanation),
      `inFocusTopScore should be absent when all candidates are out-of-focus, found: ${explanation.inFocusTopScore}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQ-6: cast:no_match → inFocusTopScore absent (no winner)', async () => {
  const path = dlqPath('q6');
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
      !('inFocusTopScore' in parsed.explanation),
      `inFocusTopScore should be absent on no_match, found: ${parsed.explanation.inFocusTopScore}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('QQQQQ-7: no focus active → inFocusTopScore absent', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('q7', [STRIPE_CFG], { stripe: stripeTools }); // no focus
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'focus key should be absent when no focus active');
    assert.ok(
      !('inFocusTopScore' in explanation),
      `inFocusTopScore should be absent when no focus active, found: ${explanation.inFocusTopScore}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('QQQQQ-8: tool description documents inFocusTopScore', async () => {
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
      cast.description?.includes('inFocusTopScore'),
      `cast description should mention inFocusTopScore, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
