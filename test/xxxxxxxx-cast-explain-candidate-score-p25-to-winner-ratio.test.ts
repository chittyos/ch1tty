/**
 * XXXXXXXX: explanation.candidateScoreP25ToWinnerRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreP25ToWinnerRatio: number — ratio of P25 (Q1) to winner score:
 * candidateScoreP25 / winnerScore.
 *
 * Present when: >= 2 candidates and winnerScore > 0.
 * Absent when: no_match, single candidate, or winnerScore === 0.
 * Always <= 1 (P25 <= winnerScore by definition).
 * Always <= candidateScoreP75ToWinnerRatio when both present (P25 <= P75).
 * Inverse of winnerScoreToP25Ratio: product === 1 when both present.
 * For n=2: (0.25*w + 0.75*r) / w.
 * Identity: candidateScoreP25ToWinnerRatio * winnerScore === candidateScoreP25.
 *
 * Covered:
 *   XXXXXXXX-1: present when >= 2 candidates and winnerScore > 0
 *   XXXXXXXX-2: always <= 1 and finite when present
 *   XXXXXXXX-3: always <= candidateScoreP75ToWinnerRatio when both present (P25 <= P75)
 *   XXXXXXXX-4: for n=2 equals (0.25*w + 0.75*r) / w
 *   XXXXXXXX-5: absent on cast:no_match
 *   XXXXXXXX-6: absent when only 1 candidate
 *   XXXXXXXX-7: identity — candidateScoreP25ToWinnerRatio * winnerScore === candidateScoreP25
 *   XXXXXXXX-8: tool description documents candidateScoreP25ToWinnerRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-xxxxxxxx-${label}-${Date.now()}.jsonl`);
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

test('XXXXXXXX-1: present when >= 2 candidates and winnerScore > 0', async () => {
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
    if (explanation.winnerScore > 0 && 'candidateScoreP25' in explanation) {
      assert.ok('candidateScoreP25ToWinnerRatio' in explanation,
        `candidateScoreP25ToWinnerRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreP25ToWinnerRatio, 'number', 'candidateScoreP25ToWinnerRatio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('XXXXXXXX-2: always <= 1 and finite when present', async () => {
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
    if ('candidateScoreP25ToWinnerRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP25ToWinnerRatio),
        `candidateScoreP25ToWinnerRatio should be finite, got ${explanation.candidateScoreP25ToWinnerRatio}`,
      );
      assert.ok(
        explanation.candidateScoreP25ToWinnerRatio <= 1 + 1e-9,
        `candidateScoreP25ToWinnerRatio should be <= 1, got ${explanation.candidateScoreP25ToWinnerRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('XXXXXXXX-3: always <= candidateScoreP75ToWinnerRatio when both present (P25 <= P75)', async () => {
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
    if ('candidateScoreP25ToWinnerRatio' in explanation && 'candidateScoreP75ToWinnerRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreP25ToWinnerRatio <= explanation.candidateScoreP75ToWinnerRatio + 1e-9,
        `candidateScoreP25ToWinnerRatio (${explanation.candidateScoreP25ToWinnerRatio}) should be <= candidateScoreP75ToWinnerRatio (${explanation.candidateScoreP75ToWinnerRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('XXXXXXXX-4: for n=2 equals (0.25*w + 0.75*r) / w', async () => {
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
    if ('candidateScoreP25ToWinnerRatio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0) {
      const p25 = 0.25 * explanation.winnerScore + 0.75 * explanation.runnerUpScore;
      const expected = p25 / explanation.winnerScore;
      assert.ok(
        Math.abs(explanation.candidateScoreP25ToWinnerRatio - expected) < 1e-9,
        `candidateScoreP25ToWinnerRatio (${explanation.candidateScoreP25ToWinnerRatio}) should equal (0.25w+0.75r)/w (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('XXXXXXXX-5: absent on cast:no_match', async () => {
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
      !('candidateScoreP25ToWinnerRatio' in parsed.explanation),
      `candidateScoreP25ToWinnerRatio should be absent on no_match, found: ${parsed.explanation.candidateScoreP25ToWinnerRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('XXXXXXXX-6: absent when only 1 candidate', async () => {
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
      !('candidateScoreP25ToWinnerRatio' in explanation),
      `candidateScoreP25ToWinnerRatio should be absent with single candidate, found: ${explanation.candidateScoreP25ToWinnerRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('XXXXXXXX-7: identity — candidateScoreP25ToWinnerRatio * winnerScore === candidateScoreP25', async () => {
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
    if ('candidateScoreP25ToWinnerRatio' in explanation && 'winnerScore' in explanation && 'candidateScoreP25' in explanation) {
      const product = explanation.candidateScoreP25ToWinnerRatio * explanation.winnerScore;
      assert.ok(
        Math.abs(product - explanation.candidateScoreP25) < 1e-9,
        `candidateScoreP25ToWinnerRatio * winnerScore (${product}) should equal candidateScoreP25 (${explanation.candidateScoreP25})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('XXXXXXXX-8: tool description documents candidateScoreP25ToWinnerRatio', async () => {
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
      cast.description?.includes('candidateScoreP25ToWinnerRatio'),
      `cast description should mention candidateScoreP25ToWinnerRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
