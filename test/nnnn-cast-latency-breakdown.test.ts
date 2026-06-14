/**
 * NNNN: latencyBreakdown in cast:executed and cast:chain_executed.
 *
 * The two cast shapes that call backends now carry a latencyBreakdown field
 * alongside latencyMs, splitting total elapsed time into:
 *   - scoringMs: time from intent submission to before the first backend call
 *     (covers registry fetch + brain routing + keyword scoring + focus bias)
 *   - executionMs: time spent inside handleExecute (single-step or chain total)
 *
 * Shapes that do not call a backend (plan, resolved, discovered, no_match) do
 * NOT include latencyBreakdown — for them latencyMs is the complete story.
 *
 * Covered:
 *   NNNN-1: cast:executed → latencyBreakdown.scoringMs is a number ≥ 0
 *   NNNN-2: cast:executed → latencyBreakdown.executionMs is a number ≥ 0
 *   NNNN-3: cast:executed → scoringMs + executionMs ≤ latencyMs + 5ms tolerance
 *   NNNN-4: cast:chain_executed → latencyBreakdown.scoringMs is a number ≥ 0
 *   NNNN-5: cast:chain_executed → latencyBreakdown.executionMs is a number ≥ 0
 *   NNNN-6: cast:plan (confirm:true) → no latencyBreakdown field
 *   NNNN-7: cast:no_match → no latencyBreakdown field
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-nnnn-${label}-${Date.now()}.jsonl`);
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

test('NNNN-1: cast:executed → latencyBreakdown.scoringMs is a number ≥ 0', async () => {
  const agg = buildAgg();
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query on database' });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'executed');
    assert.ok('latencyBreakdown' in parsed, 'latencyBreakdown absent from cast:executed');
    assert.equal(typeof parsed.latencyBreakdown.scoringMs, 'number', 'scoringMs is not a number');
    assert.ok(parsed.latencyBreakdown.scoringMs >= 0, `scoringMs ${parsed.latencyBreakdown.scoringMs} < 0`);
  } finally {
    await agg.shutdown();
  }
});

test('NNNN-2: cast:executed → latencyBreakdown.executionMs is a number ≥ 0', async () => {
  const agg = buildAgg();
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query on database' });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'executed');
    assert.equal(typeof parsed.latencyBreakdown.executionMs, 'number', 'executionMs is not a number');
    assert.ok(parsed.latencyBreakdown.executionMs >= 0, `executionMs ${parsed.latencyBreakdown.executionMs} < 0`);
  } finally {
    await agg.shutdown();
  }
});

test('NNNN-3: cast:executed → scoringMs + executionMs ≤ latencyMs + 5ms tolerance', async () => {
  const agg = buildAgg();
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query on database' });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'executed');
    const { scoringMs, executionMs } = parsed.latencyBreakdown;
    const { latencyMs } = parsed;
    // scoringMs is captured before execStartMs, executionMs captured before the final Date.now()
    // in the latencyMs expression — a small gap (a few µs) means sum can slightly exceed latencyMs
    assert.ok(
      scoringMs + executionMs <= latencyMs + 5,
      `scoringMs(${scoringMs}) + executionMs(${executionMs}) = ${scoringMs + executionMs} > latencyMs(${latencyMs}) + 5`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('NNNN-4: cast:chain_executed → latencyBreakdown.scoringMs is a number ≥ 0', async () => {
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
    assert.equal(typeof parsed.latencyBreakdown.scoringMs, 'number', 'scoringMs is not a number');
    assert.ok(parsed.latencyBreakdown.scoringMs >= 0, `scoringMs ${parsed.latencyBreakdown.scoringMs} < 0`);
  } finally {
    await agg.shutdown();
  }
});

test('NNNN-5: cast:chain_executed → latencyBreakdown.executionMs is a number ≥ 0', async () => {
  const agg = buildAgg();
  try {
    const r = await agg.callTool('ch1tty/cast', {
      intent: 'create stripe invoice',
      focus: 'finance',
      chain: true,
    });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'chain_executed', `expected chain_executed, got ${parsed.cast}`);
    assert.equal(typeof parsed.latencyBreakdown.executionMs, 'number', 'executionMs is not a number');
    assert.ok(parsed.latencyBreakdown.executionMs >= 0, `executionMs ${parsed.latencyBreakdown.executionMs} < 0`);
  } finally {
    await agg.shutdown();
  }
});

test('NNNN-6: cast:plan (confirm:true) → no latencyBreakdown field', async () => {
  const agg = buildAgg();
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query on database', confirm: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'plan');
    assert.ok(!('latencyBreakdown' in parsed), 'latencyBreakdown should not be present on cast:plan');
    assert.ok('latencyMs' in parsed, 'latencyMs still present');
  } finally {
    await agg.shutdown();
  }
});

test('NNNN-7: cast:no_match → no latencyBreakdown field', async () => {
  const agg = buildAgg();
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'xyzzy frobnicate quux' });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'no_match');
    assert.ok(!('latencyBreakdown' in parsed), 'latencyBreakdown should not be present on cast:no_match');
    assert.ok('latencyMs' in parsed, 'latencyMs still present');
  } finally {
    await agg.shutdown();
  }
});
