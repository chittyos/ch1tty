/**
 * MMMMMMMM: explanation.candidateScoreP10P05Ratio in ch1tty/cast when explain:true.
 *
 * candidateScoreP10P05Ratio: number — ratio of P10 to P05:
 * candidateScoreP10 / candidateScoreP05.
 *
 * Present when: >= 2 candidates and candidateScoreP05 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP05 === 0.
 * Always >= 1 (P10 >= P05 by definition).
 * Always <= candidateScoreTailAsymmetryRatio (P95/P05) when both present (P10 <= P95).
 * Always <= candidateScoreP75P05Ratio (P75/P05) when both present (P10 <= P75).
 * For n=2: (0.1*w + 0.9*r) / (0.05*w + 0.95*r).
 * Identity: candidateScoreP10P05Ratio * candidateScoreP05 === candidateScoreP10.
 *
 * Covered:
 *   MMMMMMMM-1: present when >= 2 candidates and candidateScoreP05 > 0
 *   MMMMMMMM-2: always >= 1 and finite when present
 *   MMMMMMMM-3: always <= candidateScoreTailAsymmetryRatio when both present (P10 <= P95)
 *   MMMMMMMM-4: for n=2 equals (0.1*w + 0.9*r) / (0.05*w + 0.95*r)
 *   MMMMMMMM-5: absent on cast:no_match
 *   MMMMMMMM-6: absent when only 1 candidate
 *   MMMMMMMM-7: identity — candidateScoreP10P05Ratio * candidateScoreP05 === candidateScoreP10
 *   MMMMMMMM-8: tool description documents candidateScoreP10P05Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-mmmmmmmm-${label}-${Date.now()}.jsonl`);
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

test('MMMMMMMM-1: present when >= 2 candidates and candidateScoreP05 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('m1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP05' in explanation && explanation.candidateScoreP05 > 0 && 'candidateScoreP10' in explanation) {
      assert.ok('candidateScoreP10P05Ratio' in explanation,
        `candidateScoreP10P05Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreP10P05Ratio, 'number', 'candidateScoreP10P05Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('MMMMMMMM-2: always >= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('m2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP10P05Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP10P05Ratio),
        `candidateScoreP10P05Ratio should be finite, got ${explanation.candidateScoreP10P05Ratio}`,
      );
      assert.ok(
        explanation.candidateScoreP10P05Ratio >= 1 - 1e-9,
        `candidateScoreP10P05Ratio should be >= 1, got ${explanation.candidateScoreP10P05Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('MMMMMMMM-3: always <= candidateScoreTailAsymmetryRatio when both present (P10 <= P95)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('m3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP10P05Ratio' in explanation && 'candidateScoreTailAsymmetryRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreP10P05Ratio <= explanation.candidateScoreTailAsymmetryRatio + 1e-9,
        `candidateScoreP10P05Ratio (${explanation.candidateScoreP10P05Ratio}) should be <= candidateScoreTailAsymmetryRatio (${explanation.candidateScoreTailAsymmetryRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('MMMMMMMM-4: for n=2 equals (0.1*w + 0.9*r) / (0.05*w + 0.95*r)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('m4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP10P05Ratio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0) {
      const p10 = 0.1 * explanation.winnerScore + 0.9 * explanation.runnerUpScore;
      const p05 = 0.05 * explanation.winnerScore + 0.95 * explanation.runnerUpScore;
      if (p05 > 0) {
        const expected = p10 / p05;
        assert.ok(
          Math.abs(explanation.candidateScoreP10P05Ratio - expected) < 1e-9,
          `candidateScoreP10P05Ratio (${explanation.candidateScoreP10P05Ratio}) should equal (0.1w+0.9r)/(0.05w+0.95r) (${expected}) for n=2`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('MMMMMMMM-5: absent on cast:no_match', async () => {
  const path = dlqPath('m5');
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
      !('candidateScoreP10P05Ratio' in parsed.explanation),
      `candidateScoreP10P05Ratio should be absent on no_match, found: ${parsed.explanation.candidateScoreP10P05Ratio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('MMMMMMMM-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('m6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP10P05Ratio' in explanation),
      `candidateScoreP10P05Ratio should be absent with single candidate, found: ${explanation.candidateScoreP10P05Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('MMMMMMMM-7: identity — candidateScoreP10P05Ratio * candidateScoreP05 === candidateScoreP10', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('m7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP10P05Ratio' in explanation && 'candidateScoreP05' in explanation && 'candidateScoreP10' in explanation) {
      const product = explanation.candidateScoreP10P05Ratio * explanation.candidateScoreP05;
      assert.ok(
        Math.abs(product - explanation.candidateScoreP10) < 1e-9,
        `candidateScoreP10P05Ratio * candidateScoreP05 (${product}) should equal candidateScoreP10 (${explanation.candidateScoreP10})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('MMMMMMMM-8: tool description documents candidateScoreP10P05Ratio', async () => {
  const path = dlqPath('m8');
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
      cast.description?.includes('candidateScoreP10P05Ratio'),
      `cast description should mention candidateScoreP10P05Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
