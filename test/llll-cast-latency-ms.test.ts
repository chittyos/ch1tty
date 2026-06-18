/**
 * LLLL: latencyMs in all ch1tty/cast response types.
 *
 * Every cast response (executed, plan, resolved, discovered, no_match,
 * chain_executed) now carries latencyMs: number — the wall-clock elapsed time
 * in milliseconds from intent submission to response, covering scoring +
 * execution. The field is always present on success paths; the error response
 * (missing intent) is excluded since no work was done.
 *
 * Covered:
 *   LLLL-1: cast:executed → latencyMs present and ≥ 0
 *   LLLL-2: cast:plan (confirm:true) → latencyMs present and ≥ 0
 *   LLLL-3: cast:resolved (dryRun:true) → latencyMs present and ≥ 0
 *   LLLL-4: cast:discovered (only prompts match) → latencyMs present and ≥ 0
 *   LLLL-5: cast:no_match (nothing matches) → latencyMs present and ≥ 0
 *   LLLL-6: cast:chain_executed → latencyMs present and ≥ 0
 *   LLLL-7: missing intent (error path) → no latencyMs
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-llll-${label}-${Date.now()}.jsonl`);
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
  { name: 'create_payment', description: 'Create Stripe payment', inputSchema: { type: 'object', properties: {} } },
];

const FOCUS_PROFILES = {
  profiles: {
    code: { description: 'Code tools', categories: ['code' as const], servers: ['neon'], boost: 0.5 },
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

test('LLLL-1: cast:executed includes latencyMs ≥ 0', async () => {
  const agg = buildAgg();
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query on database' });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'executed');
    assert.ok('latencyMs' in parsed, 'latencyMs absent from cast:executed');
    assert.equal(typeof parsed.latencyMs, 'number');
    assert.ok(parsed.latencyMs >= 0, `latencyMs ${parsed.latencyMs} < 0`);
  } finally {
    await agg.shutdown();
  }
});

test('LLLL-2: cast:plan (confirm:true) includes latencyMs ≥ 0', async () => {
  const agg = buildAgg();
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query on database', confirm: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'plan');
    assert.ok('latencyMs' in parsed, 'latencyMs absent from cast:plan');
    assert.equal(typeof parsed.latencyMs, 'number');
    assert.ok(parsed.latencyMs >= 0);
  } finally {
    await agg.shutdown();
  }
});

test('LLLL-3: cast:resolved (dryRun:true) includes latencyMs ≥ 0', async () => {
  const agg = buildAgg();
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query on database', dryRun: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'resolved');
    assert.ok('latencyMs' in parsed, 'latencyMs absent from cast:resolved');
    assert.equal(typeof parsed.latencyMs, 'number');
    assert.ok(parsed.latencyMs >= 0);
  } finally {
    await agg.shutdown();
  }
});

test('LLLL-4: cast:discovered (only prompts match) includes latencyMs ≥ 0', async () => {
  // Use a backend whose listPrompts returns a matching prompt but no tools match the intent
  const promptBackend: Backend = {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: 0, toolCacheAge: 0 }),
    listTools: async () => [],
    callTool: async (): Promise<ToolCallResult> => ({ content: [] }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [{ name: 'zephyr-prompt', description: 'A special zephyr prompt for testing discovered path' }],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
  const agg = new Aggregator(
    [{ id: 'promptsrv', name: 'Prompt Server', type: 'remote', access: 'read', category: 'reasoning', endpoint: 'https://p.test/mcp' }],
    { backendFactory: () => promptBackend, ledgerDlqPath: dlqPath('disc') },
  );
  try {
    // Intent matches the prompt description but no tools
    const r = await agg.callTool('ch1tty/cast', { intent: 'zephyr special testing discovered' });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'discovered');
    assert.ok('latencyMs' in parsed, 'latencyMs absent from cast:discovered');
    assert.equal(typeof parsed.latencyMs, 'number');
    assert.ok(parsed.latencyMs >= 0);
  } finally {
    await agg.shutdown();
  }
});

test('LLLL-5: cast:no_match includes latencyMs ≥ 0', async () => {
  // Empty aggregator — nothing to match
  const emptyBackend: Backend = {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: 0, toolCacheAge: 0 }),
    listTools: async () => [],
    callTool: async (): Promise<ToolCallResult> => ({ content: [] }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
  const agg = new Aggregator(
    [{ id: 'empty', name: 'Empty', type: 'remote', access: 'read', category: 'reasoning', endpoint: 'https://e.test/mcp' }],
    { backendFactory: () => emptyBackend, ledgerDlqPath: dlqPath('nomatch') },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'this intent matches absolutely nothing at all' });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'no_match');
    assert.ok('latencyMs' in parsed, 'latencyMs absent from cast:no_match');
    assert.equal(typeof parsed.latencyMs, 'number');
    assert.ok(parsed.latencyMs >= 0);
  } finally {
    await agg.shutdown();
  }
});

test('LLLL-6: cast:chain_executed includes latencyMs ≥ 0', async () => {
  const agg = buildAgg();
  try {
    const r = await agg.callTool('ch1tty/cast', {
      intent: 'create invoice for billing',
      focus: 'finance',
      chain: true,
    });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'chain_executed');
    assert.ok('latencyMs' in parsed, 'latencyMs absent from cast:chain_executed');
    assert.equal(typeof parsed.latencyMs, 'number');
    assert.ok(parsed.latencyMs >= 0);
  } finally {
    await agg.shutdown();
  }
});

test('LLLL-7: missing intent (error path) has no latencyMs', async () => {
  const agg = buildAgg();
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: '' });
    assert.ok(r.isError, 'expected error response');
    const text = (r.content[0] as { text: string }).text;
    assert.ok(!text.includes('latencyMs'), 'latencyMs should not appear in error response');
  } finally {
    await agg.shutdown();
  }
});
