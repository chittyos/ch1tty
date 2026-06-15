/**
 * ZZZZZ: explanation.outOfFocusCandidatesCount in ch1tty/cast when explain:true.
 *
 * outOfFocusCandidatesCount: number — count of scored candidates whose server
 * and category do not match the active focus profile.
 *
 * Present when: focus active + winner exists (same conditions as candidatesInFocusCount).
 * Absent when: no focus active, or cast:no_match.
 * Identity: candidatesInFocusCount + outOfFocusCandidatesCount === candidateCount.
 *
 * Covered:
 *   ZZZZZ-1: outOfFocusCandidatesCount present when focus active + winner exists
 *   ZZZZZ-2: outOfFocusCandidatesCount is a number >= 0
 *   ZZZZZ-3: candidatesInFocusCount + outOfFocusCandidatesCount === candidateCount
 *   ZZZZZ-4: outOfFocusCandidatesCount absent on cast:no_match
 *   ZZZZZ-5: outOfFocusCandidatesCount absent when no focus active
 *   ZZZZZ-6: outOfFocusCandidatesCount === 0 when all candidates are in-focus
 *   ZZZZZ-7: outOfFocusCandidatesCount === candidateCount when no candidates are in-focus
 *   ZZZZZ-8: tool description documents outOfFocusCandidatesCount
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
  return join(tmpdir(), `ch1tty-zzzzz-${label}-${Date.now()}.jsonl`);
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

// Code focus: only neon (code) is in-focus
const CODE_PROFILES: FocusProfiles = {
  profiles: {
    code: { description: 'Code tools', categories: ['code'], servers: ['neon'], boost: 0.5 },
  },
};

// All-focus profile: both categories in-focus
const ALL_PROFILES: FocusProfiles = {
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

test('ZZZZZ-1: outOfFocusCandidatesCount present when focus active + winner exists', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('focus' in explanation, 'focus should be active');
    assert.ok('winnerScore' in explanation, 'winnerScore should be present (winner exists)');
    assert.ok('outOfFocusCandidatesCount' in explanation,
      `outOfFocusCandidatesCount should be present when focus active + winner; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.outOfFocusCandidatesCount, 'number', 'outOfFocusCandidatesCount should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZZ-2: outOfFocusCandidatesCount is a number >= 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('outOfFocusCandidatesCount' in explanation, 'outOfFocusCandidatesCount should be present');
    assert.ok(
      explanation.outOfFocusCandidatesCount >= 0,
      `outOfFocusCandidatesCount should be >= 0, got ${explanation.outOfFocusCandidatesCount}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZZ-3: candidatesInFocusCount + outOfFocusCandidatesCount === candidateCount', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('outOfFocusCandidatesCount' in explanation, 'outOfFocusCandidatesCount should be present');
    assert.ok('candidatesInFocusCount' in explanation, 'candidatesInFocusCount should be present');
    assert.equal(
      explanation.candidatesInFocusCount + explanation.outOfFocusCandidatesCount,
      explanation.candidateCount,
      `identity violated: ${explanation.candidatesInFocusCount} + ${explanation.outOfFocusCandidatesCount} !== ${explanation.candidateCount}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZZ-4: outOfFocusCandidatesCount absent on cast:no_match', async () => {
  const path = dlqPath('z4');
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
      !('outOfFocusCandidatesCount' in parsed.explanation),
      `outOfFocusCandidatesCount should be absent on no_match, found: ${parsed.explanation.outOfFocusCandidatesCount}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('ZZZZZ-5: outOfFocusCandidatesCount absent when no focus active', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z5', [STRIPE_CFG], { stripe: stripeTools }); // no focus
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok(
      !('outOfFocusCandidatesCount' in explanation),
      `outOfFocusCandidatesCount should be absent without focus, found: ${explanation.outOfFocusCandidatesCount}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZZ-6: outOfFocusCandidatesCount === 0 when all candidates are in-focus', async () => {
  // all-focus profile covers both ecosystem + code, so both stripe + neon are in-focus
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z6', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'all', profiles: ALL_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focus' in explanation, 'focus should be active');
    assert.ok('outOfFocusCandidatesCount' in explanation, 'outOfFocusCandidatesCount should be present');
    assert.equal(
      explanation.outOfFocusCandidatesCount, 0,
      `outOfFocusCandidatesCount should be 0 when all candidates in-focus, got ${explanation.outOfFocusCandidatesCount}`,
    );
    assert.equal(
      explanation.candidatesInFocusCount, explanation.candidateCount,
      'all candidates should be in-focus',
    );
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZZ-7: outOfFocusCandidatesCount === candidateCount when no candidates are in-focus', async () => {
  // code focus covers only 'code' category, but stripe is 'ecosystem' — all candidates out-of-focus
  // when stripe is the only server
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z7', [STRIPE_CFG], { stripe: stripeTools },
    { focus: 'code', profiles: CODE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focus' in explanation, 'focus should be active');
    assert.ok('outOfFocusCandidatesCount' in explanation, 'outOfFocusCandidatesCount should be present');
    assert.equal(
      explanation.outOfFocusCandidatesCount, explanation.candidateCount,
      `outOfFocusCandidatesCount (${explanation.outOfFocusCandidatesCount}) should equal candidateCount (${explanation.candidateCount}) when no candidates in-focus`,
    );
    assert.equal(explanation.candidatesInFocusCount, 0, 'candidatesInFocusCount should be 0');
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZZ-8: tool description documents outOfFocusCandidatesCount', async () => {
  const path = dlqPath('z8');
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
      cast.description?.includes('outOfFocusCandidatesCount'),
      `cast description should mention outOfFocusCandidatesCount, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
