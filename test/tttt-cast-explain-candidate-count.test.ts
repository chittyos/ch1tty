/**
 * TTTT: explanation.candidateCount in ch1tty/cast when explain:true.
 *
 * candidateCount is the total number of tools in the scoring pool before the
 * top-5 topCandidates slice. Lets operators see how competitive the resolution
 * was (3 candidates is very different from 150).
 *
 * Covered:
 *   TTTT-1: cast:executed, keyword, explain:true → explanation.candidateCount is a non-negative integer
 *   TTTT-2: cast:executed, keyword, 2-tool registry → explanation.candidateCount === 2
 *   TTTT-3: cast:executed, brain, explain:true → explanation.candidateCount is a non-negative integer
 *   TTTT-4: cast:no_match, explain:true → explanation.candidateCount === 0
 *   TTTT-5: cast:plan (confirm:true), explain:true → explanation.candidateCount ≥ 0
 *   TTTT-6: cast:resolved (dryRun:true), explain:true → explanation.candidateCount ≥ 0
 *   TTTT-7: cast:executed, explain:true → explanation.candidateCount ≥ explanation.topCandidates.length
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
  return join(tmpdir(), `ch1tty-tttt-${label}-${Date.now()}.jsonl`);
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
  { name: 'list_projects', description: 'List Neon database projects', inputSchema: { type: 'object', properties: {} } },
];
const STRIPE_TOOLS: ToolEntry[] = [
  { name: 'create_invoice', description: 'Create Stripe invoice for billing', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_customers', description: 'List Stripe billing customers', inputSchema: { type: 'object', properties: {} } },
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

class FallbackCoordinator extends SessionCoordinator {
  constructor(dlq?: string) {
    super({}, { enabled: false }, dlq);
  }
  override async routeIntent(): Promise<null> {
    return null;
  }
}

function buildAgg(label: string): Aggregator {
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

test('TTTT-1: cast:executed, keyword, explain:true → explanation.candidateCount is a non-negative integer', async () => {
  const agg = buildAgg('t1');
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'executed', `expected executed, got ${parsed.cast}`);
    assert.ok('explanation' in parsed, 'explanation absent');
    assert.ok('candidateCount' in parsed.explanation, 'candidateCount absent from explanation');
    assert.equal(typeof parsed.explanation.candidateCount, 'number', 'candidateCount is not a number');
    assert.ok(Number.isInteger(parsed.explanation.candidateCount), 'candidateCount is not an integer');
    assert.ok(parsed.explanation.candidateCount >= 0, `candidateCount ${parsed.explanation.candidateCount} < 0`);
  } finally {
    await agg.shutdown();
  }
});

test('TTTT-2: cast:executed, keyword, 2-tool neon-only registry → explanation.candidateCount === 2', async () => {
  const neonBackend = makeBackend(NEON_TOOLS);
  const path = dlqPath('t2');
  const agg = new Aggregator([NEON_CFG], {
    backendFactory: () => neonBackend,
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: BASE_CATALOG,
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
  });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'neon database', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    assert.equal(parsed.explanation.candidateCount, 2, `expected 2 (neon has 2 tools), got ${parsed.explanation.candidateCount}`);
  } finally {
    await agg.shutdown();
  }
});

test('TTTT-3: cast:executed, brain, explain:true → explanation.candidateCount is a non-negative integer', async () => {
  const agg = buildAggBrain('t3');
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query on database', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'executed', `expected executed, got ${parsed.cast}`);
    assert.ok('explanation' in parsed, 'explanation absent');
    assert.ok('candidateCount' in parsed.explanation, 'candidateCount absent from brain-route explanation');
    assert.equal(typeof parsed.explanation.candidateCount, 'number', 'candidateCount not a number');
    assert.ok(parsed.explanation.candidateCount >= 0, `candidateCount ${parsed.explanation.candidateCount} < 0`);
  } finally {
    await agg.shutdown();
  }
});

test('TTTT-4: cast:no_match, explain:true → explanation.candidateCount === 0', async () => {
  const path = dlqPath('t4');
  class AlwaysNoMatchCoordinator extends SessionCoordinator {
    constructor(dlq?: string) { super({}, { enabled: false }, dlq); }
    override async routeIntent(): Promise<null> { return null; }
  }
  const emptyBackend = makeBackend([]);
  const agg = new Aggregator([NEON_CFG], {
    backendFactory: () => emptyBackend,
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: BASE_CATALOG,
    ledgerDlqPath: path,
    coordinator: new AlwaysNoMatchCoordinator(path),
  });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'xyzzy-nonexistent-tool-qwerty', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'no_match', `expected no_match, got ${parsed.cast}`);
    assert.ok('explanation' in parsed, 'explanation absent');
    assert.equal(parsed.explanation.candidateCount, 0, `expected 0 for no_match, got ${parsed.explanation.candidateCount}`);
  } finally {
    await agg.shutdown();
  }
});

test('TTTT-5: cast:plan (confirm:true), explain:true → explanation.candidateCount ≥ 0', async () => {
  const agg = buildAgg('t5');
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query', confirm: true, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'plan', `expected plan, got ${parsed.cast}`);
    assert.ok('explanation' in parsed, 'explanation absent');
    assert.ok('candidateCount' in parsed.explanation, 'candidateCount absent from plan explanation');
    assert.ok(parsed.explanation.candidateCount >= 0, `candidateCount ${parsed.explanation.candidateCount} < 0`);
  } finally {
    await agg.shutdown();
  }
});

test('TTTT-6: cast:resolved (dryRun:true), explain:true → explanation.candidateCount ≥ 0', async () => {
  const agg = buildAgg('t6');
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query', dryRun: true, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'resolved', `expected resolved, got ${parsed.cast}`);
    assert.ok('explanation' in parsed, 'explanation absent');
    assert.ok('candidateCount' in parsed.explanation, 'candidateCount absent from resolved explanation');
    assert.ok(parsed.explanation.candidateCount >= 0, `candidateCount ${parsed.explanation.candidateCount} < 0`);
  } finally {
    await agg.shutdown();
  }
});

test('TTTT-7: cast:executed, explain:true → explanation.candidateCount ≥ explanation.topCandidates.length', async () => {
  const agg = buildAgg('t7');
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'database query', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { candidateCount, topCandidates } = parsed.explanation;
    assert.ok(
      candidateCount >= topCandidates.length,
      `candidateCount(${candidateCount}) < topCandidates.length(${topCandidates.length})`,
    );
  } finally {
    await agg.shutdown();
  }
});
