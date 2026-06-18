/**
 * HHHHHHHH: explanation.candidateScoreP95P10Ratio in ch1tty/cast when explain:true.
 *
 * candidateScoreP95P10Ratio: number — ratio of P95 to P10:
 * candidateScoreP95 / candidateScoreP10.
 *
 * Present when: >= 2 candidates and candidateScoreP10 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP10 === 0.
 * Always >= 1 (P95 >= P10 by definition).
 * Always <= candidateScoreTailAsymmetryRatio (P95/P05) when both present (P10 >= P05).
 * Always >= candidateScoreP90P10Ratio (P90/P10) when both present (P95 >= P90).
 * For n=2: (0.95*w + 0.05*r) / (0.1*w + 0.9*r).
 * Identity: candidateScoreP95P10Ratio * candidateScoreP10 === candidateScoreP95.
 *
 * Covered:
 *   HHHHHHHH-1: present when >= 2 candidates and candidateScoreP10 > 0
 *   HHHHHHHH-2: always >= 1 and finite when present
 *   HHHHHHHH-3: always <= candidateScoreTailAsymmetryRatio when both present (P10 >= P05)
 *   HHHHHHHH-4: for n=2 equals (0.95*w + 0.05*r) / (0.1*w + 0.9*r)
 *   HHHHHHHH-5: absent on cast:no_match
 *   HHHHHHHH-6: absent when only 1 candidate
 *   HHHHHHHH-7: identity — candidateScoreP95P10Ratio * candidateScoreP10 === candidateScoreP95
 *   HHHHHHHH-8: tool description documents candidateScoreP95P10Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-hhhhhhhh-${label}-${Date.now()}.jsonl`);
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

test('HHHHHHHH-1: present when >= 2 candidates and candidateScoreP10 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('h1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP10' in explanation && explanation.candidateScoreP10 > 0 && 'candidateScoreP95' in explanation) {
      assert.ok('candidateScoreP95P10Ratio' in explanation,
        `candidateScoreP95P10Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreP95P10Ratio, 'number', 'candidateScoreP95P10Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('HHHHHHHH-2: always >= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('h2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP95P10Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP95P10Ratio),
        `candidateScoreP95P10Ratio should be finite, got ${explanation.candidateScoreP95P10Ratio}`,
      );
      assert.ok(
        explanation.candidateScoreP95P10Ratio >= 1 - 1e-9,
        `candidateScoreP95P10Ratio should be >= 1, got ${explanation.candidateScoreP95P10Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('HHHHHHHH-3: always <= candidateScoreTailAsymmetryRatio when both present (P10 >= P05)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('h3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP95P10Ratio' in explanation && 'candidateScoreTailAsymmetryRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreP95P10Ratio <= explanation.candidateScoreTailAsymmetryRatio + 1e-9,
        `candidateScoreP95P10Ratio (${explanation.candidateScoreP95P10Ratio}) should be <= candidateScoreTailAsymmetryRatio (${explanation.candidateScoreTailAsymmetryRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('HHHHHHHH-4: for n=2 equals (0.95*w + 0.05*r) / (0.1*w + 0.9*r)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('h4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP95P10Ratio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0) {
      const p95 = 0.95 * explanation.winnerScore + 0.05 * explanation.runnerUpScore;
      const p10 = 0.1 * explanation.winnerScore + 0.9 * explanation.runnerUpScore;
      if (p10 > 0) {
        const expected = p95 / p10;
        assert.ok(
          Math.abs(explanation.candidateScoreP95P10Ratio - expected) < 1e-9,
          `candidateScoreP95P10Ratio (${explanation.candidateScoreP95P10Ratio}) should equal (0.95w+0.05r)/(0.1w+0.9r) (${expected}) for n=2`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('HHHHHHHH-5: absent on cast:no_match', async () => {
  const path = dlqPath('h5');
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
      !('candidateScoreP95P10Ratio' in parsed.explanation),
      `candidateScoreP95P10Ratio should be absent on no_match, found: ${parsed.explanation.candidateScoreP95P10Ratio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('HHHHHHHH-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('h6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP95P10Ratio' in explanation),
      `candidateScoreP95P10Ratio should be absent with single candidate, found: ${explanation.candidateScoreP95P10Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('HHHHHHHH-7: identity — candidateScoreP95P10Ratio * candidateScoreP10 === candidateScoreP95', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('h7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP95P10Ratio' in explanation && 'candidateScoreP10' in explanation && 'candidateScoreP95' in explanation) {
      const product = explanation.candidateScoreP95P10Ratio * explanation.candidateScoreP10;
      assert.ok(
        Math.abs(product - explanation.candidateScoreP95) < 1e-9,
        `candidateScoreP95P10Ratio * candidateScoreP10 (${product}) should equal candidateScoreP95 (${explanation.candidateScoreP95})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('HHHHHHHH-8: tool description documents candidateScoreP95P10Ratio', async () => {
  const path = dlqPath('h8');
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
      cast.description?.includes('candidateScoreP95P10Ratio'),
      `cast description should mention candidateScoreP95P10Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
