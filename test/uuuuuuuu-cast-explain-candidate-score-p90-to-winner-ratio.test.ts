/**
 * UUUUUUUU: explanation.candidateScoreP90ToWinnerRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreP90ToWinnerRatio: number — ratio of P90 to winner score:
 * candidateScoreP90 / winnerScore.
 *
 * Present when: >= 2 candidates and winnerScore > 0.
 * Absent when: no_match, single candidate, or winnerScore === 0.
 * Always <= 1 (P90 <= winnerScore by definition).
 * Always >= candidateScoreP75ToWinnerRatio when both present (P90 >= P75).
 * Inverse of winnerScoreToP90Ratio: product === 1 when both present.
 * For n=2: (0.9*w + 0.1*r) / w.
 * Identity: candidateScoreP90ToWinnerRatio * winnerScore === candidateScoreP90.
 *
 * Covered:
 *   UUUUUUUU-1: present when >= 2 candidates and winnerScore > 0
 *   UUUUUUUU-2: always <= 1 and finite when present
 *   UUUUUUUU-3: always >= candidateScoreP75ToWinnerRatio when both present (P90 >= P75)
 *   UUUUUUUU-4: for n=2 equals (0.9*w + 0.1*r) / w
 *   UUUUUUUU-5: absent on cast:no_match
 *   UUUUUUUU-6: absent when only 1 candidate
 *   UUUUUUUU-7: identity — candidateScoreP90ToWinnerRatio * winnerScore === candidateScoreP90
 *   UUUUUUUU-8: tool description documents candidateScoreP90ToWinnerRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-uuuuuuuu-${label}-${Date.now()}.jsonl`);
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

test('UUUUUUUU-1: present when >= 2 candidates and winnerScore > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('u1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if (explanation.winnerScore > 0 && 'candidateScoreP90' in explanation) {
      assert.ok('candidateScoreP90ToWinnerRatio' in explanation,
        `candidateScoreP90ToWinnerRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreP90ToWinnerRatio, 'number', 'candidateScoreP90ToWinnerRatio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('UUUUUUUU-2: always <= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('u2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP90ToWinnerRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP90ToWinnerRatio),
        `candidateScoreP90ToWinnerRatio should be finite, got ${explanation.candidateScoreP90ToWinnerRatio}`,
      );
      assert.ok(
        explanation.candidateScoreP90ToWinnerRatio <= 1 + 1e-9,
        `candidateScoreP90ToWinnerRatio should be <= 1, got ${explanation.candidateScoreP90ToWinnerRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('UUUUUUUU-3: always >= candidateScoreP75ToWinnerRatio when both present (P90 >= P75)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('u3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP90ToWinnerRatio' in explanation && 'candidateScoreP75ToWinnerRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreP90ToWinnerRatio >= explanation.candidateScoreP75ToWinnerRatio - 1e-9,
        `candidateScoreP90ToWinnerRatio (${explanation.candidateScoreP90ToWinnerRatio}) should be >= candidateScoreP75ToWinnerRatio (${explanation.candidateScoreP75ToWinnerRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('UUUUUUUU-4: for n=2 equals (0.9*w + 0.1*r) / w', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('u4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP90ToWinnerRatio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0) {
      const p90 = 0.9 * explanation.winnerScore + 0.1 * explanation.runnerUpScore;
      const expected = p90 / explanation.winnerScore;
      assert.ok(
        Math.abs(explanation.candidateScoreP90ToWinnerRatio - expected) < 1e-9,
        `candidateScoreP90ToWinnerRatio (${explanation.candidateScoreP90ToWinnerRatio}) should equal (0.9w+0.1r)/w (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('UUUUUUUU-5: absent on cast:no_match', async () => {
  const path = dlqPath('u5');
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
      !('candidateScoreP90ToWinnerRatio' in parsed.explanation),
      `candidateScoreP90ToWinnerRatio should be absent on no_match, found: ${parsed.explanation.candidateScoreP90ToWinnerRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('UUUUUUUU-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('u6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP90ToWinnerRatio' in explanation),
      `candidateScoreP90ToWinnerRatio should be absent with single candidate, found: ${explanation.candidateScoreP90ToWinnerRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('UUUUUUUU-7: identity — candidateScoreP90ToWinnerRatio * winnerScore === candidateScoreP90', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('u7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP90ToWinnerRatio' in explanation && 'winnerScore' in explanation && 'candidateScoreP90' in explanation) {
      const product = explanation.candidateScoreP90ToWinnerRatio * explanation.winnerScore;
      assert.ok(
        Math.abs(product - explanation.candidateScoreP90) < 1e-9,
        `candidateScoreP90ToWinnerRatio * winnerScore (${product}) should equal candidateScoreP90 (${explanation.candidateScoreP90})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('UUUUUUUU-8: tool description documents candidateScoreP90ToWinnerRatio', async () => {
  const path = dlqPath('u8');
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
      cast.description?.includes('candidateScoreP90ToWinnerRatio'),
      `cast description should mention candidateScoreP90ToWinnerRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
