/**
 * YYYYYYYY: explanation.candidateScoreP10ToWinnerRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreP10ToWinnerRatio: number — ratio of P10 to winner score:
 * candidateScoreP10 / winnerScore.
 *
 * Present when: >= 2 candidates and winnerScore > 0.
 * Absent when: no_match, single candidate, or winnerScore === 0.
 * Always <= 1 (P10 <= winnerScore by definition).
 * Always <= candidateScoreP25ToWinnerRatio when both present (P10 <= P25).
 * Inverse of winnerScoreToP10Ratio: product === 1 when both present.
 * For n=2: (0.1*w + 0.9*r) / w.
 * Identity: candidateScoreP10ToWinnerRatio * winnerScore === candidateScoreP10.
 *
 * Covered:
 *   YYYYYYYY-1: present when >= 2 candidates and winnerScore > 0
 *   YYYYYYYY-2: always <= 1 and finite when present
 *   YYYYYYYY-3: always <= candidateScoreP25ToWinnerRatio when both present (P10 <= P25)
 *   YYYYYYYY-4: for n=2 equals (0.1*w + 0.9*r) / w
 *   YYYYYYYY-5: absent on cast:no_match
 *   YYYYYYYY-6: absent when only 1 candidate
 *   YYYYYYYY-7: identity — candidateScoreP10ToWinnerRatio * winnerScore === candidateScoreP10
 *   YYYYYYYY-8: tool description documents candidateScoreP10ToWinnerRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-yyyyyyyy-${label}-${Date.now()}.jsonl`);
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

test('YYYYYYYY-1: present when >= 2 candidates and winnerScore > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('y1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if (explanation.winnerScore > 0 && 'candidateScoreP10' in explanation) {
      assert.ok('candidateScoreP10ToWinnerRatio' in explanation,
        `candidateScoreP10ToWinnerRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreP10ToWinnerRatio, 'number', 'candidateScoreP10ToWinnerRatio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('YYYYYYYY-2: always <= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('y2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP10ToWinnerRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP10ToWinnerRatio),
        `candidateScoreP10ToWinnerRatio should be finite, got ${explanation.candidateScoreP10ToWinnerRatio}`,
      );
      assert.ok(
        explanation.candidateScoreP10ToWinnerRatio <= 1 + 1e-9,
        `candidateScoreP10ToWinnerRatio should be <= 1, got ${explanation.candidateScoreP10ToWinnerRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('YYYYYYYY-3: always <= candidateScoreP25ToWinnerRatio when both present (P10 <= P25)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('y3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP10ToWinnerRatio' in explanation && 'candidateScoreP25ToWinnerRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreP10ToWinnerRatio <= explanation.candidateScoreP25ToWinnerRatio + 1e-9,
        `candidateScoreP10ToWinnerRatio (${explanation.candidateScoreP10ToWinnerRatio}) should be <= candidateScoreP25ToWinnerRatio (${explanation.candidateScoreP25ToWinnerRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('YYYYYYYY-4: for n=2 equals (0.1*w + 0.9*r) / w', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('y4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP10ToWinnerRatio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0) {
      const p10 = 0.1 * explanation.winnerScore + 0.9 * explanation.runnerUpScore;
      const expected = p10 / explanation.winnerScore;
      assert.ok(
        Math.abs(explanation.candidateScoreP10ToWinnerRatio - expected) < 1e-9,
        `candidateScoreP10ToWinnerRatio (${explanation.candidateScoreP10ToWinnerRatio}) should equal (0.1w+0.9r)/w (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('YYYYYYYY-5: absent on cast:no_match', async () => {
  const path = dlqPath('y5');
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
      !('candidateScoreP10ToWinnerRatio' in parsed.explanation),
      `candidateScoreP10ToWinnerRatio should be absent on no_match, found: ${parsed.explanation.candidateScoreP10ToWinnerRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('YYYYYYYY-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('y6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP10ToWinnerRatio' in explanation),
      `candidateScoreP10ToWinnerRatio should be absent with single candidate, found: ${explanation.candidateScoreP10ToWinnerRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('YYYYYYYY-7: identity — candidateScoreP10ToWinnerRatio * winnerScore === candidateScoreP10', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('y7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP10ToWinnerRatio' in explanation && 'winnerScore' in explanation && 'candidateScoreP10' in explanation) {
      const product = explanation.candidateScoreP10ToWinnerRatio * explanation.winnerScore;
      assert.ok(
        Math.abs(product - explanation.candidateScoreP10) < 1e-9,
        `candidateScoreP10ToWinnerRatio * winnerScore (${product}) should equal candidateScoreP10 (${explanation.candidateScoreP10})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('YYYYYYYY-8: tool description documents candidateScoreP10ToWinnerRatio', async () => {
  const path = dlqPath('y8');
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
      cast.description?.includes('candidateScoreP10ToWinnerRatio'),
      `cast description should mention candidateScoreP10ToWinnerRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
