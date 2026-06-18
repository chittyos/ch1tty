/**
 * HHHHHH: explanation.topCandidatesScoreStdDev in ch1tty/cast when explain:true.
 *
 * topCandidatesScoreStdDev: number — standard deviation of topCandidates scores
 * (sqrt of topCandidatesScoreVariance).
 *
 * Present when: >= 2 topCandidates (same as topCandidatesScoreVariance).
 * Absent when: 0 or 1 candidate (no_match or single-tool registry).
 * Always >= 0.
 * Identity: topCandidatesScoreStdDev^2 === topCandidatesScoreVariance.
 *
 * Covered:
 *   HHHHHH-1: topCandidatesScoreStdDev present when >= 2 candidates
 *   HHHHHH-2: topCandidatesScoreStdDev >= 0 always when present
 *   HHHHHH-3: topCandidatesScoreStdDev^2 === topCandidatesScoreVariance
 *   HHHHHH-4: topCandidatesScoreStdDev absent on cast:no_match
 *   HHHHHH-5: topCandidatesScoreStdDev absent when only one candidate
 *   HHHHHH-6: topCandidatesScoreStdDev present regardless of focus (focus inactive)
 *   HHHHHH-7: topCandidatesScoreStdDev present regardless of focus (focus active)
 *   HHHHHH-8: tool description documents topCandidatesScoreStdDev
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
  return join(tmpdir(), `ch1tty-hhhhhh-${label}-${Date.now()}.jsonl`);
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

test('HHHHHH-1: topCandidatesScoreStdDev present when >= 2 candidates', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('h1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates for this test');
    assert.ok('topCandidatesScoreStdDev' in explanation,
      `topCandidatesScoreStdDev should be present when >= 2 candidates; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.topCandidatesScoreStdDev, 'number', 'topCandidatesScoreStdDev should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('HHHHHH-2: topCandidatesScoreStdDev >= 0 always when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('h2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('topCandidatesScoreStdDev' in explanation, 'topCandidatesScoreStdDev should be present');
    assert.ok(
      explanation.topCandidatesScoreStdDev >= 0,
      `topCandidatesScoreStdDev should be >= 0, got ${explanation.topCandidatesScoreStdDev}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('HHHHHH-3: topCandidatesScoreStdDev^2 === topCandidatesScoreVariance', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('h3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('topCandidatesScoreStdDev' in explanation, 'topCandidatesScoreStdDev should be present');
    assert.ok('topCandidatesScoreVariance' in explanation, 'topCandidatesScoreVariance should be present');
    const computed = explanation.topCandidatesScoreStdDev ** 2;
    assert.ok(
      Math.abs(computed - explanation.topCandidatesScoreVariance) < 1e-9,
      `topCandidatesScoreStdDev^2 (${computed}) should equal topCandidatesScoreVariance (${explanation.topCandidatesScoreVariance})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('HHHHHH-4: topCandidatesScoreStdDev absent on cast:no_match', async () => {
  const path = dlqPath('h4');
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
    assert.ok(
      !('topCandidatesScoreStdDev' in parsed.explanation),
      `topCandidatesScoreStdDev should be absent on no_match, found: ${parsed.explanation.topCandidatesScoreStdDev}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('HHHHHH-5: topCandidatesScoreStdDev absent when only one candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('h5', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('topCandidatesScoreStdDev' in explanation),
      `topCandidatesScoreStdDev should be absent with single candidate, found: ${explanation.topCandidatesScoreStdDev}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('HHHHHH-6: topCandidatesScoreStdDev present regardless of focus (focus inactive)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('h6', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools }); // no focus
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok('topCandidatesScoreStdDev' in explanation,
      `topCandidatesScoreStdDev should be present without focus; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('HHHHHH-7: topCandidatesScoreStdDev present regardless of focus (focus active)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('h7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focus' in explanation, 'focus should be active');
    assert.ok('topCandidatesScoreStdDev' in explanation,
      `topCandidatesScoreStdDev should be present with focus active; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('HHHHHH-8: tool description documents topCandidatesScoreStdDev', async () => {
  const path = dlqPath('h8');
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
      cast.description?.includes('topCandidatesScoreStdDev'),
      `cast description should mention topCandidatesScoreStdDev, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
