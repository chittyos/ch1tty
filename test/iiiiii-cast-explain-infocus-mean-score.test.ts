/**
 * IIIIII: explanation.inFocusMeanScore in ch1tty/cast when explain:true.
 *
 * inFocusMeanScore: number — arithmetic mean relevance score of all in-focus candidates.
 *
 * Present when: focus active + winner exists + at least one in-focus candidate.
 * Absent when: no focus active, cast:no_match, or no in-focus candidates exist.
 * Identity: inFocusMeanScore <= inFocusTopScore always holds.
 *
 * Covered:
 *   IIIIII-1: inFocusMeanScore present when focus active + winner + in-focus candidates exist
 *   IIIIII-2: inFocusMeanScore is a number in [0, inFocusTopScore]
 *   IIIIII-3: inFocusMeanScore equals inFocusTopScore when only one in-focus candidate
 *   IIIIII-4: inFocusMeanScore absent on cast:no_match
 *   IIIIII-5: inFocusMeanScore absent when no focus active
 *   IIIIII-6: inFocusMeanScore absent when no candidates are in-focus
 *   IIIIII-7: inFocusMeanScore computed correctly across multiple in-focus candidates
 *   IIIIII-8: tool description documents inFocusMeanScore
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
  return join(tmpdir(), `ch1tty-iiiiii-${label}-${Date.now()}.jsonl`);
}

const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe Payments', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.test/mcp',
};
const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.test/mcp',
};
const NOTION_CFG: ServerConfig = {
  id: 'notion', name: 'Notion', type: 'remote', access: 'readwrite',
  category: 'documents', endpoint: 'https://notion.test/mcp',
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

// Docs focus: covers only 'documents' category
const DOCS_PROFILES: FocusProfiles = {
  profiles: {
    docs: { description: 'Document tools', categories: ['documents'], servers: ['notion'], boost: 0.5 },
  },
};

// Multi-ecosystem focus: stripe + neon both in-focus
const MULTI_PROFILES: FocusProfiles = {
  profiles: {
    multi: { description: 'Ecosystem + code', categories: ['ecosystem', 'code'], servers: [], boost: 0.5 },
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

test('IIIIII-1: inFocusMeanScore present when focus active + winner + in-focus candidates exist', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('i1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('focus' in explanation, 'focus should be active');
    assert.ok('winnerScore' in explanation, 'winnerScore should be present');
    assert.ok('inFocusMeanScore' in explanation,
      `inFocusMeanScore should be present when focus active + winner + in-focus candidates; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.inFocusMeanScore, 'number', 'inFocusMeanScore should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('IIIIII-2: inFocusMeanScore is a number in [0, inFocusTopScore]', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('i2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('inFocusMeanScore' in explanation, 'inFocusMeanScore should be present');
    assert.ok('inFocusTopScore' in explanation, 'inFocusTopScore should be present');
    assert.ok(
      explanation.inFocusMeanScore >= 0,
      `inFocusMeanScore should be >= 0, got ${explanation.inFocusMeanScore}`,
    );
    assert.ok(
      explanation.inFocusMeanScore <= explanation.inFocusTopScore + 1e-9,
      `inFocusMeanScore (${explanation.inFocusMeanScore}) should be <= inFocusTopScore (${explanation.inFocusTopScore})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('IIIIII-3: inFocusMeanScore equals inFocusTopScore when only one in-focus candidate', async () => {
  // finance focus: only stripe (ecosystem). stripe has exactly one tool.
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'database query sql', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('i3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('inFocusMeanScore' in explanation, 'inFocusMeanScore should be present');
    assert.ok('inFocusTopScore' in explanation, 'inFocusTopScore should be present');
    // stripe has 1 tool → candidatesInFocusCount should be 1
    assert.equal(explanation.candidatesInFocusCount, 1, 'should have exactly 1 in-focus candidate');
    assert.ok(
      Math.abs(explanation.inFocusMeanScore - explanation.inFocusTopScore) < 1e-9,
      `inFocusMeanScore (${explanation.inFocusMeanScore}) should equal inFocusTopScore (${explanation.inFocusTopScore}) with 1 in-focus candidate`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('IIIIII-4: inFocusMeanScore absent on cast:no_match', async () => {
  const path = dlqPath('i4');
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
      !('inFocusMeanScore' in parsed.explanation),
      `inFocusMeanScore should be absent on no_match, found: ${parsed.explanation.inFocusMeanScore}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('IIIIII-5: inFocusMeanScore absent when no focus active', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('i5', [STRIPE_CFG], { stripe: stripeTools }); // no focus
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok(
      !('inFocusMeanScore' in explanation),
      `inFocusMeanScore should be absent without focus, found: ${explanation.inFocusMeanScore}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('IIIIII-6: inFocusMeanScore absent when no candidates are in-focus', async () => {
  // code focus covers 'code' category, but stripe is 'ecosystem' → all candidates out-of-focus
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('i6', [STRIPE_CFG], { stripe: stripeTools },
    { focus: 'code', profiles: CODE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focus' in explanation, 'focus should be active');
    assert.equal(explanation.candidatesInFocusCount, 0, 'no candidates should be in-focus');
    assert.ok(
      !('inFocusMeanScore' in explanation),
      `inFocusMeanScore should be absent when no in-focus candidates, found: ${explanation.inFocusMeanScore}`,
    );
    assert.ok(
      !('inFocusTopScore' in explanation),
      'inFocusTopScore should also be absent when no in-focus candidates',
    );
  } finally {
    await agg.shutdown();
  }
});

test('IIIIII-7: inFocusMeanScore computed correctly across multiple in-focus candidates', async () => {
  // multi focus covers ecosystem + code, so both stripe + neon are in-focus.
  // Two tools both matching "billing database query" — scores should be computable.
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge database', inputSchema: { type: 'object', properties: {} } },
    { name: 'list_charges', description: 'billing payment charge query list', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing database query sql', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('i7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'multi', profiles: MULTI_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing payment database charge query', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('inFocusMeanScore' in explanation, 'inFocusMeanScore should be present');
    assert.ok('inFocusTopScore' in explanation, 'inFocusTopScore should be present');
    assert.ok('candidatesInFocusCount' in explanation, 'candidatesInFocusCount should be present');
    // All 3 tools (stripe×2 + neon×1) are in-focus under multi profile
    assert.ok(explanation.candidatesInFocusCount >= 2, 'at least 2 in-focus candidates expected');
    // Mean must be <= top score
    assert.ok(
      explanation.inFocusMeanScore <= explanation.inFocusTopScore + 1e-9,
      `inFocusMeanScore (${explanation.inFocusMeanScore}) must be <= inFocusTopScore (${explanation.inFocusTopScore})`,
    );
    assert.ok(
      explanation.inFocusMeanScore >= 0,
      `inFocusMeanScore should be >= 0, got ${explanation.inFocusMeanScore}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('IIIIII-8: tool description documents inFocusMeanScore', async () => {
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
      cast.description?.includes('inFocusMeanScore'),
      `cast description should mention inFocusMeanScore, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
