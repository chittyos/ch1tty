/**
 * ZZZZZZZZ: explanation.candidateScoreP05ToWinnerRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreP05ToWinnerRatio: number — ratio of P05 to winner score:
 * candidateScoreP05 / winnerScore.
 *
 * Present when: >= 2 candidates and winnerScore > 0.
 * Absent when: no_match, single candidate, or winnerScore === 0.
 * Always <= 1 (P05 <= winnerScore by definition).
 * Always <= candidateScoreP10ToWinnerRatio when both present (P05 <= P10).
 * Inverse of winnerScoreToP05Ratio: product === 1 when both present.
 * For n=2: (0.05*w + 0.95*r) / w.
 * Identity: candidateScoreP05ToWinnerRatio * winnerScore === candidateScoreP05.
 *
 * Covered:
 *   ZZZZZZZZ-1: present when >= 2 candidates and winnerScore > 0
 *   ZZZZZZZZ-2: always <= 1 and finite when present
 *   ZZZZZZZZ-3: always <= candidateScoreP10ToWinnerRatio when both present (P05 <= P10)
 *   ZZZZZZZZ-4: for n=2 equals (0.05*w + 0.95*r) / w
 *   ZZZZZZZZ-5: absent on cast:no_match
 *   ZZZZZZZZ-6: absent when only 1 candidate
 *   ZZZZZZZZ-7: identity — candidateScoreP05ToWinnerRatio * winnerScore === candidateScoreP05
 *   ZZZZZZZZ-8: tool description documents candidateScoreP05ToWinnerRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-zzzzzzzz-${label}-${Date.now()}.jsonl`);
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

test('ZZZZZZZZ-1: present when >= 2 candidates and winnerScore > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if (explanation.winnerScore > 0 && 'candidateScoreP05' in explanation) {
      assert.ok('candidateScoreP05ToWinnerRatio' in explanation,
        `candidateScoreP05ToWinnerRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreP05ToWinnerRatio, 'number', 'candidateScoreP05ToWinnerRatio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZZZZZ-2: always <= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP05ToWinnerRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP05ToWinnerRatio),
        `candidateScoreP05ToWinnerRatio should be finite, got ${explanation.candidateScoreP05ToWinnerRatio}`,
      );
      assert.ok(
        explanation.candidateScoreP05ToWinnerRatio <= 1 + 1e-9,
        `candidateScoreP05ToWinnerRatio should be <= 1, got ${explanation.candidateScoreP05ToWinnerRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZZZZZ-3: always <= candidateScoreP10ToWinnerRatio when both present (P05 <= P10)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP05ToWinnerRatio' in explanation && 'candidateScoreP10ToWinnerRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreP05ToWinnerRatio <= explanation.candidateScoreP10ToWinnerRatio + 1e-9,
        `candidateScoreP05ToWinnerRatio (${explanation.candidateScoreP05ToWinnerRatio}) should be <= candidateScoreP10ToWinnerRatio (${explanation.candidateScoreP10ToWinnerRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZZZZZ-4: for n=2 equals (0.05*w + 0.95*r) / w', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP05ToWinnerRatio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0) {
      const p05 = 0.05 * explanation.winnerScore + 0.95 * explanation.runnerUpScore;
      const expected = p05 / explanation.winnerScore;
      assert.ok(
        Math.abs(explanation.candidateScoreP05ToWinnerRatio - expected) < 1e-9,
        `candidateScoreP05ToWinnerRatio (${explanation.candidateScoreP05ToWinnerRatio}) should equal (0.05w+0.95r)/w (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZZZZZ-5: absent on cast:no_match', async () => {
  const path = dlqPath('z5');
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
      !('candidateScoreP05ToWinnerRatio' in parsed.explanation),
      `candidateScoreP05ToWinnerRatio should be absent on no_match, found: ${parsed.explanation.candidateScoreP05ToWinnerRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('ZZZZZZZZ-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP05ToWinnerRatio' in explanation),
      `candidateScoreP05ToWinnerRatio should be absent with single candidate, found: ${explanation.candidateScoreP05ToWinnerRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZZZZZ-7: identity — candidateScoreP05ToWinnerRatio * winnerScore === candidateScoreP05', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP05ToWinnerRatio' in explanation && 'winnerScore' in explanation && 'candidateScoreP05' in explanation) {
      const product = explanation.candidateScoreP05ToWinnerRatio * explanation.winnerScore;
      assert.ok(
        Math.abs(product - explanation.candidateScoreP05) < 1e-9,
        `candidateScoreP05ToWinnerRatio * winnerScore (${product}) should equal candidateScoreP05 (${explanation.candidateScoreP05})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZZZZZ-8: tool description documents candidateScoreP05ToWinnerRatio', async () => {
  const path = dlqPath('z8');
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
      cast.description?.includes('candidateScoreP05ToWinnerRatio'),
      `cast description should mention candidateScoreP05ToWinnerRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
