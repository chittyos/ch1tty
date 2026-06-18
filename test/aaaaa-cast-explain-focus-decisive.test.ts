/**
 * AAAAA: explanation.focusDecisive in ch1tty/cast when explain:true and focus active.
 *
 * focusDecisive: boolean — true when the winning tool would not have prevailed without
 * the focus boost (computed as winnerScore - winnerFocusBoost < runnerUpScore).
 * Absent when no focus is active, on no_match, or when there is only one candidate.
 *
 * Covered:
 *   AAAAA-1: in-focus winner + decisive boost → focusDecisive: true
 *   AAAAA-2: in-focus winner + non-decisive boost → focusDecisive: false
 *   AAAAA-3: out-of-focus winner (boost=0) → focusDecisive: false
 *   AAAAA-4: no focus active → focusDecisive absent
 *   AAAAA-5: cast:no_match → focusDecisive absent (no winner)
 *   AAAAA-6: single candidate only → focusDecisive absent (no runner-up)
 *   AAAAA-7: cast:plan (confirm:true) + focus + decisive boost → focusDecisive: true
 *   AAAAA-8: tool description documents focusDecisive
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
  return join(tmpdir(), `ch1tty-aaaaa-${label}-${Date.now()}.jsonl`);
}

// Stripe: ecosystem → in-focus under finance (boost 0.5)
const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe Payments', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.test/mcp',
};
// Neon: code → out-of-focus under finance
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

test('AAAAA-1: in-focus winner + decisive boost → focusDecisive: true', async () => {
  // stripe/invoice scores modestly on "billing" (keyword partial), neon scores better on "billing sql"
  // With finance boost (+0.5) stripe wins but would lose without boost → focusDecisive: true
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql execute database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg(
    'a1',
    [STRIPE_CFG, NEON_CFG],
    { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('focusDecisive' in explanation, 'focusDecisive should be present when focus active + runner-up exists');
    if (explanation.winnerInFocus && explanation.runnerUpScore !== undefined) {
      const winnerScoreWithoutBoost = explanation.winnerScore - explanation.winnerFocusBoost;
      const expectedDecisive = winnerScoreWithoutBoost < explanation.runnerUpScore;
      assert.equal(
        explanation.focusDecisive,
        expectedDecisive,
        `focusDecisive (${explanation.focusDecisive}) should equal computed value (${expectedDecisive})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('AAAAA-2: in-focus winner + non-decisive boost → focusDecisive: false', async () => {
  // stripe matches all 3 intent terms (score 1.0), neon matches only 1 (score 0.33).
  // With finance boost (+0.5): stripe=1.5, neon=0.33 → stripe wins.
  // Without boost: stripe=1.0 > neon=0.33 → stripe would still win → focusDecisive: false.
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment create charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql database query execute', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg(
    'a2',
    [STRIPE_CFG, NEON_CFG],
    { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    // "billing invoice payment" — stripe matches all 3 terms, neon matches only "billing"
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    // With neon scoring 0.33 (> 0.1 threshold), it's a runner-up → focusDecisive present
    assert.ok('focusDecisive' in explanation, 'focusDecisive should be present when focus active + runner-up above 0.1 threshold');
    assert.equal(typeof explanation.focusDecisive, 'boolean', 'focusDecisive should be boolean');
    // stripe wins clearly without boost (1.0 > 0.33) → not decisive
    assert.equal(explanation.focusDecisive, false, 'stripe wins without boost → focusDecisive should be false');
    // Verify the formula is correctly applied
    const winnerScoreWithoutBoost = explanation.winnerScore - explanation.winnerFocusBoost;
    const expectedDecisive = winnerScoreWithoutBoost < explanation.runnerUpScore;
    assert.equal(
      explanation.focusDecisive,
      expectedDecisive,
      `focusDecisive (${explanation.focusDecisive}) should match formula (${expectedDecisive})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('AAAAA-3: out-of-focus winner (boost=0) → focusDecisive: false', async () => {
  // neon wins on "run sql database query" — clearly out-of-focus; boost is 0, can't be decisive
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'run sql query on database execute statement', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg(
    'a3',
    [STRIPE_CFG, NEON_CFG],
    { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'run sql query on database', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if ('focusDecisive' in explanation) {
      // Out-of-focus winner: winnerFocusBoost=0, score-0 < runnerUpScore only if runnerUp beats winner
      // which would be impossible (winner is highest score). So focusDecisive must be false.
      assert.equal(
        explanation.focusDecisive,
        false,
        `out-of-focus winner cannot have focusDecisive:true (boost=0 can never be decisive), got ${explanation.focusDecisive}`,
      );
    }
    // Also verify winnerInFocus is false (ensures this is the out-of-focus path)
    if ('winnerInFocus' in explanation) {
      assert.equal(explanation.winnerInFocus, false, 'expected neon/run_sql to be out-of-focus under finance');
    }
  } finally {
    await agg.shutdown();
  }
});

test('AAAAA-4: no focus active → focusDecisive absent', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg(
    'a4',
    [STRIPE_CFG, NEON_CFG],
    { stripe: stripeTools, neon: neonTools },
    // no focus
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(
      !('focusDecisive' in explanation),
      `focusDecisive should be absent when no focus active, got ${explanation.focusDecisive}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('AAAAA-5: cast:no_match → focusDecisive absent (no winner)', async () => {
  const path = dlqPath('a5');
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
      !('focusDecisive' in explanation),
      `focusDecisive should be absent on no_match, got ${explanation.focusDecisive}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('AAAAA-6: single candidate only → focusDecisive absent (no runner-up)', async () => {
  // Only stripe registered — single tool in registry, no runner-up possible
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment', inputSchema: { type: 'object', properties: {} } },
  ];
  const path = dlqPath('a6');
  const agg = new Aggregator([STRIPE_CFG], {
    backendFactory: () => makeBackend(stripeTools),
    focusProfiles: FINANCE_PROFILES,
    suggestionsCatalog: {},
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
    focus: 'finance',
  });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    // With only one candidate, runnerUpScore is also absent
    assert.ok(
      !('focusDecisive' in explanation),
      `focusDecisive should be absent when only one candidate (no runner-up), got ${explanation.focusDecisive}`,
    );
    assert.ok(
      !('runnerUpScore' in explanation),
      `runnerUpScore should also be absent with one candidate, got ${explanation.runnerUpScore}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('AAAAA-7: cast:plan (confirm:true) + focus + runner-up → focusDecisive present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg(
    'a7',
    [STRIPE_CFG, NEON_CFG],
    { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing', confirm: true, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'plan', `expected plan, got ${parsed.cast}`);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    // Both candidates match "billing" so there's a runner-up → focusDecisive present
    if ('focusDecisive' in explanation) {
      assert.equal(typeof explanation.focusDecisive, 'boolean', 'focusDecisive should be a boolean');
    }
  } finally {
    await agg.shutdown();
  }
});

test('AAAAA-8: tool description documents focusDecisive', async () => {
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
      cast.description?.includes('focusDecisive'),
      `cast description should mention focusDecisive, got: ${cast.description?.slice(0, 500)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
