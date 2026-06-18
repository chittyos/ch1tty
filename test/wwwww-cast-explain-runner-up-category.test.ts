/**
 * WWWWW: explanation.runnerUpCategory in ch1tty/cast when explain:true.
 *
 * runnerUpCategory: string — the category of the server that owns the runner-up tool
 * (e.g. "ecosystem", "code", "search", "reasoning").
 *
 * Present when: a runner-up exists (same conditions as runnerUpServer and runnerUpScore).
 * Absent when: cast:no_match or only one candidate (no runner-up).
 * Parallels winnerCategory for the runner-up slot.
 *
 * Covered:
 *   WWWWW-1: runnerUpCategory present when runner-up exists
 *   WWWWW-2: runnerUpCategory is a non-empty string when present
 *   WWWWW-3: runnerUpCategory matches the category of the runner-up server
 *   WWWWW-4: runnerUpCategory absent on cast:no_match
 *   WWWWW-5: runnerUpCategory absent when only one candidate
 *   WWWWW-6: runnerUpCategory present regardless of focus (focus inactive)
 *   WWWWW-7: runnerUpCategory present regardless of focus (focus active)
 *   WWWWW-8: tool description documents runnerUpCategory
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
  return join(tmpdir(), `ch1tty-wwwww-${label}-${Date.now()}.jsonl`);
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

test('WWWWW-1: runnerUpCategory present when runner-up exists', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('runnerUpServer' in explanation, 'runnerUpServer should be present (runner-up exists)');
    assert.ok('runnerUpCategory' in explanation,
      `runnerUpCategory should be present when runner-up exists; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.runnerUpCategory, 'string', 'runnerUpCategory should be a string');
  } finally {
    await agg.shutdown();
  }
});

test('WWWWW-2: runnerUpCategory is a non-empty string when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('runnerUpCategory' in explanation, 'runnerUpCategory should be present');
    assert.ok(explanation.runnerUpCategory.length > 0, 'runnerUpCategory should be non-empty');
  } finally {
    await agg.shutdown();
  }
});

test('WWWWW-3: runnerUpCategory matches the category of the runner-up server', async () => {
  // stripe wins (billing intent), neon is runner-up with category 'code'
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('runnerUpCategory' in explanation, 'runnerUpCategory should be present');
    assert.equal(explanation.winnerServer, 'stripe', 'stripe should be winner');
    assert.equal(explanation.runnerUpServer, 'neon', 'neon should be runner-up');
    assert.equal(explanation.runnerUpCategory, 'code',
      `runnerUpCategory should be 'code' for neon runner-up, got: ${explanation.runnerUpCategory}`);
  } finally {
    await agg.shutdown();
  }
});

test('WWWWW-4: runnerUpCategory absent on cast:no_match', async () => {
  const path = dlqPath('w4');
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
      !('runnerUpCategory' in parsed.explanation),
      `runnerUpCategory should be absent on no_match, found: ${parsed.explanation.runnerUpCategory}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('WWWWW-5: runnerUpCategory absent when only one candidate', async () => {
  // Only one tool → no runner-up → runnerUpCategory absent
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w5', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('winnerCategory' in explanation, 'winnerCategory should be present');
    assert.ok(
      !('runnerUpCategory' in explanation),
      `runnerUpCategory should be absent with single candidate, found: ${explanation.runnerUpCategory}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('WWWWW-6: runnerUpCategory present regardless of focus (focus inactive)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w6', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools }); // no focus
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok('runnerUpCategory' in explanation,
      `runnerUpCategory should be present without focus; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('WWWWW-7: runnerUpCategory present regardless of focus (focus active)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focus' in explanation, 'focus should be active');
    assert.ok('runnerUpCategory' in explanation,
      `runnerUpCategory should be present with focus active; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('WWWWW-8: tool description documents runnerUpCategory', async () => {
  const path = dlqPath('w8');
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
      cast.description?.includes('runnerUpCategory'),
      `cast description should mention runnerUpCategory, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
