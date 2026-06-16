/**
 * WWWWWWWW: explanation.candidateScoreP95ToWinnerRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreP95ToWinnerRatio: number — ratio of P95 to winner score:
 * candidateScoreP95 / winnerScore.
 *
 * Present when: >= 2 candidates and winnerScore > 0.
 * Absent when: no_match, single candidate, or winnerScore === 0.
 * Always <= 1 (P95 <= winnerScore by definition).
 * Always >= candidateScoreP90ToWinnerRatio when both present (P95 >= P90).
 * Inverse of winnerScoreToP95Ratio: product === 1 when both present.
 * For n=2: (0.95*w + 0.05*r) / w.
 * Identity: candidateScoreP95ToWinnerRatio * winnerScore === candidateScoreP95.
 *
 * Covered:
 *   WWWWWWWW-1: present when >= 2 candidates and winnerScore > 0
 *   WWWWWWWW-2: always <= 1 and finite when present
 *   WWWWWWWW-3: always >= candidateScoreP90ToWinnerRatio when both present (P95 >= P90)
 *   WWWWWWWW-4: for n=2 equals (0.95*w + 0.05*r) / w
 *   WWWWWWWW-5: absent on cast:no_match
 *   WWWWWWWW-6: absent when only 1 candidate
 *   WWWWWWWW-7: identity — candidateScoreP95ToWinnerRatio * winnerScore === candidateScoreP95
 *   WWWWWWWW-8: tool description documents candidateScoreP95ToWinnerRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-wwwwwwww-${label}-${Date.now()}.jsonl`);
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

test('WWWWWWWW-1: present when >= 2 candidates and winnerScore > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if (explanation.winnerScore > 0 && 'candidateScoreP95' in explanation) {
      assert.ok('candidateScoreP95ToWinnerRatio' in explanation,
        `candidateScoreP95ToWinnerRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreP95ToWinnerRatio, 'number', 'candidateScoreP95ToWinnerRatio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('WWWWWWWW-2: always <= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP95ToWinnerRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP95ToWinnerRatio),
        `candidateScoreP95ToWinnerRatio should be finite, got ${explanation.candidateScoreP95ToWinnerRatio}`,
      );
      assert.ok(
        explanation.candidateScoreP95ToWinnerRatio <= 1 + 1e-9,
        `candidateScoreP95ToWinnerRatio should be <= 1, got ${explanation.candidateScoreP95ToWinnerRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('WWWWWWWW-3: always >= candidateScoreP90ToWinnerRatio when both present (P95 >= P90)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP95ToWinnerRatio' in explanation && 'candidateScoreP90ToWinnerRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreP95ToWinnerRatio >= explanation.candidateScoreP90ToWinnerRatio - 1e-9,
        `candidateScoreP95ToWinnerRatio (${explanation.candidateScoreP95ToWinnerRatio}) should be >= candidateScoreP90ToWinnerRatio (${explanation.candidateScoreP90ToWinnerRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('WWWWWWWW-4: for n=2 equals (0.95*w + 0.05*r) / w', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP95ToWinnerRatio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0) {
      const p95 = 0.95 * explanation.winnerScore + 0.05 * explanation.runnerUpScore;
      const expected = p95 / explanation.winnerScore;
      assert.ok(
        Math.abs(explanation.candidateScoreP95ToWinnerRatio - expected) < 1e-9,
        `candidateScoreP95ToWinnerRatio (${explanation.candidateScoreP95ToWinnerRatio}) should equal (0.95w+0.05r)/w (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('WWWWWWWW-5: absent on cast:no_match', async () => {
  const path = dlqPath('w5');
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
      !('candidateScoreP95ToWinnerRatio' in parsed.explanation),
      `candidateScoreP95ToWinnerRatio should be absent on no_match, found: ${parsed.explanation.candidateScoreP95ToWinnerRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('WWWWWWWW-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP95ToWinnerRatio' in explanation),
      `candidateScoreP95ToWinnerRatio should be absent with single candidate, found: ${explanation.candidateScoreP95ToWinnerRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('WWWWWWWW-7: identity — candidateScoreP95ToWinnerRatio * winnerScore === candidateScoreP95', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP95ToWinnerRatio' in explanation && 'winnerScore' in explanation && 'candidateScoreP95' in explanation) {
      const product = explanation.candidateScoreP95ToWinnerRatio * explanation.winnerScore;
      assert.ok(
        Math.abs(product - explanation.candidateScoreP95) < 1e-9,
        `candidateScoreP95ToWinnerRatio * winnerScore (${product}) should equal candidateScoreP95 (${explanation.candidateScoreP95})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('WWWWWWWW-8: tool description documents candidateScoreP95ToWinnerRatio', async () => {
  const path = dlqPath('w8');
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
      cast.description?.includes('candidateScoreP95ToWinnerRatio'),
      `cast description should mention candidateScoreP95ToWinnerRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
