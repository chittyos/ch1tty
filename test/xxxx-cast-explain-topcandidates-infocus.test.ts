/**
 * XXXX: topCandidates[n].inFocus in ch1tty/cast explanation when explain:true and focus active.
 *
 * When a focus profile is active and explain:true is set, each entry in
 * topCandidates carries inFocus: boolean — true when the candidate is within
 * the active focus profile (received a boost), false when it is out-of-focus.
 * When no focus is active, inFocus is absent from all topCandidates entries.
 *
 * Covered:
 *   XXXX-1: explain:true + focus active → every topCandidates entry has an inFocus field
 *   XXXX-2: in-focus winner → topCandidates[0].inFocus is true
 *   XXXX-3: out-of-focus candidate → topCandidates entry has inFocus: false
 *   XXXX-4: no focus active → topCandidates entries have no inFocus field
 *   XXXX-5: cast:no_match + focus → topCandidates is empty (no error, no inFocus)
 *   XXXX-6: cast:plan (confirm:true) + focus → topCandidates entries carry inFocus
 *   XXXX-7: tool description documents topCandidates[n].inFocus
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-xxxx-${label}-${Date.now()}.jsonl`);
}

const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe Payments', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.test/mcp',
};
const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.test/mcp',
};

const STRIPE_TOOLS: ToolEntry[] = [
  { name: 'create_invoice', description: 'Create Stripe billing invoice for customer payment', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_invoices', description: 'List all Stripe billing invoices', inputSchema: { type: 'object', properties: {} } },
];
const NEON_TOOLS: ToolEntry[] = [
  { name: 'run_sql', description: 'Run SQL queries on Neon database', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_projects', description: 'List Neon database projects', inputSchema: { type: 'object', properties: {} } },
];

// finance focus: stripe is in-focus (server), neon is out-of-focus
const FOCUS_PROFILES = {
  profiles: {
    finance: { description: 'Finance tools', categories: ['ecosystem' as const], servers: ['stripe'], boost: 0.5 },
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

function buildAgg(label: string, withFocus: boolean): Aggregator {
  const backendMap: Record<string, Backend> = {
    stripe: makeBackend(STRIPE_TOOLS),
    neon: makeBackend(NEON_TOOLS),
  };
  const path = dlqPath(label);
  return new Aggregator([STRIPE_CFG, NEON_CFG], {
    backendFactory: (cfg) => backendMap[cfg.id],
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: {},
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
    ...(withFocus ? { focus: 'finance' } : {}),
  });
}

test('XXXX-1: explain:true + focus active → every topCandidates entry has an inFocus field', async () => {
  const agg = buildAgg('x1', true);
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'invoice billing', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { topCandidates } = parsed.explanation;
    assert.ok(Array.isArray(topCandidates) && topCandidates.length > 0, 'topCandidates empty');
    for (const c of topCandidates) {
      assert.ok('inFocus' in c, `topCandidates entry missing inFocus: ${JSON.stringify(c)}`);
      assert.equal(typeof c.inFocus, 'boolean', `inFocus is not boolean on ${JSON.stringify(c)}`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('XXXX-2: in-focus winner → topCandidates[0].inFocus is true', async () => {
  const agg = buildAgg('x2', true);
  try {
    // "stripe invoice" strongly matches stripe tools which are in-focus for finance
    const r = await agg.callTool('ch1tty/cast', { intent: 'stripe billing invoice', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok(['executed', 'resolved', 'plan'].includes(parsed.cast), `unexpected cast: ${parsed.cast}`);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { topCandidates } = parsed.explanation;
    assert.ok(Array.isArray(topCandidates) && topCandidates.length > 0, 'topCandidates empty');
    assert.ok(
      topCandidates[0].tool.startsWith('stripe/'),
      `expected stripe winner, got ${topCandidates[0].tool}`,
    );
    assert.equal(topCandidates[0].inFocus, true, `winner should be inFocus:true, got ${topCandidates[0].inFocus}`);
  } finally {
    await agg.shutdown();
  }
});

test('XXXX-3: out-of-focus candidate → topCandidates entry has inFocus: false', async () => {
  const agg = buildAgg('x3', true);
  try {
    // "sql database" strongly matches neon (code category, out-of-focus for finance)
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql database query', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { topCandidates } = parsed.explanation as { topCandidates: { tool: string; score: number; inFocus: boolean }[] };
    assert.ok(Array.isArray(topCandidates) && topCandidates.length > 0, 'topCandidates empty');
    const neonEntry = topCandidates.find((c) => c.tool.startsWith('neon/'));
    assert.ok(neonEntry !== undefined, `no neon candidate in topCandidates: ${JSON.stringify(topCandidates)}`);
    assert.equal(neonEntry.inFocus, false, `neon entry should be inFocus:false (out-of-focus for finance), got ${neonEntry.inFocus}`);
  } finally {
    await agg.shutdown();
  }
});

test('XXXX-4: no focus active → topCandidates entries have no inFocus field', async () => {
  const agg = buildAgg('x4', false);
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { topCandidates } = parsed.explanation;
    assert.ok(Array.isArray(topCandidates) && topCandidates.length > 0, 'topCandidates empty');
    for (const c of topCandidates) {
      assert.ok(!('inFocus' in c), `topCandidates entry should NOT have inFocus when no focus: ${JSON.stringify(c)}`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('XXXX-5: cast:no_match + focus → topCandidates is empty (no error, no inFocus)', async () => {
  const path = dlqPath('x5');
  const emptyAgg = new Aggregator([STRIPE_CFG], {
    backendFactory: () => makeBackend([]),
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: {},
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
    focus: 'finance',
  });
  try {
    const r = await emptyAgg.callTool('ch1tty/cast', { intent: 'xyzzy-nonexistent-zzz', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'no_match', `expected no_match, got ${parsed.cast}`);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { topCandidates } = parsed.explanation;
    assert.ok(Array.isArray(topCandidates), 'topCandidates should be an array');
    assert.equal(topCandidates.length, 0, `topCandidates should be empty on no_match, got ${topCandidates.length}`);
  } finally {
    await emptyAgg.shutdown();
  }
});

test('XXXX-6: cast:plan (confirm:true) + focus → topCandidates entries carry inFocus', async () => {
  const agg = buildAgg('x6', true);
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'stripe invoice billing', confirm: true, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'plan', `expected plan, got ${parsed.cast}`);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { topCandidates } = parsed.explanation;
    assert.ok(Array.isArray(topCandidates) && topCandidates.length > 0, 'topCandidates empty');
    for (const c of topCandidates) {
      assert.ok('inFocus' in c, `plan topCandidates entry missing inFocus: ${JSON.stringify(c)}`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('XXXX-7: tool description documents topCandidates[n].inFocus', async () => {
  const path = dlqPath('x7');
  const agg = new Aggregator([STRIPE_CFG], {
    backendFactory: () => makeBackend(STRIPE_TOOLS),
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: {},
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
  });
  try {
    const { tools } = await agg.listAllTools();
    const cast = tools.find((t) => t.name === 'ch1tty/cast');
    assert.ok(cast, 'ch1tty/cast tool not found');
    assert.ok(
      cast.description?.includes('inFocus'),
      `cast description should mention inFocus, got: ${cast.description?.slice(0, 300)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
