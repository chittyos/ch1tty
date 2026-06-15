/**
 * TTTTT: explanation.runnerUpServer in ch1tty/cast when explain:true.
 *
 * runnerUpServer: string — the server ID of the runner-up tool (segment before "/" in
 * the namespaced name, e.g. "neon" from "neon/query_database").
 *
 * Present under the same conditions as runnerUpTool / runnerUpScore:
 *   a winner exists AND at least one runner-up candidate exists (candidateCount >= 2).
 * Absent on cast:no_match (no winner) or when only one candidate exists.
 * Independent of focus — present regardless of whether focus is active.
 *
 * Covered:
 *   TTTTT-1: runnerUpServer present when winner + runner-up exist
 *   TTTTT-2: runnerUpServer is a non-empty string when present
 *   TTTTT-3: runnerUpServer equals the server portion of runnerUpTool
 *   TTTTT-4: runnerUpServer absent on cast:no_match (no candidates)
 *   TTTTT-5: runnerUpServer absent when only one candidate (no runner-up)
 *   TTTTT-6: runnerUpServer present regardless of focus (focus inactive case)
 *   TTTTT-7: runnerUpServer present regardless of focus (focus active case)
 *   TTTTT-8: tool description documents runnerUpServer
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
  return join(tmpdir(), `ch1tty-ttttt-${label}-${Date.now()}.jsonl`);
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

test('TTTTT-1: runnerUpServer present when winner + runner-up exist', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing database query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('runnerUpServer' in explanation,
      `runnerUpServer should be present when winner + runner-up exist; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('TTTTT-2: runnerUpServer is a non-empty string when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing database query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('runnerUpServer' in explanation, 'runnerUpServer should be present');
    assert.equal(typeof explanation.runnerUpServer, 'string', 'runnerUpServer should be a string');
    assert.ok(explanation.runnerUpServer.length > 0, 'runnerUpServer should be non-empty');
  } finally {
    await agg.shutdown();
  }
});

test('TTTTT-3: runnerUpServer equals server portion of runnerUpTool', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing database query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('runnerUpServer' in explanation, 'runnerUpServer should be present');
    assert.ok('runnerUpTool' in explanation, 'runnerUpTool should be present');
    const expectedServer = explanation.runnerUpTool.split('/')[0];
    assert.equal(
      explanation.runnerUpServer, expectedServer,
      `runnerUpServer (${explanation.runnerUpServer}) should equal runnerUpTool.split('/')[0] (${expectedServer})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('TTTTT-4: runnerUpServer absent on cast:no_match (no candidates)', async () => {
  const path = dlqPath('t4');
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
      !('runnerUpServer' in parsed.explanation),
      `runnerUpServer should be absent on no_match, found: ${parsed.explanation.runnerUpServer}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('TTTTT-5: runnerUpServer absent when only one candidate', async () => {
  // Only stripe, single tool → winner exists but no runner-up → runnerUpServer absent.
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('t5', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(
      !('runnerUpServer' in explanation),
      `runnerUpServer should be absent with only one candidate, found: ${explanation.runnerUpServer}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('TTTTT-6: runnerUpServer present regardless of focus (focus inactive)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing database query', inputSchema: { type: 'object', properties: {} } },
  ];
  // No focus active
  const agg = buildAgg('t6', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok('runnerUpServer' in explanation,
      `runnerUpServer should be present even without focus; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('TTTTT-7: runnerUpServer present regardless of focus (focus active)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing database query', inputSchema: { type: 'object', properties: {} } },
  ];
  // Finance focus active (stripe in-focus)
  const agg = buildAgg('t7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focus' in explanation, 'focus should be active');
    assert.ok('runnerUpServer' in explanation,
      `runnerUpServer should be present with focus active; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('TTTTT-8: tool description documents runnerUpServer', async () => {
  const path = dlqPath('t8');
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
      cast.description?.includes('runnerUpServer'),
      `cast description should mention runnerUpServer, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
