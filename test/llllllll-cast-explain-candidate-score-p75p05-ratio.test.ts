/**
 * LLLLLLLL: explanation.candidateScoreP75P05Ratio in ch1tty/cast when explain:true.
 *
 * candidateScoreP75P05Ratio: number — ratio of P75 (Q3) to P05:
 * candidateScoreP75 / candidateScoreP05.
 *
 * Present when: >= 2 candidates and candidateScoreP05 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP05 === 0.
 * Always >= 1 (P75 >= P05 by definition).
 * Always <= candidateScoreTailAsymmetryRatio (P95/P05) when both present (P75 <= P95).
 * Always >= candidateScoreP75P25Ratio (P75/P25) when both present (P05 <= P25).
 * For n=2: (0.75*w + 0.25*r) / (0.05*w + 0.95*r).
 * Identity: candidateScoreP75P05Ratio * candidateScoreP05 === candidateScoreP75.
 *
 * Covered:
 *   LLLLLLLL-1: present when >= 2 candidates and candidateScoreP05 > 0
 *   LLLLLLLL-2: always >= 1 and finite when present
 *   LLLLLLLL-3: always <= candidateScoreTailAsymmetryRatio when both present (P75 <= P95)
 *   LLLLLLLL-4: for n=2 equals (0.75*w + 0.25*r) / (0.05*w + 0.95*r)
 *   LLLLLLLL-5: absent on cast:no_match
 *   LLLLLLLL-6: absent when only 1 candidate
 *   LLLLLLLL-7: identity — candidateScoreP75P05Ratio * candidateScoreP05 === candidateScoreP75
 *   LLLLLLLL-8: tool description documents candidateScoreP75P05Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-llllllll-${label}-${Date.now()}.jsonl`);
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

test('LLLLLLLL-1: present when >= 2 candidates and candidateScoreP05 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('l1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP05' in explanation && explanation.candidateScoreP05 > 0 && 'candidateScoreP75' in explanation) {
      assert.ok('candidateScoreP75P05Ratio' in explanation,
        `candidateScoreP75P05Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreP75P05Ratio, 'number', 'candidateScoreP75P05Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('LLLLLLLL-2: always >= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('l2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP75P05Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP75P05Ratio),
        `candidateScoreP75P05Ratio should be finite, got ${explanation.candidateScoreP75P05Ratio}`,
      );
      assert.ok(
        explanation.candidateScoreP75P05Ratio >= 1 - 1e-9,
        `candidateScoreP75P05Ratio should be >= 1, got ${explanation.candidateScoreP75P05Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('LLLLLLLL-3: always <= candidateScoreTailAsymmetryRatio when both present (P75 <= P95)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('l3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP75P05Ratio' in explanation && 'candidateScoreTailAsymmetryRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreP75P05Ratio <= explanation.candidateScoreTailAsymmetryRatio + 1e-9,
        `candidateScoreP75P05Ratio (${explanation.candidateScoreP75P05Ratio}) should be <= candidateScoreTailAsymmetryRatio (${explanation.candidateScoreTailAsymmetryRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('LLLLLLLL-4: for n=2 equals (0.75*w + 0.25*r) / (0.05*w + 0.95*r)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('l4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP75P05Ratio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0) {
      const p75 = 0.75 * explanation.winnerScore + 0.25 * explanation.runnerUpScore;
      const p05 = 0.05 * explanation.winnerScore + 0.95 * explanation.runnerUpScore;
      if (p05 > 0) {
        const expected = p75 / p05;
        assert.ok(
          Math.abs(explanation.candidateScoreP75P05Ratio - expected) < 1e-9,
          `candidateScoreP75P05Ratio (${explanation.candidateScoreP75P05Ratio}) should equal (0.75w+0.25r)/(0.05w+0.95r) (${expected}) for n=2`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('LLLLLLLL-5: absent on cast:no_match', async () => {
  const path = dlqPath('l5');
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
      !('candidateScoreP75P05Ratio' in parsed.explanation),
      `candidateScoreP75P05Ratio should be absent on no_match, found: ${parsed.explanation.candidateScoreP75P05Ratio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('LLLLLLLL-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('l6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP75P05Ratio' in explanation),
      `candidateScoreP75P05Ratio should be absent with single candidate, found: ${explanation.candidateScoreP75P05Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('LLLLLLLL-7: identity — candidateScoreP75P05Ratio * candidateScoreP05 === candidateScoreP75', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('l7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP75P05Ratio' in explanation && 'candidateScoreP05' in explanation && 'candidateScoreP75' in explanation) {
      const product = explanation.candidateScoreP75P05Ratio * explanation.candidateScoreP05;
      assert.ok(
        Math.abs(product - explanation.candidateScoreP75) < 1e-9,
        `candidateScoreP75P05Ratio * candidateScoreP05 (${product}) should equal candidateScoreP75 (${explanation.candidateScoreP75})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('LLLLLLLL-8: tool description documents candidateScoreP75P05Ratio', async () => {
  const path = dlqPath('l8');
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
      cast.description?.includes('candidateScoreP75P05Ratio'),
      `cast description should mention candidateScoreP75P05Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
