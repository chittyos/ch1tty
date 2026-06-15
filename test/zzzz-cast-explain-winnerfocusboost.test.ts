/**
 * ZZZZ: explanation.winnerFocusBoost in ch1tty/cast when explain:true and focus active.
 *
 * winnerFocusBoost is the exact additive boost applied to the winning tool by the active
 * focus profile: equals focusBoost when winnerInFocus is true; 0 when winnerInFocus is
 * false (winner was out-of-focus). Absent when no focus profile is active.
 *
 * Callers can compute focus-decisiveness:
 *   if winnerScore - winnerFocusBoost < runnerUpScore → winner would not have won without focus.
 *
 * Covered:
 *   ZZZZ-1: focus active + winner in-focus → winnerFocusBoost equals profile boost
 *   ZZZZ-2: focus active + winner out-of-focus → winnerFocusBoost is 0
 *   ZZZZ-3: no focus active → winnerFocusBoost absent
 *   ZZZZ-4: cast:plan (confirm:true) + focus + in-focus winner → winnerFocusBoost present
 *   ZZZZ-5: winnerFocusBoost === focusBoost when winnerInFocus (consistency)
 *   ZZZZ-6: cast:no_match → winnerFocusBoost absent (no winner)
 *   ZZZZ-7: tool description documents winnerFocusBoost
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-zzzz-${label}-${Date.now()}.jsonl`);
}

// Stripe: ecosystem category → in-focus under finance
const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe Payments', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.test/mcp',
};
// Neon: code category → out-of-focus under finance
const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.test/mcp',
};

const STRIPE_TOOLS: ToolEntry[] = [
  { name: 'create_invoice', description: 'Create Stripe billing invoice for customer payment', inputSchema: { type: 'object', properties: {} } },
];
const NEON_TOOLS: ToolEntry[] = [
  { name: 'run_sql', description: 'Execute SQL queries on the Neon database for code analysis', inputSchema: { type: 'object', properties: {} } },
];

import type { FocusProfiles } from '../src/focus.js';

// Finance focus: boosts ecosystem (stripe) by 0.5; code (neon) is out-of-focus
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
  opts: { focus?: string; profiles?: typeof FINANCE_PROFILES } = {},
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

test('ZZZZ-1: focus active + winner in-focus → winnerFocusBoost equals profile boost', async () => {
  const agg = buildAgg(
    'z1',
    [STRIPE_CFG, NEON_CFG],
    { stripe: STRIPE_TOOLS, neon: NEON_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('winnerFocusBoost' in explanation, 'winnerFocusBoost absent');
    assert.ok(explanation.winnerInFocus === true, `expected winnerInFocus true, got ${explanation.winnerInFocus}`);
    assert.equal(
      explanation.winnerFocusBoost,
      FINANCE_PROFILES.profiles.finance.boost,
      `winnerFocusBoost (${explanation.winnerFocusBoost}) should equal profile boost (${FINANCE_PROFILES.profiles.finance.boost})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZ-2: focus active + winner out-of-focus → winnerFocusBoost is 0', async () => {
  const agg = buildAgg(
    'z2',
    [STRIPE_CFG, NEON_CFG],
    { stripe: STRIPE_TOOLS, neon: NEON_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    // "run sql query on database" strongly matches neon (code) → wins despite no finance boost
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query on database', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('winnerFocusBoost' in explanation, 'winnerFocusBoost absent');
    assert.ok(explanation.winnerInFocus === false, `expected winnerInFocus false, got ${explanation.winnerInFocus}`);
    assert.equal(
      explanation.winnerFocusBoost,
      0,
      `winnerFocusBoost should be 0 when winner out-of-focus, got ${explanation.winnerFocusBoost}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZ-3: no focus active → winnerFocusBoost absent', async () => {
  const agg = buildAgg(
    'z3',
    [STRIPE_CFG, NEON_CFG],
    { stripe: STRIPE_TOOLS, neon: NEON_TOOLS },
    // no focus, no profiles
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(!('winnerFocusBoost' in explanation), `winnerFocusBoost should be absent without focus, got ${explanation.winnerFocusBoost}`);
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZ-4: cast:plan (confirm:true) + focus + in-focus winner → winnerFocusBoost present', async () => {
  const agg = buildAgg(
    'z4',
    [STRIPE_CFG, NEON_CFG],
    { stripe: STRIPE_TOOLS, neon: NEON_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', confirm: true, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'plan', `expected plan, got ${parsed.cast}`);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('winnerFocusBoost' in explanation, 'winnerFocusBoost absent in plan explanation');
    assert.equal(typeof explanation.winnerFocusBoost, 'number', 'winnerFocusBoost should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZ-5: winnerFocusBoost === focusBoost when winnerInFocus (consistency with explanation.focusBoost)', async () => {
  const agg = buildAgg(
    'z5',
    [STRIPE_CFG, NEON_CFG],
    { stripe: STRIPE_TOOLS, neon: NEON_TOOLS },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'create invoice billing payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.winnerInFocus) {
      assert.equal(
        explanation.winnerFocusBoost,
        explanation.focusBoost,
        `when winnerInFocus, winnerFocusBoost (${explanation.winnerFocusBoost}) should equal focusBoost (${explanation.focusBoost})`,
      );
    } else {
      assert.equal(
        explanation.winnerFocusBoost,
        0,
        `when !winnerInFocus, winnerFocusBoost (${explanation.winnerFocusBoost}) should be 0`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZ-6: cast:no_match → winnerFocusBoost absent (no winner)', async () => {
  const path = dlqPath('z6');
  const emptyAgg = new Aggregator([STRIPE_CFG], {
    backendFactory: () => makeBackend([]),
    focusProfiles: FINANCE_PROFILES,
    suggestionsCatalog: {},
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
    focus: 'finance',
  });
  try {
    const r = await emptyAgg.callTool('ch1tty/cast', { intent: 'xyzzy-nonexistent', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'no_match', `expected no_match, got ${parsed.cast}`);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(
      !('winnerFocusBoost' in explanation),
      `winnerFocusBoost should be absent on no_match, got ${explanation.winnerFocusBoost}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('ZZZZ-7: tool description documents winnerFocusBoost', async () => {
  const path = dlqPath('z7');
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
      cast.description?.includes('winnerFocusBoost'),
      `cast description should mention winnerFocusBoost, got: ${cast.description?.slice(0, 500)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
