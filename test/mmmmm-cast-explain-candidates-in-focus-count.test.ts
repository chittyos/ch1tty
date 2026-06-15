/**
 * MMMMM: explanation.candidatesInFocusCount in ch1tty/cast when explain:true and focus is active.
 *
 * candidatesInFocusCount: number — count of scored candidates whose server or category
 * matches the active focus profile (out of candidateCount total).
 *
 * Present when: focus profile active + winner exists (same conditions as winnerFocusBoost).
 * Absent when: no focus active, or no_match (no winner).
 *
 * Value: 0 when no candidates are in-focus; equal to candidateCount when all are in-focus.
 * Combined with candidateCount gives the in-focus density at query time.
 *
 * Covered:
 *   MMMMM-1: candidatesInFocusCount present when focus active + winner exists
 *   MMMMM-2: candidatesInFocusCount >= 0 always when present
 *   MMMMM-3: candidatesInFocusCount <= candidateCount always when present
 *   MMMMM-4: candidatesInFocusCount === 0 when all candidates are out-of-focus
 *   MMMMM-5: candidatesInFocusCount === candidateCount when all candidates are in-focus
 *   MMMMM-6: absent on cast:no_match (no winner)
 *   MMMMM-7: absent when no focus profile is active
 *   MMMMM-8: tool description documents candidatesInFocusCount
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
  return join(tmpdir(), `ch1tty-mmmmm-${label}-${Date.now()}.jsonl`);
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

// All-focus profile: both stripe and neon in-focus (by category)
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

test('MMMMM-1: candidatesInFocusCount present when focus active + winner exists', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('m1', [STRIPE_CFG], { stripe: stripeTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('candidatesInFocusCount' in explanation,
      `candidatesInFocusCount should be present when focus active and winner exists; got keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.candidatesInFocusCount, 'number', 'candidatesInFocusCount should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('MMMMM-2: candidatesInFocusCount >= 0 always when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('m2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('candidatesInFocusCount' in explanation, 'candidatesInFocusCount should be present');
    assert.ok(
      explanation.candidatesInFocusCount >= 0,
      `candidatesInFocusCount should be >= 0, got ${explanation.candidatesInFocusCount}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('MMMMM-3: candidatesInFocusCount <= candidateCount always when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('m3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('candidatesInFocusCount' in explanation, 'candidatesInFocusCount should be present');
    assert.ok('candidateCount' in explanation, 'candidateCount should be present');
    assert.ok(
      explanation.candidatesInFocusCount <= explanation.candidateCount,
      `candidatesInFocusCount (${explanation.candidatesInFocusCount}) must be <= candidateCount (${explanation.candidateCount})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('MMMMM-4: candidatesInFocusCount === 0 when all candidates are out-of-focus', async () => {
  // code focus → neon in-focus; stripe out-of-focus.
  // Only stripe tools present — all candidates are out-of-focus → count === 0.
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge fee', inputSchema: { type: 'object', properties: {} } },
    { name: 'refund', description: 'billing refund payment charge fee', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('m4', [STRIPE_CFG], { stripe: stripeTools },
    { focus: 'code', profiles: CODE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge fee', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('candidatesInFocusCount' in explanation, 'candidatesInFocusCount should be present with active focus');
    assert.equal(
      explanation.candidatesInFocusCount,
      0,
      `all candidates are out-of-focus (stripe only, code focus), expected 0, got ${explanation.candidatesInFocusCount}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('MMMMM-5: candidatesInFocusCount === candidateCount when all candidates are in-focus', async () => {
  // finance focus → stripe (ecosystem) in-focus.
  // Only stripe tools present — all candidates are in-focus → count === candidateCount.
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
    { name: 'refund', description: 'refund payment transaction', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('m5', [STRIPE_CFG], { stripe: stripeTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('candidatesInFocusCount' in explanation, 'candidatesInFocusCount should be present');
    assert.ok('candidateCount' in explanation, 'candidateCount should be present');
    assert.equal(
      explanation.candidatesInFocusCount,
      explanation.candidateCount,
      `all candidates are in-focus (stripe only, finance focus), expected candidatesInFocusCount === candidateCount (${explanation.candidateCount}), got ${explanation.candidatesInFocusCount}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('MMMMM-6: cast:no_match → candidatesInFocusCount absent (no winner)', async () => {
  const path = dlqPath('m6');
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
      !('candidatesInFocusCount' in parsed.explanation),
      `candidatesInFocusCount should be absent on no_match, found: ${parsed.explanation.candidatesInFocusCount}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('MMMMM-7: no focus active → candidatesInFocusCount absent', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('m7', [STRIPE_CFG], { stripe: stripeTools }); // no focus
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'focus key should be absent when no focus active');
    assert.ok(
      !('candidatesInFocusCount' in explanation),
      `candidatesInFocusCount should be absent when no focus active, found: ${explanation.candidatesInFocusCount}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('MMMMM-8: tool description documents candidatesInFocusCount', async () => {
  const path = dlqPath('m8');
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
      cast.description?.includes('candidatesInFocusCount'),
      `cast description should mention candidatesInFocusCount, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
