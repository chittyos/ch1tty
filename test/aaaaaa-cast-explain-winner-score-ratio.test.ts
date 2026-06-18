/**
 * AAAAAA: explanation.winnerScoreRatio in ch1tty/cast when explain:true.
 *
 * winnerScoreRatio: number — the ratio of winnerScore to runnerUpScore
 * (winnerScore / runnerUpScore). Present when a runner-up exists and
 * runnerUpScore > 0. Absent when 0 or 1 candidate, or when runnerUpScore === 0.
 *
 * A ratio of 1.0 means winner and runner-up scored equally.
 * A ratio of 2.0 means winner scored twice the runner-up.
 * Multiplicative complement to focusMargin (additive gap).
 * Not focus-dependent.
 *
 * Covered:
 *   AAAAAA-1: winnerScoreRatio present when runner-up exists
 *   AAAAAA-2: winnerScoreRatio >= 1 always when present
 *   AAAAAA-3: winnerScoreRatio === winnerScore / runnerUpScore
 *   AAAAAA-4: winnerScoreRatio absent on cast:no_match
 *   AAAAAA-5: winnerScoreRatio absent when only one candidate
 *   AAAAAA-6: winnerScoreRatio present regardless of focus (focus inactive)
 *   AAAAAA-7: winnerScoreRatio present regardless of focus (focus active)
 *   AAAAAA-8: tool description documents winnerScoreRatio
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
  return join(tmpdir(), `ch1tty-aaaaaa-${label}-${Date.now()}.jsonl`);
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

test('AAAAAA-1: winnerScoreRatio present when runner-up exists', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('a1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('runnerUpScore' in explanation, 'runnerUpScore should be present (runner-up exists)');
    assert.ok('winnerScoreRatio' in explanation,
      `winnerScoreRatio should be present when runner-up exists; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.winnerScoreRatio, 'number', 'winnerScoreRatio should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('AAAAAA-2: winnerScoreRatio >= 1 always when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('a2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('winnerScoreRatio' in explanation, 'winnerScoreRatio should be present');
    assert.ok(
      explanation.winnerScoreRatio >= 1,
      `winnerScoreRatio should be >= 1 (winner >= runner-up), got ${explanation.winnerScoreRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('AAAAAA-3: winnerScoreRatio === winnerScore / runnerUpScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('a3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('winnerScoreRatio' in explanation, 'winnerScoreRatio should be present');
    const expected = explanation.winnerScore / explanation.runnerUpScore;
    assert.ok(
      Math.abs(explanation.winnerScoreRatio - expected) < 1e-9,
      `winnerScoreRatio (${explanation.winnerScoreRatio}) should equal winnerScore/runnerUpScore (${expected})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('AAAAAA-4: winnerScoreRatio absent on cast:no_match', async () => {
  const path = dlqPath('a4');
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
      !('winnerScoreRatio' in parsed.explanation),
      `winnerScoreRatio should be absent on no_match, found: ${parsed.explanation.winnerScoreRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('AAAAAA-5: winnerScoreRatio absent when only one candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('a5', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok('winnerScore' in explanation, 'winnerScore should be present');
    assert.ok(
      !('winnerScoreRatio' in explanation),
      `winnerScoreRatio should be absent with single candidate, found: ${explanation.winnerScoreRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('AAAAAA-6: winnerScoreRatio present regardless of focus (focus inactive)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('a6', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools }); // no focus
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok('winnerScoreRatio' in explanation,
      `winnerScoreRatio should be present without focus; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('AAAAAA-7: winnerScoreRatio present regardless of focus (focus active)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('a7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focus' in explanation, 'focus should be active');
    assert.ok('winnerScoreRatio' in explanation,
      `winnerScoreRatio should be present with focus active; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('AAAAAA-8: tool description documents winnerScoreRatio', async () => {
  const path = dlqPath('a8');
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
      cast.description?.includes('winnerScoreRatio'),
      `cast description should mention winnerScoreRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
