/**
 * PPPP: latencyBreakdown.brainMs in cast:executed and cast:chain_executed.
 *
 * When the brain route fires (castRoute === 'brain'), latencyBreakdown gains a
 * third field: brainMs — the wall-clock time for routeIntent() alone. This lets
 * operators distinguish brain-routing overhead from keyword scoring overhead.
 * brainMs is absent when the keyword-fallback route is taken.
 *
 * Covered:
 *   PPPP-1: cast:executed, brain route → latencyBreakdown.brainMs is a number ≥ 0
 *   PPPP-2: cast:executed, keyword fallback → latencyBreakdown.brainMs is absent
 *   PPPP-3: cast:chain_executed, brain route → latencyBreakdown.brainMs is a number ≥ 0
 *   PPPP-4: cast:chain_executed, keyword fallback → latencyBreakdown.brainMs is absent
 *   PPPP-5: cast:executed, brain route → brainMs ≤ scoringMs (brainMs ⊆ scoringMs window)
 *   PPPP-6: cast:plan (confirm:true) → no latencyBreakdown at all (unchanged from NNNN)
 *   PPPP-7: cast:no_match → no latencyBreakdown at all (unchanged from NNNN)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { RoutedTool, ToolCandidate } from '../src/ollama-brain.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-pppp-${label}-${Date.now()}.jsonl`);
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

/** StubCoordinator whose routeIntent always returns a fixed brain result. */
class BrainCoordinator extends SessionCoordinator {
  private readonly brainResult: RoutedTool[];
  constructor(brainResult: RoutedTool[], dlq?: string) {
    super({}, { enabled: false }, dlq);
    this.brainResult = brainResult;
  }
  override async routeIntent(_q: string, _c: ToolCandidate[]): Promise<RoutedTool[]> {
    return this.brainResult;
  }
}

/** StubCoordinator whose routeIntent always returns null (keyword fallback). */
class FallbackCoordinator extends SessionCoordinator {
  constructor(dlq?: string) {
    super({}, { enabled: false }, dlq);
  }
  override async routeIntent(): Promise<null> {
    return null;
  }
}

function buildAggBrain(label: string): Aggregator {
  const neonBackend = makeBackend(NEON_TOOLS);
  const stripeBackend = makeBackend(STRIPE_TOOLS);
  const backendMap: Record<string, Backend> = { neon: neonBackend, stripe: stripeBackend };
  const path = dlqPath(label);
  const brainResult: RoutedTool[] = [
    { tool: { namespacedName: 'neon/run_sql', description: 'Run SQL', category: 'code', serverName: 'Neon' }, confidence: 0.9, reason: 'sql' },
  ];
  return new Aggregator([NEON_CFG, STRIPE_CFG], {
    backendFactory: (cfg) => backendMap[cfg.id] ?? neonBackend,
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: BASE_CATALOG,
    ledgerDlqPath: path,
    coordinator: new BrainCoordinator(brainResult, path),
  });
}

function buildAggFallback(label: string): Aggregator {
  const neonBackend = makeBackend(NEON_TOOLS);
  const stripeBackend = makeBackend(STRIPE_TOOLS);
  const backendMap: Record<string, Backend> = { neon: neonBackend, stripe: stripeBackend };
  const path = dlqPath(label);
  return new Aggregator([NEON_CFG, STRIPE_CFG], {
    backendFactory: (cfg) => backendMap[cfg.id] ?? neonBackend,
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: BASE_CATALOG,
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
  });
}

function buildAggChainBrain(label: string): Aggregator {
  const stripeBackend = makeBackend(STRIPE_TOOLS);
  const path = dlqPath(label);
  const brainResult: RoutedTool[] = [
    { tool: { namespacedName: 'stripe/create_invoice', description: 'Create invoice', category: 'ecosystem', serverName: 'Stripe' }, confidence: 0.95, reason: 'invoice' },
  ];
  return new Aggregator([STRIPE_CFG], {
    backendFactory: () => stripeBackend,
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: BASE_CATALOG,
    ledgerDlqPath: path,
    coordinator: new BrainCoordinator(brainResult, path),
  });
}

