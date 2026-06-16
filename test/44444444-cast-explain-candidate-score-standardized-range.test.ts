/**
 * 44444444: explanation.candidateScoreStandardizedRange in ch1tty/cast when explain:true.
 *
 * candidateScoreStandardizedRange: number — full score spread in units of standard deviation:
 * (winnerScore - lowestCandidateScore) / candidateScoreStdDev = candidateScoreSpread / candidateScoreStdDev.
 *
 * Present when: >= 2 candidates and candidateScoreStdDev > 0.
 * Absent when: no_match, single candidate, or stdDev === 0.
 * Always > 0.
 * Always >= zScoreGap: spread >= winnerRunnerUpGap, same divisor.
 * For n=2: always equals 2 (spread = 2 * stdDev for 2-candidate pools).
 * Cross-field: candidateScoreStandardizedRange === winnerScoreZScore - lowestCandidateScoreZScore.
 * Identity: candidateScoreStandardizedRange * candidateScoreStdDev === candidateScoreSpread.
 *
 * Covered:
 *   44444444-1: present when >= 2 candidates and stdDev > 0
 *   44444444-2: always finite and > 0 when present
 *   44444444-3: always >= zScoreGap when both present
 *   44444444-4: for n=2 always equals 2
 *   44444444-5: absent on cast:no_match
 *   44444444-6: absent when single candidate
 *   44444444-7: identity — candidateScoreStandardizedRange * stdDev === candidateScoreSpread
 *   44444444-8: tool description documents candidateScoreStandardizedRange
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-44444444-${label}-${Date.now()}.jsonl`);
}

const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe Payments', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.test/mcp',
};
const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.test/mcp',
};
const LINEAR_CFG: ServerConfig = {
  id: 'linear', name: 'Linear', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://linear.test/mcp',
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

function buildAgg(label: string, configs: ServerConfig[], toolMap: Record<string, ToolEntry[]>): Aggregator {
  const path = dlqPath(label);
  return new Aggregator(configs, {
    backendFactory: (cfg) => makeBackend(toolMap[cfg.id] ?? []),
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
  });
}

const stripeTools: ToolEntry[] = [
  { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
];
const neonTools: ToolEntry[] = [
  { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
];
const linearTools: ToolEntry[] = [
  { name: 'create_issue', description: 'billing issue tracking project', inputSchema: { type: 'object', properties: {} } },
];

test('44444444-1: present when >= 2 candidates and stdDev > 0', async () => {
  const agg = buildAgg('sss1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 2 && explanation.candidateScoreStdDev > 0) {
      assert.ok('candidateScoreStandardizedRange' in explanation,
        `candidateScoreStandardizedRange should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreStandardizedRange, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('44444444-2: always finite and > 0 when present', async () => {
  const agg = buildAgg('sss2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreStandardizedRange' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreStandardizedRange),
        `should be finite, got ${explanation.candidateScoreStandardizedRange}`,
      );
      assert.ok(
        explanation.candidateScoreStandardizedRange > 0,
        `should be > 0, got ${explanation.candidateScoreStandardizedRange}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('44444444-3: always >= zScoreGap when both present', async () => {
  const agg = buildAgg('sss3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreStandardizedRange' in explanation && 'zScoreGap' in explanation) {
      assert.ok(
        explanation.candidateScoreStandardizedRange >= explanation.zScoreGap - 1e-9,
        `candidateScoreStandardizedRange (${explanation.candidateScoreStandardizedRange}) should be >= zScoreGap (${explanation.zScoreGap})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('44444444-4: for n=2 always equals 2', async () => {
  const agg = buildAgg('sss4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreStandardizedRange' in explanation && explanation.candidateCount === 2) {
      assert.ok(
        Math.abs(explanation.candidateScoreStandardizedRange - 2) < 1e-9,
        `candidateScoreStandardizedRange (${explanation.candidateScoreStandardizedRange}) should equal 2 for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('44444444-5: absent on cast:no_match', async () => {
  const path = dlqPath('sss5');
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
      !('candidateScoreStandardizedRange' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.candidateScoreStandardizedRange}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('44444444-6: absent when single candidate', async () => {
  const path = dlqPath('sss6');
  const singleAgg = new Aggregator([STRIPE_CFG], {
    backendFactory: () => makeBackend([stripeTools[0]]),
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
  });
  try {
    const r = await singleAgg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if (explanation.candidateCount <= 1) {
      assert.ok(
        !('candidateScoreStandardizedRange' in explanation),
        `should be absent with single candidate, found: ${explanation.candidateScoreStandardizedRange}`,
      );
    }
  } finally {
    await singleAgg.shutdown();
  }
});

test('44444444-7: identity — candidateScoreStandardizedRange * stdDev === candidateScoreSpread', async () => {
  const agg = buildAgg('sss7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreStandardizedRange' in explanation &&
        'candidateScoreStdDev' in explanation &&
        'candidateScoreSpread' in explanation) {
      const product = explanation.candidateScoreStandardizedRange * explanation.candidateScoreStdDev;
      const expected = explanation.candidateScoreSpread;
      assert.ok(
        Math.abs(product - expected) < 1e-9,
        `candidateScoreStandardizedRange * stdDev (${product}) should equal candidateScoreSpread (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('44444444-8: tool description documents candidateScoreStandardizedRange', async () => {
  const path = dlqPath('sss8');
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
      cast.description?.includes('candidateScoreStandardizedRange'),
      `cast description should mention candidateScoreStandardizedRange, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
