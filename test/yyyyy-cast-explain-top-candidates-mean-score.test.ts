/**
 * YYYYY: explanation.topCandidatesMeanScore in ch1tty/cast when explain:true.
 *
 * topCandidatesMeanScore: number — arithmetic mean of the relevance scores
 * across the topCandidates pool (up to 5 entries).
 *
 * Present when: a winner exists (same conditions as winnerScore).
 * Absent when: cast:no_match (no candidates).
 *
 * Covered:
 *   YYYYY-1: topCandidatesMeanScore present when winner exists
 *   YYYYY-2: topCandidatesMeanScore is a number >= 0
 *   YYYYY-3: topCandidatesMeanScore <= winnerScore (mean cannot exceed max)
 *   YYYYY-4: topCandidatesMeanScore === winnerScore when only one candidate
 *   YYYYY-5: topCandidatesMeanScore absent on cast:no_match
 *   YYYYY-6: topCandidatesMeanScore present regardless of focus (focus inactive)
 *   YYYYY-7: topCandidatesMeanScore present regardless of focus (focus active)
 *   YYYYY-8: tool description documents topCandidatesMeanScore
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
  return join(tmpdir(), `ch1tty-yyyyy-${label}-${Date.now()}.jsonl`);
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

test('YYYYY-1: topCandidatesMeanScore present when winner exists', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('y1', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('winnerScore' in explanation, 'winnerScore should be present');
    assert.ok('topCandidatesMeanScore' in explanation,
      `topCandidatesMeanScore should be present when winner exists; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.topCandidatesMeanScore, 'number', 'topCandidatesMeanScore should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('YYYYY-2: topCandidatesMeanScore is a number >= 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('y2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('topCandidatesMeanScore' in explanation, 'topCandidatesMeanScore should be present');
    assert.ok(
      explanation.topCandidatesMeanScore >= 0,
      `topCandidatesMeanScore should be >= 0, got ${explanation.topCandidatesMeanScore}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('YYYYY-3: topCandidatesMeanScore <= winnerScore (mean cannot exceed max)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('y3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('topCandidatesMeanScore' in explanation, 'topCandidatesMeanScore should be present');
    assert.ok(
      explanation.topCandidatesMeanScore <= explanation.winnerScore + 1e-9,
      `topCandidatesMeanScore (${explanation.topCandidatesMeanScore}) should be <= winnerScore (${explanation.winnerScore})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('YYYYY-4: topCandidatesMeanScore === winnerScore when only one candidate', async () => {
  // Single tool → topCandidates has 1 entry → mean equals that score = winnerScore
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('y4', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok('topCandidatesMeanScore' in explanation, 'topCandidatesMeanScore should be present');
    assert.ok(
      Math.abs(explanation.topCandidatesMeanScore - explanation.winnerScore) < 1e-9,
      `with one candidate, topCandidatesMeanScore (${explanation.topCandidatesMeanScore}) should equal winnerScore (${explanation.winnerScore})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('YYYYY-5: topCandidatesMeanScore absent on cast:no_match', async () => {
  const path = dlqPath('y5');
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
      !('topCandidatesMeanScore' in parsed.explanation),
      `topCandidatesMeanScore should be absent on no_match, found: ${parsed.explanation.topCandidatesMeanScore}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('YYYYY-6: topCandidatesMeanScore present regardless of focus (focus inactive)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('y6', [STRIPE_CFG], { stripe: stripeTools }); // no focus
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok('topCandidatesMeanScore' in explanation,
      `topCandidatesMeanScore should be present without focus; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('YYYYY-7: topCandidatesMeanScore present regardless of focus (focus active)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('y7', [STRIPE_CFG], { stripe: stripeTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focus' in explanation, 'focus should be active');
    assert.ok('topCandidatesMeanScore' in explanation,
      `topCandidatesMeanScore should be present with focus active; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('YYYYY-8: tool description documents topCandidatesMeanScore', async () => {
  const path = dlqPath('y8');
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
      cast.description?.includes('topCandidatesMeanScore'),
      `cast description should mention topCandidatesMeanScore, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
