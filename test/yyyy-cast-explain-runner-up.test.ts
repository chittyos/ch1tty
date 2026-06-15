/**
 * YYYY: explanation.runnerUpScore and explanation.runnerUpTool in ch1tty/cast
 * when explain:true and there are at least 2 candidates.
 *
 * runnerUpScore = topCandidates[1].score (second-best score).
 * runnerUpTool  = topCandidates[1].tool  (second-best namespaced tool name).
 * Both absent when there are 0 or 1 candidates (no_match, single-tool registries).
 * The margin (winnerScore - runnerUpScore) tells operators how decisive the resolution was.
 *
 * Covered:
 *   YYYY-1: executed + 2+ candidates → runnerUpScore and runnerUpTool present
 *   YYYY-2: runnerUpScore < winnerScore (positive margin)
 *   YYYY-3: runnerUpTool === topCandidates[1].tool (consistency)
 *   YYYY-4: single candidate (1-tool registry) → runnerUpScore and runnerUpTool absent
 *   YYYY-5: cast:no_match → runnerUpScore and runnerUpTool absent
 *   YYYY-6: cast:plan (confirm:true) + 2+ candidates → runnerUpScore and runnerUpTool present
 *   YYYY-7: tool description documents runnerUpScore
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-yyyy-${label}-${Date.now()}.jsonl`);
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
  { name: 'list_invoices', description: 'List all Stripe billing invoices for payment tracking', inputSchema: { type: 'object', properties: {} } },
];
const NEON_TOOLS: ToolEntry[] = [
  { name: 'run_sql', description: 'Run SQL queries on Neon database', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_projects', description: 'List Neon database projects and environments', inputSchema: { type: 'object', properties: {} } },
];

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

function buildAgg(label: string, tools: { stripe: ToolEntry[]; neon: ToolEntry[] }): Aggregator {
  const backendMap: Record<string, Backend> = {
    stripe: makeBackend(tools.stripe),
    neon: makeBackend(tools.neon),
  };
  const path = dlqPath(label);
  return new Aggregator([STRIPE_CFG, NEON_CFG], {
    backendFactory: (cfg) => backendMap[cfg.id],
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
  });
}

test('YYYY-1: executed + 2+ candidates → runnerUpScore and runnerUpTool present', async () => {
  const agg = buildAgg('y1', { stripe: STRIPE_TOOLS, neon: NEON_TOOLS });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.topCandidates.length >= 2, `need ≥2 candidates for runner-up, got ${explanation.topCandidates.length}`);
    assert.ok('runnerUpScore' in explanation, 'runnerUpScore absent');
    assert.ok('runnerUpTool' in explanation, 'runnerUpTool absent');
    assert.equal(typeof explanation.runnerUpScore, 'number', 'runnerUpScore should be number');
    assert.equal(typeof explanation.runnerUpTool, 'string', 'runnerUpTool should be string');
  } finally {
    await agg.shutdown();
  }
});

test('YYYY-2: runnerUpScore < winnerScore (positive margin)', async () => {
  const agg = buildAgg('y2', { stripe: STRIPE_TOOLS, neon: NEON_TOOLS });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.topCandidates.length >= 2, `need ≥2 candidates, got ${explanation.topCandidates.length}`);
    assert.ok(
      explanation.runnerUpScore < explanation.winnerScore,
      `runnerUpScore (${explanation.runnerUpScore}) should be < winnerScore (${explanation.winnerScore})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('YYYY-3: runnerUpTool === topCandidates[1].tool (consistency)', async () => {
  const agg = buildAgg('y3', { stripe: STRIPE_TOOLS, neon: NEON_TOOLS });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'list invoices payments', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.topCandidates.length >= 2, `need ≥2 candidates, got ${explanation.topCandidates.length}`);
    assert.equal(
      explanation.runnerUpTool,
      explanation.topCandidates[1].tool,
      `runnerUpTool (${explanation.runnerUpTool}) should equal topCandidates[1].tool (${explanation.topCandidates[1].tool})`,
    );
    assert.equal(
      explanation.runnerUpScore,
      explanation.topCandidates[1].score,
      `runnerUpScore (${explanation.runnerUpScore}) should equal topCandidates[1].score (${explanation.topCandidates[1].score})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('YYYY-4: single candidate (1-tool registry) → runnerUpScore and runnerUpTool absent', async () => {
  const singleToolPath = dlqPath('y4');
  const singleAgg = new Aggregator([STRIPE_CFG], {
    backendFactory: () => makeBackend([STRIPE_TOOLS[0]]),
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    ledgerDlqPath: singleToolPath,
    coordinator: new FallbackCoordinator(singleToolPath),
  });
  try {
    const r = await singleAgg.callTool('ch1tty/cast', { intent: 'create invoice', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.equal(explanation.topCandidates.length, 1, `expected exactly 1 candidate, got ${explanation.topCandidates.length}`);
    assert.ok(!('runnerUpScore' in explanation), `runnerUpScore should be absent with 1 candidate, got ${explanation.runnerUpScore}`);
    assert.ok(!('runnerUpTool' in explanation), `runnerUpTool should be absent with 1 candidate, got ${explanation.runnerUpTool}`);
  } finally {
    await singleAgg.shutdown();
  }
});

test('YYYY-5: cast:no_match → runnerUpScore and runnerUpTool absent', async () => {
  const emptyPath = dlqPath('y5');
  const emptyAgg = new Aggregator([STRIPE_CFG], {
    backendFactory: () => makeBackend([]),
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    ledgerDlqPath: emptyPath,
    coordinator: new FallbackCoordinator(emptyPath),
  });
  try {
    const r = await emptyAgg.callTool('ch1tty/cast', { intent: 'xyzzy-nonexistent', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'no_match', `expected no_match, got ${parsed.cast}`);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.equal(explanation.topCandidates.length, 0, 'topCandidates should be empty on no_match');
    assert.ok(!('runnerUpScore' in explanation), `runnerUpScore should be absent on no_match, got ${explanation.runnerUpScore}`);
    assert.ok(!('runnerUpTool' in explanation), `runnerUpTool should be absent on no_match, got ${explanation.runnerUpTool}`);
  } finally {
    await emptyAgg.shutdown();
  }
});

test('YYYY-6: cast:plan (confirm:true) + 2+ candidates → runnerUpScore and runnerUpTool present', async () => {
  const agg = buildAgg('y6', { stripe: STRIPE_TOOLS, neon: NEON_TOOLS });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing', confirm: true, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'plan', `expected plan, got ${parsed.cast}`);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.topCandidates.length >= 2, `need ≥2 candidates for runner-up, got ${explanation.topCandidates.length}`);
    assert.ok('runnerUpScore' in explanation, 'runnerUpScore absent in plan explanation');
    assert.ok('runnerUpTool' in explanation, 'runnerUpTool absent in plan explanation');
    assert.equal(explanation.runnerUpTool, explanation.topCandidates[1].tool, 'runnerUpTool consistency in plan');
  } finally {
    await agg.shutdown();
  }
});

test('YYYY-7: tool description documents runnerUpScore', async () => {
  const path = dlqPath('y7');
  const agg = new Aggregator([STRIPE_CFG], {
    backendFactory: () => makeBackend(STRIPE_TOOLS),
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
      cast.description?.includes('runnerUpScore'),
      `cast description should mention runnerUpScore, got: ${cast.description?.slice(0, 400)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
