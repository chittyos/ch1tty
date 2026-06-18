/**
 * XXXXXXX: explanation.candidateScoreP80Range in ch1tty/cast when explain:true.
 *
 * candidateScoreP80Range: number — candidateScoreP90 - candidateScoreP10.
 * The 80th-percentile range; covers the middle 80% of the score distribution.
 *
 * Present when: >= 2 candidates.
 * Absent when: no_match or single candidate.
 * Always >= 0 (P10 <= P90 always).
 * Always <= candidateScoreSpread (80% range <= full range).
 * Always >= candidateScoreIQR (80% range >= 50% range).
 * For n=2: candidateScoreP80Range = 0.8 * winnerRunnerUpGap.
 * Identity: candidateScoreP80Range === candidateScoreP90 - candidateScoreP10.
 *
 * Covered:
 *   XXXXXXX-1: present when >= 2 candidates
 *   XXXXXXX-2: always >= 0 and finite when present
 *   XXXXXXX-3: identity — equals candidateScoreP90 - candidateScoreP10
 *   XXXXXXX-4: for n=2: equals 0.8 * winnerRunnerUpGap
 *   XXXXXXX-5: absent on cast:no_match
 *   XXXXXXX-6: absent when only 1 candidate
 *   XXXXXXX-7: always <= candidateScoreSpread
 *   XXXXXXX-8: tool description documents candidateScoreP80Range
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-xxxxxxx-${label}-${Date.now()}.jsonl`);
}

const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe Payments', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.test/mcp',
};
const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.test/mcp',
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

test('XXXXXXX-1: present when >= 2 candidates', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('x1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    assert.ok('candidateScoreP80Range' in explanation,
      `candidateScoreP80Range should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.candidateScoreP80Range, 'number', 'candidateScoreP80Range should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('XXXXXXX-2: always >= 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('x2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP80Range' in explanation) {
      assert.ok(
        explanation.candidateScoreP80Range >= -1e-9,
        `candidateScoreP80Range should be >= 0, got ${explanation.candidateScoreP80Range}`,
      );
      assert.ok(
        Number.isFinite(explanation.candidateScoreP80Range),
        `candidateScoreP80Range should be finite, got ${explanation.candidateScoreP80Range}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('XXXXXXX-3: identity — equals candidateScoreP90 - candidateScoreP10', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('x3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP80Range' in explanation && 'candidateScoreP90' in explanation && 'candidateScoreP10' in explanation) {
      const expected = explanation.candidateScoreP90 - explanation.candidateScoreP10;
      assert.ok(
        Math.abs(explanation.candidateScoreP80Range - expected) < 1e-9,
        `candidateScoreP80Range (${explanation.candidateScoreP80Range}) should equal P90-P10 (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('XXXXXXX-4: for n=2: equals 0.8 * winnerRunnerUpGap', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('x4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP80Range' in explanation && 'winnerRunnerUpGap' in explanation && explanation.candidateCount === 2) {
      const expected = 0.8 * explanation.winnerRunnerUpGap;
      assert.ok(
        Math.abs(explanation.candidateScoreP80Range - expected) < 1e-9,
        `candidateScoreP80Range (${explanation.candidateScoreP80Range}) should equal 0.8*winnerRunnerUpGap (${expected}) when n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('XXXXXXX-5: absent on cast:no_match', async () => {
  const path = dlqPath('x5');
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
      !('candidateScoreP80Range' in parsed.explanation),
      `candidateScoreP80Range should be absent on no_match, found: ${parsed.explanation.candidateScoreP80Range}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('XXXXXXX-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('x6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP80Range' in explanation),
      `candidateScoreP80Range should be absent with single candidate, found: ${explanation.candidateScoreP80Range}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('XXXXXXX-7: always <= candidateScoreSpread when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('x7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP80Range' in explanation && 'candidateScoreSpread' in explanation) {
      assert.ok(
        explanation.candidateScoreP80Range <= explanation.candidateScoreSpread + 1e-9,
        `candidateScoreP80Range (${explanation.candidateScoreP80Range}) should be <= candidateScoreSpread (${explanation.candidateScoreSpread})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('XXXXXXX-8: tool description documents candidateScoreP80Range', async () => {
  const path = dlqPath('x8');
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
      cast.description?.includes('candidateScoreP80Range'),
      `cast description should mention candidateScoreP80Range, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
