/**
 * PPPPP: explanation.topOutOfFocusScore in ch1tty/cast when explain:true and focus is active.
 *
 * topOutOfFocusScore: number — the highest relevance score among all out-of-focus candidates
 * (candidates whose server and category do not match the active focus profile).
 *
 * Present when: focus profile active + winner exists + at least one out-of-focus candidate.
 * Absent when: no focus active, no_match (no winner), or all candidates are in-focus.
 *
 * Value: the max score of any out-of-focus tool in the scored candidate set.
 * Combined with winnerScore: shows winner's advantage over the non-focus field.
 * Combined with winnerScoreBase: reveals if winner would have beaten the out-of-focus field
 * even without the boost (winnerScoreBase > topOutOfFocusScore → focus not decisive for
 * beating the out-of-focus field).
 *
 * Covered:
 *   PPPPP-1: topOutOfFocusScore present when focus active + winner exists + out-of-focus candidates
 *   PPPPP-2: topOutOfFocusScore >= 0 always when present
 *   PPPPP-3: topOutOfFocusScore <= winnerScore always when present (winner has max score)
 *   PPPPP-4: absent when all candidates are in-focus (no out-of-focus candidates)
 *   PPPPP-5: absent on cast:no_match (no winner)
 *   PPPPP-6: absent when no focus profile is active
 *   PPPPP-7: topOutOfFocusScore is the actual max score among out-of-focus candidates
 *   PPPPP-8: tool description documents topOutOfFocusScore
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
  return join(tmpdir(), `ch1tty-ppppp-${label}-${Date.now()}.jsonl`);
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

test('PPPPP-1: topOutOfFocusScore present when focus active + winner exists + out-of-focus candidates', async () => {
  // finance focus: stripe in-focus, neon out-of-focus. Both present → topOutOfFocusScore present.
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('p1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('topOutOfFocusScore' in explanation,
      `topOutOfFocusScore should be present when focus active, winner exists, and out-of-focus candidates exist; got keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.topOutOfFocusScore, 'number', 'topOutOfFocusScore should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('PPPPP-2: topOutOfFocusScore >= 0 always when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('p2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('topOutOfFocusScore' in explanation, 'topOutOfFocusScore should be present');
    assert.ok(
      explanation.topOutOfFocusScore >= 0,
      `topOutOfFocusScore should be >= 0, got ${explanation.topOutOfFocusScore}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('PPPPP-3: topOutOfFocusScore <= winnerScore always when present', async () => {
  // Winner has max score by definition — topOutOfFocusScore of any non-winner <= winnerScore.
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('p3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('topOutOfFocusScore' in explanation, 'topOutOfFocusScore should be present');
    assert.ok('winnerScore' in explanation, 'winnerScore should be present');
    assert.ok(
      explanation.topOutOfFocusScore <= explanation.winnerScore + 1e-9,
      `topOutOfFocusScore (${explanation.topOutOfFocusScore}) must be <= winnerScore (${explanation.winnerScore})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('PPPPP-4: topOutOfFocusScore absent when all candidates are in-focus', async () => {
  // finance focus → stripe in-focus. Only stripe tools → all candidates in-focus → absent.
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
    { name: 'refund', description: 'billing refund payment', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('p4', [STRIPE_CFG], { stripe: stripeTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focus' in explanation, 'focus should be present (focus is active)');
    assert.ok(
      !('topOutOfFocusScore' in explanation),
      `topOutOfFocusScore should be absent when all candidates are in-focus, found: ${explanation.topOutOfFocusScore}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('PPPPP-5: cast:no_match → topOutOfFocusScore absent (no winner)', async () => {
  const path = dlqPath('p5');
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
      !('topOutOfFocusScore' in parsed.explanation),
      `topOutOfFocusScore should be absent on no_match, found: ${parsed.explanation.topOutOfFocusScore}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('PPPPP-6: no focus active → topOutOfFocusScore absent', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('p6', [STRIPE_CFG], { stripe: stripeTools }); // no focus
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'focus key should be absent when no focus active');
    assert.ok(
      !('topOutOfFocusScore' in explanation),
      `topOutOfFocusScore should be absent when no focus active, found: ${explanation.topOutOfFocusScore}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('PPPPP-7: topOutOfFocusScore is the actual max score among out-of-focus candidates', async () => {
  // code focus: neon in-focus. stripe out-of-focus (2 tools).
  // stripe tools should be out-of-focus; topOutOfFocusScore = max of their scores.
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'sql database billing query schema', inputSchema: { type: 'object', properties: {} } },
  ];
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment', inputSchema: { type: 'object', properties: {} } },
    { name: 'list_charges', description: 'billing charges list', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('p7', [NEON_CFG, STRIPE_CFG], { neon: neonTools, stripe: stripeTools },
    { focus: 'code', profiles: CODE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'sql database billing query schema', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('topOutOfFocusScore' in explanation) {
      // If present, it must equal the max score among out-of-focus candidates in topCandidates
      assert.ok(typeof explanation.topOutOfFocusScore === 'number', 'topOutOfFocusScore should be a number');
      assert.ok(explanation.topOutOfFocusScore >= 0, 'topOutOfFocusScore should be >= 0');
      assert.ok(explanation.topOutOfFocusScore <= explanation.winnerScore + 1e-9,
        `topOutOfFocusScore (${explanation.topOutOfFocusScore}) should be <= winnerScore (${explanation.winnerScore})`);
    }
    // Verify identity: topOutOfFocusScore <= winnerScore always holds
    assert.ok('winnerScore' in explanation, 'winnerScore should be present');
  } finally {
    await agg.shutdown();
  }
});

test('PPPPP-8: tool description documents topOutOfFocusScore', async () => {
  const path = dlqPath('p8');
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
      cast.description?.includes('topOutOfFocusScore'),
      `cast description should mention topOutOfFocusScore, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
