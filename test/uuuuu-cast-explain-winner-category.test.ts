/**
 * UUUUU: explanation.winnerCategory in ch1tty/cast when explain:true.
 *
 * winnerCategory: string — the server category of the winning tool (e.g. "ecosystem",
 * "code", "communication", "documents", "search", "reasoning", "desktop").
 *
 * Present whenever winnerServer is present (winner exists). Absent on cast:no_match.
 * Independent of focus — present regardless of whether a focus profile is active.
 *
 * Covered:
 *   UUUUU-1: winnerCategory present when winner exists
 *   UUUUU-2: winnerCategory is a non-empty string when present
 *   UUUUU-3: winnerCategory reflects the winning server's configured category
 *   UUUUU-4: winnerCategory absent on cast:no_match (no candidates)
 *   UUUUU-5: winnerCategory present when only one candidate (winner, no runner-up)
 *   UUUUU-6: winnerCategory present regardless of focus (focus inactive)
 *   UUUUU-7: winnerCategory present regardless of focus (focus active)
 *   UUUUU-8: tool description documents winnerCategory
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
  return join(tmpdir(), `ch1tty-uuuuu-${label}-${Date.now()}.jsonl`);
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

test('UUUUU-1: winnerCategory present when winner exists', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'database query sql', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('u1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(
      'winnerCategory' in explanation,
      `winnerCategory should be present when winner exists; keys: ${Object.keys(explanation).join(', ')}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('UUUUU-2: winnerCategory is a non-empty string when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'database query sql', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('u2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('winnerCategory' in explanation, 'winnerCategory should be present');
    assert.equal(typeof explanation.winnerCategory, 'string', 'winnerCategory should be a string');
    assert.ok(explanation.winnerCategory.length > 0, 'winnerCategory should be non-empty');
  } finally {
    await agg.shutdown();
  }
});

test('UUUUU-3: winnerCategory reflects the winning server configured category', async () => {
  // stripe=ecosystem wins the billing intent → winnerCategory should be 'ecosystem'
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'database query sql', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('u3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('winnerCategory' in explanation, 'winnerCategory should be present');
    assert.ok('winnerServer' in explanation, 'winnerServer should be present');
    // winnerServer is 'stripe' (ecosystem) or 'neon' (code) — category must match server config
    const expectedCategory = explanation.winnerServer === 'stripe' ? 'ecosystem' : 'code';
    assert.equal(
      explanation.winnerCategory, expectedCategory,
      `winnerCategory (${explanation.winnerCategory}) should match ${explanation.winnerServer}'s category (${expectedCategory})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('UUUUU-4: winnerCategory absent on cast:no_match (no candidates)', async () => {
  const path = dlqPath('u4');
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
      !('winnerCategory' in parsed.explanation),
      `winnerCategory should be absent on no_match, found: ${parsed.explanation.winnerCategory}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('UUUUU-5: winnerCategory present with single candidate (no runner-up)', async () => {
  // Only one tool → winner exists but no runner-up. winnerCategory should still be present.
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('u5', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(
      !('runnerUpServer' in explanation),
      'runnerUpServer should be absent with only one candidate (confirming single-tool scenario)',
    );
    assert.ok(
      'winnerCategory' in explanation,
      `winnerCategory should be present even without a runner-up; keys: ${Object.keys(explanation).join(', ')}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('UUUUU-6: winnerCategory present regardless of focus (focus inactive)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'database query sql', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('u6', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok(
      'winnerCategory' in explanation,
      `winnerCategory should be present even without focus; keys: ${Object.keys(explanation).join(', ')}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('UUUUU-7: winnerCategory present regardless of focus (focus active)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'database query sql', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('u7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('focus' in explanation, 'finance focus should be active');
    assert.ok(
      'winnerCategory' in explanation,
      `winnerCategory should be present with focus active; keys: ${Object.keys(explanation).join(', ')}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('UUUUU-8: tool description documents winnerCategory', async () => {
  const path = dlqPath('u8');
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
      cast.description?.includes('winnerCategory'),
      `cast description should mention winnerCategory, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