function buildAggChainFallback(label: string): Aggregator {
  const stripeBackend = makeBackend(STRIPE_TOOLS);
  const path = dlqPath(label);
  return new Aggregator([STRIPE_CFG], {
    backendFactory: () => stripeBackend,
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: BASE_CATALOG,
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
  });
}

test('PPPP-1: cast:executed, brain route → latencyBreakdown.brainMs is a number ≥ 0', async () => {
  const agg = buildAggBrain('p1');
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query on database' });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'executed', `expected executed, got ${parsed.cast}`);
    assert.ok('latencyBreakdown' in parsed, 'latencyBreakdown absent');
    assert.ok('brainMs' in parsed.latencyBreakdown, 'brainMs absent from brain-route breakdown');
    assert.equal(typeof parsed.latencyBreakdown.brainMs, 'number', 'brainMs is not a number');
    assert.ok(parsed.latencyBreakdown.brainMs >= 0, `brainMs ${parsed.latencyBreakdown.brainMs} < 0`);
  } finally {
    await agg.shutdown();
  }
});

test('PPPP-2: cast:executed, keyword fallback → latencyBreakdown.brainMs is absent', async () => {
  const agg = buildAggFallback('p2');
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query on database' });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'executed', `expected executed, got ${parsed.cast}`);
    assert.ok('latencyBreakdown' in parsed, 'latencyBreakdown absent');
    assert.ok(!('brainMs' in parsed.latencyBreakdown), 'brainMs should not be present on keyword-fallback route');
  } finally {
    await agg.shutdown();
  }
});

test('PPPP-3: cast:chain_executed, brain route → latencyBreakdown.brainMs is a number ≥ 0', async () => {
  const agg = buildAggChainBrain('p3');
  try {
    const r = await agg.callTool('ch1tty/cast', {
      intent: 'create stripe invoice',
      focus: 'finance',
      chain: true,
    });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'chain_executed', `expected chain_executed, got ${parsed.cast}`);
    assert.ok('latencyBreakdown' in parsed, 'latencyBreakdown absent');
    assert.ok('brainMs' in parsed.latencyBreakdown, 'brainMs absent from brain-route chain breakdown');
    assert.equal(typeof parsed.latencyBreakdown.brainMs, 'number', 'brainMs is not a number');
    assert.ok(parsed.latencyBreakdown.brainMs >= 0, `brainMs ${parsed.latencyBreakdown.brainMs} < 0`);
  } finally {
    await agg.shutdown();
  }
});

test('PPPP-4: cast:chain_executed, keyword fallback → latencyBreakdown.brainMs is absent', async () => {
  const agg = buildAggChainFallback('p4');
  try {
    const r = await agg.callTool('ch1tty/cast', {
      intent: 'create stripe invoice',
      focus: 'finance',
      chain: true,
    });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'chain_executed', `expected chain_executed, got ${parsed.cast}`);
    assert.ok('latencyBreakdown' in parsed, 'latencyBreakdown absent');
    assert.ok(!('brainMs' in parsed.latencyBreakdown), 'brainMs should not be present on keyword-fallback chain');
  } finally {
    await agg.shutdown();
  }
});

test('PPPP-5: cast:executed, brain route → brainMs ≤ scoringMs', async () => {
  const agg = buildAggBrain('p5');
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query on database' });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'executed');
    const { brainMs, scoringMs } = parsed.latencyBreakdown;
    assert.ok(
      brainMs <= scoringMs + 2,
      `brainMs(${brainMs}) > scoringMs(${scoringMs}) + 2ms tolerance (brainMs should be a subset of scoringMs window)`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('PPPP-6: cast:plan (confirm:true) → no latencyBreakdown field', async () => {
  const agg = buildAggBrain('p6');
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

test('PPPP-7: cast:no_match → no latencyBreakdown field', async () => {
  const agg = buildAggFallback('p7');
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
