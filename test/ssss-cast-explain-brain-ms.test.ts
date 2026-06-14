/**
 * SSSS: explanation.brainMs in ch1tty/cast when explain:true and brain route fires.
 *
 * When explain:true is set and castRoute === 'brain', the explanation object gains
 * brainMs: number — the wall-clock time of the routeIntent() call. Parallels
 * latencyBreakdown.brainMs (PPPP) but lives in the reasoning-oriented explanation
 * field alongside method:'brain', topCandidates, and rationale.
 *
 * Covered:
 *   SSSS-1: cast:executed, brain, explain:true → explanation.brainMs ≥ 0
 *   SSSS-2: cast:executed, keyword fallback, explain:true → explanation.brainMs absent
 *   SSSS-3: cast:executed, brain, explain:true → explanation.brainMs ≤ latencyMs
 *   SSSS-4: cast:plan (confirm:true), brain, explain:true → explanation.brainMs ≥ 0
 *   SSSS-5: cast:resolved (dryRun:true), brain, explain:true → explanation.brainMs ≥ 0
 *   SSSS-6: cast:chain_executed, brain, explain:true → explanation.brainMs ≥ 0
 *   SSSS-7: cast:executed, brain, explain:true → explanation.method:'brain' coexists with brainMs
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
  return join(tmpdir(), `ch1tty-ssss-${label}-${Date.now()}.jsonl`);
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

test('SSSS-1: cast:executed, brain, explain:true → explanation.brainMs is a number ≥ 0', async () => {
  const agg = buildAggBrain('s1');
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query on database', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'executed', `expected executed, got ${parsed.cast}`);
    assert.ok('explanation' in parsed, 'explanation absent');
    assert.ok('brainMs' in parsed.explanation, 'brainMs absent from brain-route explanation');
    assert.equal(typeof parsed.explanation.brainMs, 'number', 'brainMs is not a number');
    assert.ok(parsed.explanation.brainMs >= 0, `brainMs ${parsed.explanation.brainMs} < 0`);
  } finally {
    await agg.shutdown();
  }
});

test('SSSS-2: cast:executed, keyword fallback, explain:true → explanation.brainMs absent', async () => {
  const agg = buildAggFallback('s2');
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query on database', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'executed', `expected executed, got ${parsed.cast}`);
    assert.ok('explanation' in parsed, 'explanation absent');
    assert.ok(!('brainMs' in parsed.explanation), 'brainMs should not be present on keyword-fallback route');
  } finally {
    await agg.shutdown();
  }
});

test('SSSS-3: cast:executed, brain, explain:true → explanation.brainMs ≤ latencyMs', async () => {
  const agg = buildAggBrain('s3');
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query on database', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'executed');
    const { brainMs } = parsed.explanation;
    const { latencyMs } = parsed;
    assert.ok(
      brainMs <= latencyMs + 2,
      `brainMs(${brainMs}) > latencyMs(${latencyMs}) + 2ms tolerance`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('SSSS-4: cast:plan (confirm:true), brain, explain:true → explanation.brainMs ≥ 0', async () => {
  const agg = buildAggBrain('s4');
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query on database', confirm: true, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'plan', `expected plan, got ${parsed.cast}`);
    assert.ok('explanation' in parsed, 'explanation absent');
    assert.ok('brainMs' in parsed.explanation, 'brainMs absent from brain-route plan explanation');
    assert.ok(parsed.explanation.brainMs >= 0, `brainMs ${parsed.explanation.brainMs} < 0`);
  } finally {
    await agg.shutdown();
  }
});

test('SSSS-5: cast:resolved (dryRun:true), brain, explain:true → explanation.brainMs ≥ 0', async () => {
  const agg = buildAggBrain('s5');
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query on database', dryRun: true, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'resolved', `expected resolved, got ${parsed.cast}`);
    assert.ok('explanation' in parsed, 'explanation absent');
    assert.ok('brainMs' in parsed.explanation, 'brainMs absent from brain-route resolved explanation');
    assert.ok(parsed.explanation.brainMs >= 0, `brainMs ${parsed.explanation.brainMs} < 0`);
  } finally {
    await agg.shutdown();
  }
});

test('SSSS-6: cast:chain_executed, brain, explain:true → explanation.brainMs ≥ 0', async () => {
  const agg = buildAggChainBrain('s6');
  try {
    const r = await agg.callTool('ch1tty/cast', {
      intent: 'create stripe invoice',
      focus: 'finance',
      chain: true,
      explain: true,
    });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'chain_executed', `expected chain_executed, got ${parsed.cast}`);
    assert.ok('explanation' in parsed, 'explanation absent');
    assert.ok('brainMs' in parsed.explanation, 'brainMs absent from brain-route chain_executed explanation');
    assert.ok(parsed.explanation.brainMs >= 0, `brainMs ${parsed.explanation.brainMs} < 0`);
  } finally {
    await agg.shutdown();
  }
});

test('SSSS-7: cast:executed, brain, explain:true → explanation.method:brain coexists with brainMs', async () => {
  const agg = buildAggBrain('s7');
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query on database', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'executed');
    assert.ok('explanation' in parsed, 'explanation absent');
    assert.equal(parsed.explanation.method, 'brain', `expected method:'brain', got ${parsed.explanation.method}`);
    assert.ok('brainMs' in parsed.explanation, 'brainMs absent');
    assert.ok(typeof parsed.explanation.brainMs === 'number', 'brainMs is not a number');
    assert.ok('topCandidates' in parsed.explanation, 'topCandidates absent');
    assert.ok('rationale' in parsed.explanation, 'rationale absent');
  } finally {
    await agg.shutdown();
  }
});
