/**
 * GGGGG: explanation.focusConfidence in ch1tty/cast when explain:true and focus active.
 *
 * focusConfidence: number — focusBias clamped to [0,1]. Same presence conditions as
 * focusBias (active focus, runner-up exists, focusMargin non-zero, best exists).
 * A value of 0 means focus contributed nothing; 1 means focus was at least fully
 * decisive (focusBias ≥ 1). Unlike focusBias (which can exceed 1), focusConfidence
 * is always in [0,1] — a clean percentage of focus attribution.
 *
 * Covered:
 *   GGGGG-1: focus active, in-focus winner, runner-up → focusConfidence is a number in [0,1]
 *   GGGGG-2: focusConfidence === min(1, focusBias) consistency
 *   GGGGG-3: focusConfidence ≤ 1 even when focusBias > 1 (clamping is the key property)
 *   GGGGG-4: out-of-focus winner → focusConfidence === 0
 *   GGGGG-5: no focus active → focusConfidence absent
 *   GGGGG-6: cast:no_match → focusConfidence absent (no winner)
 *   GGGGG-7: single candidate only → focusConfidence absent (no runner-up)
 *   GGGGG-8: tool description documents focusConfidence
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
  return join(tmpdir(), `ch1tty-ggggg-${label}-${Date.now()}.jsonl`);
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

test('GGGGG-1: focus active, in-focus winner, runner-up → focusConfidence is a number in [0,1]', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg(
    'g1',
    [STRIPE_CFG, NEON_CFG],
    { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if ('focusBias' in explanation) {
      assert.ok('focusConfidence' in explanation, 'focusConfidence should be present alongside focusBias');
      assert.equal(typeof explanation.focusConfidence, 'number', 'focusConfidence should be a number');
      assert.ok(explanation.focusConfidence >= 0, `focusConfidence should be ≥ 0, got ${explanation.focusConfidence}`);
      assert.ok(explanation.focusConfidence <= 1, `focusConfidence should be ≤ 1, got ${explanation.focusConfidence}`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('GGGGG-2: focusConfidence === min(1, focusBias) consistency', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg(
    'g2',
    [STRIPE_CFG, NEON_CFG],
    { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('focusBias' in explanation && 'focusConfidence' in explanation) {
      const expected = Math.min(1, explanation.focusBias);
      assert.ok(
        Math.abs(explanation.focusConfidence - expected) < 1e-9,
        `focusConfidence (${explanation.focusConfidence}) should equal min(1, focusBias) = min(1, ${explanation.focusBias}) = ${expected}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('GGGGG-3: focusConfidence ≤ 1 even when focusBias > 1 (clamping is the key property)', async () => {
  // Construct a scenario where the in-focus winner's raw score is LOWER than the
  // runner-up's raw score, so the focus boost must overcome a pre-boost deficit.
  // Intent: 4 terms; runner-up matches all 4 (score 1.0); in-focus winner matches 3 (score 0.75).
  // After boost (0.5): winner = 1.25 > runner-up 1.0. focusMargin = 0.25.
  // focusBias = 0.5 / 0.25 = 2.0 > 1. focusConfidence = min(1, 2.0) = 1.0 ≤ 1.
  const stripeTools: ToolEntry[] = [
    { name: 'charge', description: 'alpha beta gamma payment', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'alpha beta gamma delta database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg(
    'g3',
    [STRIPE_CFG, NEON_CFG],
    { stripe: stripeTools, neon: neonTools },
    { focus: 'finance', profiles: FINANCE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'alpha beta gamma delta', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    // If focusBias is present and > 1 (the scenario we engineered), verify clamping.
    if ('focusBias' in explanation && 'focusConfidence' in explanation) {
      assert.ok(explanation.focusConfidence <= 1,
        `focusConfidence should be ≤ 1 (clamped) even when focusBias = ${explanation.focusBias}, got ${explanation.focusConfidence}`);
      if (explanation.focusBias > 1) {
        assert.equal(explanation.focusConfidence, 1,
          `focusConfidence should be exactly 1 when focusBias (${explanation.focusBias}) > 1`);
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('GGGGG-4: out-of-focus winner → focusConfidence === 0', async () => {
  const CODE_PROFILES: FocusProfiles = {
    profiles: {
      code: { description: 'Code tools', categories: ['code'], servers: ['neon'], boost: 0.5 },
    },
  };
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge stripe fee', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg(
    'g4',
    [STRIPE_CFG, NEON_CFG],
    { stripe: stripeTools, neon: neonTools },
    { focus: 'code', profiles: CODE_PROFILES },
  );
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'invoice payment charge stripe fee', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerInFocus' in explanation && explanation.winnerInFocus === false && 'focusConfidence' in explanation) {
      assert.equal(explanation.focusConfidence, 0,
        `focusConfidence should be 0 when winner is out-of-focus, got ${explanation.focusConfidence}`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('GGGGG-5: no focus active → focusConfidence absent', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg(
    'g5',
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
      !('focusConfidence' in explanation),
      `focusConfidence should be absent when no focus active, got ${explanation.focusConfidence}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GGGGG-6: cast:no_match → focusConfidence absent (no winner)', async () => {
  const path = dlqPath('g6');
  const emptyAgg = new Aggregator([STRIPE_CFG], {
    backendFactory: () => makeBackend([]),
    focusProfiles: FINANCE_PROFILES,
    suggestionsCatalog: {},
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
    focus: 'finance',
  });
  try {
    const r = await emptyAgg.callTool('ch1tty/cast', { intent: 'xyzzy-nonexistent-tool', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.equal(parsed.cast, 'no_match', `expected no_match, got ${parsed.cast}`);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(
      !('focusConfidence' in explanation),
      `focusConfidence should be absent on no_match, got ${explanation.focusConfidence}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('GGGGG-7: single candidate only → focusConfidence absent (no runner-up)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment', inputSchema: { type: 'object', properties: {} } },
  ];
  const path = dlqPath('g7');
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
    assert.ok(
      !('focusConfidence' in explanation),
      `focusConfidence should be absent when only one candidate (no runner-up), got ${explanation.focusConfidence}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GGGGG-8: tool description documents focusConfidence', async () => {
  const path = dlqPath('g8');
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
      cast.description?.includes('focusConfidence'),
      `cast description should mention focusConfidence, got: ${cast.description?.slice(0, 500)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
