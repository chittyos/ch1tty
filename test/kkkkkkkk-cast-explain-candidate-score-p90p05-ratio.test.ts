/**
 * KKKKKKKK: explanation.candidateScoreP90P05Ratio in ch1tty/cast when explain:true.
 *
 * candidateScoreP90P05Ratio: number — ratio of P90 to P05:
 * candidateScoreP90 / candidateScoreP05.
 *
 * Present when: >= 2 candidates and candidateScoreP05 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP05 === 0.
 * Always >= 1 (P90 >= P05 by definition).
 * Always <= candidateScoreTailAsymmetryRatio (P95/P05) when both present (P90 <= P95).
 * Always >= candidateScoreP90P10Ratio (P90/P10) when both present (P05 <= P10).
 * For n=2: (0.9*w + 0.1*r) / (0.05*w + 0.95*r).
 * Identity: candidateScoreP90P05Ratio * candidateScoreP05 === candidateScoreP90.
 *
 * Covered:
 *   KKKKKKKK-1: present when >= 2 candidates and candidateScoreP05 > 0
 *   KKKKKKKK-2: always >= 1 and finite when present
 *   KKKKKKKK-3: always <= candidateScoreTailAsymmetryRatio when both present (P90 <= P95)
 *   KKKKKKKK-4: for n=2 equals (0.9*w + 0.1*r) / (0.05*w + 0.95*r)
 *   KKKKKKKK-5: absent on cast:no_match
 *   KKKKKKKK-6: absent when only 1 candidate
 *   KKKKKKKK-7: identity — candidateScoreP90P05Ratio * candidateScoreP05 === candidateScoreP90
 *   KKKKKKKK-8: tool description documents candidateScoreP90P05Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-kkkkkkkk-${label}-${Date.now()}.jsonl`);
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

test('KKKKKKKK-1: present when >= 2 candidates and candidateScoreP05 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP05' in explanation && explanation.candidateScoreP05 > 0 && 'candidateScoreP90' in explanation) {
      assert.ok('candidateScoreP90P05Ratio' in explanation,
        `candidateScoreP90P05Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreP90P05Ratio, 'number', 'candidateScoreP90P05Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKKKK-2: always >= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP90P05Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP90P05Ratio),
        `candidateScoreP90P05Ratio should be finite, got ${explanation.candidateScoreP90P05Ratio}`,
      );
      assert.ok(
        explanation.candidateScoreP90P05Ratio >= 1 - 1e-9,
        `candidateScoreP90P05Ratio should be >= 1, got ${explanation.candidateScoreP90P05Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKKKK-3: always <= candidateScoreTailAsymmetryRatio when both present (P90 <= P95)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP90P05Ratio' in explanation && 'candidateScoreTailAsymmetryRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreP90P05Ratio <= explanation.candidateScoreTailAsymmetryRatio + 1e-9,
        `candidateScoreP90P05Ratio (${explanation.candidateScoreP90P05Ratio}) should be <= candidateScoreTailAsymmetryRatio (${explanation.candidateScoreTailAsymmetryRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKKKK-4: for n=2 equals (0.9*w + 0.1*r) / (0.05*w + 0.95*r)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP90P05Ratio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0) {
      const p90 = 0.9 * explanation.winnerScore + 0.1 * explanation.runnerUpScore;
      const p05 = 0.05 * explanation.winnerScore + 0.95 * explanation.runnerUpScore;
      if (p05 > 0) {
        const expected = p90 / p05;
        assert.ok(
          Math.abs(explanation.candidateScoreP90P05Ratio - expected) < 1e-9,
          `candidateScoreP90P05Ratio (${explanation.candidateScoreP90P05Ratio}) should equal (0.9w+0.1r)/(0.05w+0.95r) (${expected}) for n=2`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKKKK-5: absent on cast:no_match', async () => {
  const path = dlqPath('k5');
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
      !('candidateScoreP90P05Ratio' in parsed.explanation),
      `candidateScoreP90P05Ratio should be absent on no_match, found: ${parsed.explanation.candidateScoreP90P05Ratio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('KKKKKKKK-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP90P05Ratio' in explanation),
      `candidateScoreP90P05Ratio should be absent with single candidate, found: ${explanation.candidateScoreP90P05Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKKKK-7: identity — candidateScoreP90P05Ratio * candidateScoreP05 === candidateScoreP90', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP90P05Ratio' in explanation && 'candidateScoreP05' in explanation && 'candidateScoreP90' in explanation) {
      const product = explanation.candidateScoreP90P05Ratio * explanation.candidateScoreP05;
      assert.ok(
        Math.abs(product - explanation.candidateScoreP90) < 1e-9,
        `candidateScoreP90P05Ratio * candidateScoreP05 (${product}) should equal candidateScoreP90 (${explanation.candidateScoreP90})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKKKK-8: tool description documents candidateScoreP90P05Ratio', async () => {
  const path = dlqPath('k8');
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
      cast.description?.includes('candidateScoreP90P05Ratio'),
      `cast description should mention candidateScoreP90P05Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
