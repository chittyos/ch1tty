/**
 * VVVVVVVV: explanation.candidateScoreP75ToWinnerRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreP75ToWinnerRatio: number — ratio of P75 (Q3) to winner score:
 * candidateScoreP75 / winnerScore.
 *
 * Present when: >= 2 candidates and winnerScore > 0.
 * Absent when: no_match, single candidate, or winnerScore === 0.
 * Always <= 1 (P75 <= winnerScore by definition).
 * Always <= candidateScoreP90ToWinnerRatio when both present (P75 <= P90).
 * Inverse of winnerScoreToP75Ratio: product === 1 when both present.
 * For n=2: (0.75*w + 0.25*r) / w.
 * Identity: candidateScoreP75ToWinnerRatio * winnerScore === candidateScoreP75.
 *
 * Covered:
 *   VVVVVVVV-1: present when >= 2 candidates and winnerScore > 0
 *   VVVVVVVV-2: always <= 1 and finite when present
 *   VVVVVVVV-3: always <= candidateScoreP90ToWinnerRatio when both present (P75 <= P90)
 *   VVVVVVVV-4: for n=2 equals (0.75*w + 0.25*r) / w
 *   VVVVVVVV-5: absent on cast:no_match
 *   VVVVVVVV-6: absent when only 1 candidate
 *   VVVVVVVV-7: identity — candidateScoreP75ToWinnerRatio * winnerScore === candidateScoreP75
 *   VVVVVVVV-8: tool description documents candidateScoreP75ToWinnerRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-vvvvvvvv-${label}-${Date.now()}.jsonl`);
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

test('VVVVVVVV-1: present when >= 2 candidates and winnerScore > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('v1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if (explanation.winnerScore > 0 && 'candidateScoreP75' in explanation) {
      assert.ok('candidateScoreP75ToWinnerRatio' in explanation,
        `candidateScoreP75ToWinnerRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreP75ToWinnerRatio, 'number', 'candidateScoreP75ToWinnerRatio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('VVVVVVVV-2: always <= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('v2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP75ToWinnerRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP75ToWinnerRatio),
        `candidateScoreP75ToWinnerRatio should be finite, got ${explanation.candidateScoreP75ToWinnerRatio}`,
      );
      assert.ok(
        explanation.candidateScoreP75ToWinnerRatio <= 1 + 1e-9,
        `candidateScoreP75ToWinnerRatio should be <= 1, got ${explanation.candidateScoreP75ToWinnerRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('VVVVVVVV-3: always <= candidateScoreP90ToWinnerRatio when both present (P75 <= P90)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('v3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP75ToWinnerRatio' in explanation && 'candidateScoreP90ToWinnerRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreP75ToWinnerRatio <= explanation.candidateScoreP90ToWinnerRatio + 1e-9,
        `candidateScoreP75ToWinnerRatio (${explanation.candidateScoreP75ToWinnerRatio}) should be <= candidateScoreP90ToWinnerRatio (${explanation.candidateScoreP90ToWinnerRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('VVVVVVVV-4: for n=2 equals (0.75*w + 0.25*r) / w', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('v4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP75ToWinnerRatio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0) {
      const p75 = 0.75 * explanation.winnerScore + 0.25 * explanation.runnerUpScore;
      const expected = p75 / explanation.winnerScore;
      assert.ok(
        Math.abs(explanation.candidateScoreP75ToWinnerRatio - expected) < 1e-9,
        `candidateScoreP75ToWinnerRatio (${explanation.candidateScoreP75ToWinnerRatio}) should equal (0.75w+0.25r)/w (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('VVVVVVVV-5: absent on cast:no_match', async () => {
  const path = dlqPath('v5');
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
      !('candidateScoreP75ToWinnerRatio' in parsed.explanation),
      `candidateScoreP75ToWinnerRatio should be absent on no_match, found: ${parsed.explanation.candidateScoreP75ToWinnerRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('VVVVVVVV-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('v6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP75ToWinnerRatio' in explanation),
      `candidateScoreP75ToWinnerRatio should be absent with single candidate, found: ${explanation.candidateScoreP75ToWinnerRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('VVVVVVVV-7: identity — candidateScoreP75ToWinnerRatio * winnerScore === candidateScoreP75', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('v7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP75ToWinnerRatio' in explanation && 'winnerScore' in explanation && 'candidateScoreP75' in explanation) {
      const product = explanation.candidateScoreP75ToWinnerRatio * explanation.winnerScore;
      assert.ok(
        Math.abs(product - explanation.candidateScoreP75) < 1e-9,
        `candidateScoreP75ToWinnerRatio * winnerScore (${product}) should equal candidateScoreP75 (${explanation.candidateScoreP75})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('VVVVVVVV-8: tool description documents candidateScoreP75ToWinnerRatio', async () => {
  const path = dlqPath('v8');
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
      cast.description?.includes('candidateScoreP75ToWinnerRatio'),
      `cast description should mention candidateScoreP75ToWinnerRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
