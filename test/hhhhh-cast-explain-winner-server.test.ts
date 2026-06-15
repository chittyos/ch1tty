/**
 * HHHHH: explanation.winnerServer in ch1tty/cast when explain:true and a winner exists.
 *
 * winnerServer: string — the server ID of the winning tool (the segment before "/"
 * in its namespaced name, e.g. "neon" from "neon/query_database"). Absent on no_match.
 * Lets operators identify which backend resolved the intent without parsing the tool name.
 *
 * Covered:
 *   HHHHH-1: winner exists → winnerServer equals the tool's server ID
 *   HHHHH-2: winnerServer matches the prefix of the winning namespaced tool name
 *   HHHHH-3: cast:no_match → winnerServer absent
 *   HHHHH-4: focus active, in-focus winner → winnerServer present
 *   HHHHH-5: focus active, out-of-focus winner → winnerServer still present
 *   HHHHH-6: no focus active → winnerServer present (independent of focus)
 *   HHHHH-7: single candidate → winnerServer present (only requires a winner, not a runner-up)
 *   HHHHH-8: tool description documents winnerServer
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
  return join(tmpdir(), `ch1tty-hhhhh-${label}-${Date.now()}.jsonl`);
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

test('HHHHH-1: winner exists → winnerServer equals the tool\'s server ID', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('h1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('winnerServer' in explanation, 'winnerServer should be present when a winner exists');
    assert.equal(typeof explanation.winnerServer, 'string', 'winnerServer should be a string');
    // winner tool is stripe/create_invoice or neon/run_sql — server must be one of the known IDs
    assert.ok(
      explanation.winnerServer === 'stripe' || explanation.winnerServer === 'neon',
      `winnerServer should be "stripe" or "neon", got "${explanation.winnerServer}"`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('HHHHH-2: winnerServer matches the prefix of the winning namespaced tool name', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('h2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    // topCandidates[0].tool is the winning namespaced name
    if ('winnerServer' in explanation && explanation.topCandidates?.length > 0) {
      const winnerTool: string = explanation.topCandidates[0].tool;
      const expectedServer = winnerTool.split('/')[0];
      assert.equal(
        explanation.winnerServer,
        expectedServer,
        `winnerServer "${explanation.winnerServer}" should match prefix of winning tool "${winnerTool}"`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('HHHHH-3: cast:no_match → winnerServer absent', async () => {
  const path = dlqPath('h3');
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
    const { explanation } = parsed;
    assert.ok(
      !('winnerServer' in explanation),
      `winnerServer should be absent on no_match, got "${explanation.winnerServer}"`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('HHHHH-4: focus active, in-focus winner → winnerServer present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge fee', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg(
    'h4',
    [STRIPE_CFG, NEON_CFG],
    { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge fee', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('winnerServer' in explanation, 'winnerServer should be present even with active focus');
    assert.equal(typeof explanation.winnerServer, 'string', 'winnerServer should be a string');
  } finally {
    await agg.shutdown();
  }
});

test('HHHHH-5: focus active, out-of-focus winner → winnerServer still present', async () => {
  // Use code focus → neon is in-focus; stripe dominates intent → stripe wins (out-of-focus)
  const CODE_PROFILES: FocusProfiles = {
    profiles: {
      code: { description: 'Code tools', categories: ['code'], servers: ['neon'], boost: 0.5 },
    },
  };
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'invoice payment charge stripe fee refund', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'sql query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg(
    'h5',
    [STRIPE_CFG, NEON_CFG],
    { stripe: stripeTools, neon: neonTools },
    { focus: 'code', profiles: CODE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'invoice payment charge stripe fee refund', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('winnerServer' in explanation, 'winnerServer should be present even when winner is out-of-focus');
    assert.equal(typeof explanation.winnerServer, 'string', 'winnerServer should be a string');
  } finally {
    await agg.shutdown();
  }
});

test('HHHHH-6: no focus active → winnerServer present (independent of focus)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('h6', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(
      !('focus' in explanation),
      `focus should be absent when no focus active, got "${explanation.focus}"`,
    );
    assert.ok('winnerServer' in explanation, 'winnerServer should be present even without a focus profile');
    assert.equal(typeof explanation.winnerServer, 'string', 'winnerServer should be a string');
  } finally {
    await agg.shutdown();
  }
});

test('HHHHH-7: single candidate → winnerServer present (only requires a winner, not a runner-up)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment', inputSchema: { type: 'object', properties: {} } },
  ];
  const path = dlqPath('h7');
  const agg = new Aggregator([STRIPE_CFG], {
    backendFactory: () => makeBackend(stripeTools),
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
  });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    // No runner-up with a single backend tool
    assert.ok(!('runnerUpTool' in explanation), 'runnerUpTool should be absent with a single candidate');
    // But winnerServer should still be present
    assert.ok('winnerServer' in explanation, 'winnerServer should be present even with a single candidate');
    assert.equal(explanation.winnerServer, 'stripe', `expected "stripe", got "${explanation.winnerServer}"`);
  } finally {
    await agg.shutdown();
  }
});

test('HHHHH-8: tool description documents winnerServer', async () => {
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
      cast.description?.includes('winnerServer'),
      `cast description should mention winnerServer, got: ${cast.description?.slice(0, 500)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
