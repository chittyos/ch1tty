/**
 * NNNNN: explanation.inFocusFraction in ch1tty/cast when explain:true and focus is active.
 *
 * inFocusFraction: number — fraction of scored candidates that are in-focus
 * (candidatesInFocusCount / candidateCount), in [0,1].
 *
 * Present when: focus profile active + winner exists + candidateCount > 0.
 * Absent when: no focus active, no_match (no winner), or candidateCount === 0.
 *
 * Value: 0 when no candidates are in-focus; 1 when all candidates are in-focus.
 * Identity: inFocusFraction === candidatesInFocusCount / candidateCount always.
 *
 * Covered:
 *   NNNNN-1: inFocusFraction present when focus active + winner exists
 *   NNNNN-2: inFocusFraction in [0,1] always when present
 *   NNNNN-3: inFocusFraction === candidatesInFocusCount / candidateCount (identity)
 *   NNNNN-4: inFocusFraction === 0 when all candidates are out-of-focus
 *   NNNNN-5: inFocusFraction === 1 when all candidates are in-focus
 *   NNNNN-6: absent on cast:no_match (no winner)
 *   NNNNN-7: absent when no focus profile is active
 *   NNNNN-8: tool description documents inFocusFraction
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
  return join(tmpdir(), `ch1tty-nnnnn-${label}-${Date.now()}.jsonl`);
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

test('NNNNN-1: inFocusFraction present when focus active + winner exists', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('n1', [STRIPE_CFG], { stripe: stripeTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('inFocusFraction' in explanation,
      `inFocusFraction should be present when focus active and winner exists; got keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.inFocusFraction, 'number', 'inFocusFraction should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('NNNNN-2: inFocusFraction in [0,1] always when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('n2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('inFocusFraction' in explanation, 'inFocusFraction should be present');
    assert.ok(
      explanation.inFocusFraction >= 0 && explanation.inFocusFraction <= 1,
      `inFocusFraction should be in [0,1], got ${explanation.inFocusFraction}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('NNNNN-3: inFocusFraction === candidatesInFocusCount / candidateCount (identity)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('n3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('inFocusFraction' in explanation, 'inFocusFraction should be present');
    assert.ok('candidatesInFocusCount' in explanation, 'candidatesInFocusCount should be present');
    assert.ok('candidateCount' in explanation, 'candidateCount should be present');
    assert.ok(explanation.candidateCount > 0, 'candidateCount must be > 0 for identity to apply');
    const expected = explanation.candidatesInFocusCount / explanation.candidateCount;
    assert.ok(
      Math.abs(explanation.inFocusFraction - expected) < 1e-9,
      `inFocusFraction (${explanation.inFocusFraction}) must equal candidatesInFocusCount/candidateCount (${expected})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('NNNNN-4: inFocusFraction === 0 when all candidates are out-of-focus', async () => {
  // code focus → neon in-focus; stripe out-of-focus.
  // Only stripe tools — all candidates out-of-focus → inFocusFraction === 0.
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge fee', inputSchema: { type: 'object', properties: {} } },
    { name: 'refund', description: 'billing refund payment charge fee', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('n4', [STRIPE_CFG], { stripe: stripeTools },
    { focus: 'code', profiles: CODE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge fee', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('inFocusFraction' in explanation, 'inFocusFraction should be present with active focus');
    assert.ok(
      Math.abs(explanation.inFocusFraction - 0) < 1e-9,
      `all candidates out-of-focus → inFocusFraction should be 0, got ${explanation.inFocusFraction}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('NNNNN-5: inFocusFraction === 1 when all candidates are in-focus', async () => {
  // finance focus → stripe (ecosystem) in-focus. Only stripe tools → all in-focus → fraction === 1.
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
    { name: 'refund', description: 'refund payment transaction', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('n5', [STRIPE_CFG], { stripe: stripeTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('inFocusFraction' in explanation, 'inFocusFraction should be present');
    assert.ok(
      Math.abs(explanation.inFocusFraction - 1) < 1e-9,
      `all candidates in-focus (stripe only, finance focus) → inFocusFraction should be 1, got ${explanation.inFocusFraction}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('NNNNN-6: cast:no_match → inFocusFraction absent (no winner)', async () => {
  const path = dlqPath('n6');
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
      !('inFocusFraction' in parsed.explanation),
      `inFocusFraction should be absent on no_match, found: ${parsed.explanation.inFocusFraction}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('NNNNN-7: no focus active → inFocusFraction absent', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('n7', [STRIPE_CFG], { stripe: stripeTools }); // no focus
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'focus key should be absent when no focus active');
    assert.ok(
      !('inFocusFraction' in explanation),
      `inFocusFraction should be absent when no focus active, found: ${explanation.inFocusFraction}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('NNNNN-8: tool description documents inFocusFraction', async () => {
  const path = dlqPath('n8');
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
      cast.description?.includes('inFocusFraction'),
      `cast description should mention inFocusFraction, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
