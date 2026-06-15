/**
 * BBBBB: latencyBreakdown.registryMs in cast:executed and cast:chain_executed.
 *
 * registryMs isolates the wall-clock time of the parallel registry/prompts/resources
 * fetch from the total scoringMs. It is always present on the two cast shapes that
 * call backends (executed, chain_executed); absent on shapes that never reach the
 * registry fetch (plan, no_match in the "no intent" fast-path) — actually no_match
 * still runs the registry fetch, so it will NOT have latencyBreakdown at all since
 * no_match doesn't include latencyBreakdown (confirmed by NNNN-7).
 *
 * registryMs is a sub-component of scoringMs:
 *   registryMs ≤ scoringMs (registry fetch is strictly contained within scoring phase)
 *   registryMs ≥ 0 always
 *
 * Covered:
 *   BBBBB-1: cast:executed → latencyBreakdown.registryMs is a number ≥ 0
 *   BBBBB-2: cast:executed → registryMs ≤ scoringMs
 *   BBBBB-3: cast:chain_executed → latencyBreakdown.registryMs is a number ≥ 0
 *   BBBBB-4: cast:chain_executed → registryMs ≤ scoringMs
 *   BBBBB-5: cast:plan (confirm:true) → no latencyBreakdown (registryMs absent)
 *   BBBBB-6: cast:no_match → no latencyBreakdown (registryMs absent)
 *   BBBBB-7: second cast:executed → registryMs ≥ 0 (cached registry still measured)
 *   BBBBB-8: tool description documents registryMs
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-bbbbb-${label}-${Date.now()}.jsonl`);
}

const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.test/mcp',
};
const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe Payments', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.test/mcp',
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

const NEON_TOOLS: ToolEntry[] = [
  { name: 'run_sql', description: 'Run SQL queries on Neon database', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_projects', description: 'List Neon projects', inputSchema: { type: 'object', properties: {} } },
];
const STRIPE_TOOLS: ToolEntry[] = [
  { name: 'create_invoice', description: 'Create Stripe invoice for billing', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_customers', description: 'List Stripe customers', inputSchema: { type: 'object', properties: {} } },
];

const FOCUS_PROFILES = {
  profiles: {
    finance: { description: 'Finance tools', categories: ['ecosystem' as const], servers: ['stripe'], boost: 0.5 },
  },
};

const BASE_CATALOG = {
  finance: {
    combos: [
      {
        name: 'invoice-then-list',
        chain: ['stripe/create_invoice', 'stripe/list_customers'],
        accomplishes: 'Create invoice then list customers',
      },
    ],
    prompts: [],
  },
};

function buildAgg(): Aggregator {
  const neonBackend = makeBackend(NEON_TOOLS);
  const stripeBackend = makeBackend(STRIPE_TOOLS);
  const backendMap: Record<string, Backend> = { neon: neonBackend, stripe: stripeBackend };
  return new Aggregator([NEON_CFG, STRIPE_CFG], {
    backendFactory: (cfg) => backendMap[cfg.id] ?? neonBackend,
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: BASE_CATALOG,
    ledgerDlqPath: dlqPath('agg'),
  });
}

test('BBBBB-1: cast:executed → latencyBreakdown.registryMs is a number ≥ 0', async () => {
  const agg = buildAgg();
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query on database' });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'executed');
    assert.ok('latencyBreakdown' in parsed, 'latencyBreakdown absent from cast:executed');
    assert.equal(typeof parsed.latencyBreakdown.registryMs, 'number', 'registryMs is not a number');
    assert.ok(parsed.latencyBreakdown.registryMs >= 0, `registryMs ${parsed.latencyBreakdown.registryMs} < 0`);
  } finally {
    await agg.shutdown();
  }
});

test('BBBBB-2: cast:executed → registryMs ≤ scoringMs', async () => {
  const agg = buildAgg();
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query on database' });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'executed');
    const { registryMs, scoringMs } = parsed.latencyBreakdown;
    assert.ok(
      registryMs <= scoringMs,
      `registryMs(${registryMs}) > scoringMs(${scoringMs}) — registry fetch should be contained within scoring phase`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('BBBBB-3: cast:chain_executed → latencyBreakdown.registryMs is a number ≥ 0', async () => {
  const agg = buildAgg();
  try {
    const r = await agg.callTool('ch1tty/cast', {
      intent: 'create stripe invoice',
      focus: 'finance',
      chain: true,
    });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'chain_executed', `expected chain_executed, got ${parsed.cast}`);
    assert.ok('latencyBreakdown' in parsed, 'latencyBreakdown absent from cast:chain_executed');
    assert.equal(typeof parsed.latencyBreakdown.registryMs, 'number', 'registryMs is not a number');
    assert.ok(parsed.latencyBreakdown.registryMs >= 0, `registryMs ${parsed.latencyBreakdown.registryMs} < 0`);
  } finally {
    await agg.shutdown();
  }
});

test('BBBBB-4: cast:chain_executed → registryMs ≤ scoringMs', async () => {
  const agg = buildAgg();
  try {
    const r = await agg.callTool('ch1tty/cast', {
      intent: 'create stripe invoice',
      focus: 'finance',
      chain: true,
    });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'chain_executed', `expected chain_executed, got ${parsed.cast}`);
    const { registryMs, scoringMs } = parsed.latencyBreakdown;
    assert.ok(
      registryMs <= scoringMs,
      `registryMs(${registryMs}) > scoringMs(${scoringMs}) — registry fetch should be contained within scoring phase`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('BBBBB-5: cast:plan (confirm:true) → no latencyBreakdown (registryMs absent)', async () => {
  const agg = buildAgg();
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query on database', confirm: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'plan');
    assert.ok(!('latencyBreakdown' in parsed), 'latencyBreakdown should not be present on cast:plan');
    assert.ok('latencyMs' in parsed, 'latencyMs should still be present on cast:plan');
  } finally {
    await agg.shutdown();
  }
});

test('BBBBB-6: cast:no_match → no latencyBreakdown (registryMs absent)', async () => {
  const agg = buildAgg();
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'xyzzy frobnicate quux' });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'no_match');
    assert.ok(!('latencyBreakdown' in parsed), 'latencyBreakdown should not be present on cast:no_match');
  } finally {
    await agg.shutdown();
  }
});

test('BBBBB-7: second cast:executed → registryMs ≥ 0 (cached registry still measured)', async () => {
  const agg = buildAgg();
  try {
    // First call warms the registry cache
    await agg.callTool('ch1tty/cast', { intent: 'run sql query on database' });
    // Second call hits the cache — registryMs should still be present and ≥ 0
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query on database' });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'executed');
    assert.equal(typeof parsed.latencyBreakdown.registryMs, 'number', 'registryMs is not a number on cached call');
    assert.ok(parsed.latencyBreakdown.registryMs >= 0, `registryMs ${parsed.latencyBreakdown.registryMs} < 0 on cached call`);
  } finally {
    await agg.shutdown();
  }
});

test('BBBBB-8: tool description documents registryMs', async () => {
  const agg = buildAgg();
  try {
    const { tools } = await agg.listAllTools();
    const castTool = tools.find((t) => t.name === 'ch1tty/cast');
    assert.ok(castTool, 'ch1tty/cast not found in tool list');
    assert.ok(
      castTool.description?.includes('registryMs'),
      `ch1tty/cast description does not mention registryMs. Got: ${castTool.description?.slice(0, 300)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
