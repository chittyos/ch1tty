/**
 * DDDDDD: explanation.topCandidatesScoreVariance in ch1tty/cast when explain:true.
 *
 * topCandidatesScoreVariance: number — variance of topCandidates scores,
 * computed as sum((score - mean)^2) / N.
 *
 * Present when: >= 2 topCandidates (same conditions as runnerUpScore).
 * Absent when: 0 or 1 candidate (no_match or single-tool registry).
 * Always >= 0.
 *
 * Covered:
 *   DDDDDD-1: topCandidatesScoreVariance present when >= 2 candidates
 *   DDDDDD-2: topCandidatesScoreVariance >= 0 always when present
 *   DDDDDD-3: topCandidatesScoreVariance === computed variance
 *   DDDDDD-4: topCandidatesScoreVariance absent on cast:no_match
 *   DDDDDD-5: topCandidatesScoreVariance absent when only one candidate
 *   DDDDDD-6: topCandidatesScoreVariance present regardless of focus (focus inactive)
 *   DDDDDD-7: topCandidatesScoreVariance present regardless of focus (focus active)
 *   DDDDDD-8: tool description documents topCandidatesScoreVariance
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
  return join(tmpdir(), `ch1tty-dddddd-${label}-${Date.now()}.jsonl`);
}

const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe Payments', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.test/mcp',
};
const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.test/mcp',
};

const FINANCE_PROFILES: FocusProfiles = {
  profiles: {
    finance: { description: 'Financial tools', categories: ['ecosystem'], servers: ['stripe'], boost: 0.5 },
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

test('DDDDDD-1: topCandidatesScoreVariance present when >= 2 candidates', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('d1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates for this test');
    assert.ok('topCandidatesScoreVariance' in explanation,
      `topCandidatesScoreVariance should be present when >= 2 candidates; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.topCandidatesScoreVariance, 'number', 'topCandidatesScoreVariance should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('DDDDDD-2: topCandidatesScoreVariance >= 0 always when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('d2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('topCandidatesScoreVariance' in explanation, 'topCandidatesScoreVariance should be present');
    assert.ok(
      explanation.topCandidatesScoreVariance >= 0,
      `topCandidatesScoreVariance should be >= 0, got ${explanation.topCandidatesScoreVariance}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('DDDDDD-3: topCandidatesScoreVariance === computed variance', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('d3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('topCandidatesScoreVariance' in explanation, 'topCandidatesScoreVariance should be present');
    // Recompute variance from winnerScore and runnerUpScore (2-candidate pool)
    const scores = [explanation.winnerScore, explanation.runnerUpScore];
    const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
    const expected = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length;
    assert.ok(
      Math.abs(explanation.topCandidatesScoreVariance - expected) < 1e-9,
      `topCandidatesScoreVariance (${explanation.topCandidatesScoreVariance}) should equal computed variance (${expected})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('DDDDDD-4: topCandidatesScoreVariance absent on cast:no_match', async () => {
  const path = dlqPath('d4');
  const emptyAgg = new Aggregator([STRIPE_CFG], {
    backendFactory: () => makeBackend([]),
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
  });
  try {
    const r = await emptyAgg.callTool('ch1tty/cast', { intent: 'xyzzy-nonexistent', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'no_match', `expected no_match, got ${parsed.cast}`);
    assert.ok('explanation' in parsed, 'explanation absent');
    assert.ok(
      !('topCandidatesScoreVariance' in parsed.explanation),
      `topCandidatesScoreVariance should be absent on no_match, found: ${parsed.explanation.topCandidatesScoreVariance}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('DDDDDD-5: topCandidatesScoreVariance absent when only one candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('d5', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok('winnerScore' in explanation, 'winnerScore should be present');
    assert.ok(
      !('topCandidatesScoreVariance' in explanation),
      `topCandidatesScoreVariance should be absent with single candidate, found: ${explanation.topCandidatesScoreVariance}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('DDDDDD-6: topCandidatesScoreVariance present regardless of focus (focus inactive)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('d6', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools }); // no focus
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok('topCandidatesScoreVariance' in explanation,
      `topCandidatesScoreVariance should be present without focus; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('DDDDDD-7: topCandidatesScoreVariance present regardless of focus (focus active)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('d7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focus' in explanation, 'focus should be active');
    assert.ok('topCandidatesScoreVariance' in explanation,
      `topCandidatesScoreVariance should be present with focus active; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('DDDDDD-8: tool description documents topCandidatesScoreVariance', async () => {
  const path = dlqPath('d8');
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
      cast.description?.includes('topCandidatesScoreVariance'),
      `cast description should mention topCandidatesScoreVariance, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
