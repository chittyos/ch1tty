/**
 * UUUU: explanation.winnerScore in ch1tty/cast when explain:true.
 *
 * winnerScore is the numeric relevance score of the winning (top-ranked) tool
 * in the scoring pool. It equals topCandidates[0].score, letting operators read
 * the winner's score directly without indexing into the array. Absent on
 * cast:no_match (no winner exists).
 *
 * Covered:
 *   UUUU-1: cast:executed, keyword, explain:true → explanation.winnerScore is a number ≥ 0
 *   UUUU-2: cast:executed, explain:true → winnerScore === topCandidates[0].score (invariant)
 *   UUUU-3: cast:no_match, explain:true → explanation.winnerScore absent
 *   UUUU-4: cast:plan (confirm:true), explain:true → explanation.winnerScore ≥ 0
 *   UUUU-5: cast:resolved (dryRun:true), explain:true → explanation.winnerScore ≥ 0
 *   UUUU-6: cast:chain_executed, explain:true → explanation.winnerScore ≥ 0
 *   UUUU-7: cast:executed, brain route, explain:true → explanation.winnerScore ≥ 0
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
  return join(tmpdir(), `ch1tty-uuuu-${label}-${Date.now()}.jsonl`);
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

test('UUUU-1: cast:executed, keyword, explain:true → explanation.winnerScore is a number ≥ 0', async () => {
  const agg = buildAgg('u1');
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'executed', `expected executed, got ${parsed.cast}`);
    assert.ok('explanation' in parsed, 'explanation absent');
    assert.ok('winnerScore' in parsed.explanation, 'winnerScore absent from explanation');
    assert.equal(typeof parsed.explanation.winnerScore, 'number', 'winnerScore is not a number');
    assert.ok(parsed.explanation.winnerScore >= 0, `winnerScore ${parsed.explanation.winnerScore} < 0`);
  } finally {
    await agg.shutdown();
  }
});

test('UUUU-2: cast:executed, explain:true → winnerScore === topCandidates[0].score (invariant)', async () => {
  const agg = buildAgg('u2');
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { winnerScore, topCandidates } = parsed.explanation;
    assert.ok(Array.isArray(topCandidates) && topCandidates.length > 0, 'topCandidates empty');
    assert.equal(winnerScore, topCandidates[0].score, `winnerScore(${winnerScore}) !== topCandidates[0].score(${topCandidates[0].score})`);
  } finally {
    await agg.shutdown();
  }
});

test('UUUU-3: cast:no_match, explain:true → explanation.winnerScore absent', async () => {
  const path = dlqPath('u3');
  const emptyBackend = makeBackend([]);
  const agg = new Aggregator([NEON_CFG], {
    backendFactory: () => emptyBackend,
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: BASE_CATALOG,
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
  });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'xyzzy-nonexistent-qwerty', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'no_match', `expected no_match, got ${parsed.cast}`);
    assert.ok('explanation' in parsed, 'explanation absent');
    assert.ok(!('winnerScore' in parsed.explanation), 'winnerScore should be absent on no_match');
  } finally {
    await agg.shutdown();
  }
});

test('UUUU-4: cast:plan (confirm:true), explain:true → explanation.winnerScore ≥ 0', async () => {
  const agg = buildAgg('u4');
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query', confirm: true, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'plan', `expected plan, got ${parsed.cast}`);
    assert.ok('explanation' in parsed, 'explanation absent');
    assert.ok('winnerScore' in parsed.explanation, 'winnerScore absent from plan explanation');
    assert.ok(parsed.explanation.winnerScore >= 0, `winnerScore ${parsed.explanation.winnerScore} < 0`);
  } finally {
    await agg.shutdown();
  }
});

test('UUUU-5: cast:resolved (dryRun:true), explain:true → explanation.winnerScore ≥ 0', async () => {
  const agg = buildAgg('u5');
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query', dryRun: true, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'resolved', `expected resolved, got ${parsed.cast}`);
    assert.ok('explanation' in parsed, 'explanation absent');
    assert.ok('winnerScore' in parsed.explanation, 'winnerScore absent from resolved explanation');
    assert.ok(parsed.explanation.winnerScore >= 0, `winnerScore ${parsed.explanation.winnerScore} < 0`);
  } finally {
    await agg.shutdown();
  }
});

test('UUUU-6: cast:chain_executed, explain:true → explanation.winnerScore ≥ 0', async () => {
  const agg = buildAgg('u6');
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
    assert.ok('winnerScore' in parsed.explanation, 'winnerScore absent from chain_executed explanation');
    assert.ok(parsed.explanation.winnerScore >= 0, `winnerScore ${parsed.explanation.winnerScore} < 0`);
  } finally {
    await agg.shutdown();
  }
});

test('UUUU-7: cast:executed, brain route, explain:true → explanation.winnerScore ≥ 0', async () => {
  const agg = buildAggBrain('u7');
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query on database', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'executed', `expected executed, got ${parsed.cast}`);
    assert.ok('explanation' in parsed, 'explanation absent');
    assert.equal(parsed.explanation.method, 'brain', 'expected brain route');
    assert.ok('winnerScore' in parsed.explanation, 'winnerScore absent from brain-route explanation');
    assert.ok(parsed.explanation.winnerScore >= 0, `winnerScore ${parsed.explanation.winnerScore} < 0`);
  } finally {
    await agg.shutdown();
  }
});
