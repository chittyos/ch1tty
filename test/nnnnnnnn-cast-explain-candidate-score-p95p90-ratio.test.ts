/**
 * NNNNNNNN: explanation.candidateScoreP95P90Ratio in ch1tty/cast when explain:true.
 *
 * candidateScoreP95P90Ratio: number — ratio of P95 to P90:
 * candidateScoreP95 / candidateScoreP90.
 *
 * Present when: >= 2 candidates and candidateScoreP90 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP90 === 0.
 * Always >= 1 (P95 >= P90 by definition).
 * Always <= candidateScoreTailAsymmetryRatio (P95/P05) when both present (P90 >= P05).
 * Always <= candidateScoreP95P75Ratio (P95/P75) when both present (P90 >= P75).
 * For n=2: (0.95*w + 0.05*r) / (0.9*w + 0.1*r).
 * Identity: candidateScoreP95P90Ratio * candidateScoreP90 === candidateScoreP95.
 *
 * Covered:
 *   NNNNNNNN-1: present when >= 2 candidates and candidateScoreP90 > 0
 *   NNNNNNNN-2: always >= 1 and finite when present
 *   NNNNNNNN-3: always <= candidateScoreTailAsymmetryRatio when both present (P90 >= P05)
 *   NNNNNNNN-4: for n=2 equals (0.95*w + 0.05*r) / (0.9*w + 0.1*r)
 *   NNNNNNNN-5: absent on cast:no_match
 *   NNNNNNNN-6: absent when only 1 candidate
 *   NNNNNNNN-7: identity — candidateScoreP95P90Ratio * candidateScoreP90 === candidateScoreP95
 *   NNNNNNNN-8: tool description documents candidateScoreP95P90Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-nnnnnnnn-${label}-${Date.now()}.jsonl`);
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

test('NNNNNNNN-1: present when >= 2 candidates and candidateScoreP90 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('n1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP90' in explanation && explanation.candidateScoreP90 > 0 && 'candidateScoreP95' in explanation) {
      assert.ok('candidateScoreP95P90Ratio' in explanation,
        `candidateScoreP95P90Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreP95P90Ratio, 'number', 'candidateScoreP95P90Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('NNNNNNNN-2: always >= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('n2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP95P90Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP95P90Ratio),
        `candidateScoreP95P90Ratio should be finite, got ${explanation.candidateScoreP95P90Ratio}`,
      );
      assert.ok(
        explanation.candidateScoreP95P90Ratio >= 1 - 1e-9,
        `candidateScoreP95P90Ratio should be >= 1, got ${explanation.candidateScoreP95P90Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('NNNNNNNN-3: always <= candidateScoreTailAsymmetryRatio when both present (P90 >= P05)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('n3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP95P90Ratio' in explanation && 'candidateScoreTailAsymmetryRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreP95P90Ratio <= explanation.candidateScoreTailAsymmetryRatio + 1e-9,
        `candidateScoreP95P90Ratio (${explanation.candidateScoreP95P90Ratio}) should be <= candidateScoreTailAsymmetryRatio (${explanation.candidateScoreTailAsymmetryRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('NNNNNNNN-4: for n=2 equals (0.95*w + 0.05*r) / (0.9*w + 0.1*r)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('n4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP95P90Ratio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0) {
      const p95 = 0.95 * explanation.winnerScore + 0.05 * explanation.runnerUpScore;
      const p90 = 0.9 * explanation.winnerScore + 0.1 * explanation.runnerUpScore;
      if (p90 > 0) {
        const expected = p95 / p90;
        assert.ok(
          Math.abs(explanation.candidateScoreP95P90Ratio - expected) < 1e-9,
          `candidateScoreP95P90Ratio (${explanation.candidateScoreP95P90Ratio}) should equal (0.95w+0.05r)/(0.9w+0.1r) (${expected}) for n=2`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('NNNNNNNN-5: absent on cast:no_match', async () => {
  const path = dlqPath('n5');
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
      !('candidateScoreP95P90Ratio' in parsed.explanation),
      `candidateScoreP95P90Ratio should be absent on no_match, found: ${parsed.explanation.candidateScoreP95P90Ratio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('NNNNNNNN-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('n6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP95P90Ratio' in explanation),
      `candidateScoreP95P90Ratio should be absent with single candidate, found: ${explanation.candidateScoreP95P90Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('NNNNNNNN-7: identity — candidateScoreP95P90Ratio * candidateScoreP90 === candidateScoreP95', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('n7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP95P90Ratio' in explanation && 'candidateScoreP90' in explanation && 'candidateScoreP95' in explanation) {
      const product = explanation.candidateScoreP95P90Ratio * explanation.candidateScoreP90;
      assert.ok(
        Math.abs(product - explanation.candidateScoreP95) < 1e-9,
        `candidateScoreP95P90Ratio * candidateScoreP90 (${product}) should equal candidateScoreP95 (${explanation.candidateScoreP95})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('NNNNNNNN-8: tool description documents candidateScoreP95P90Ratio', async () => {
  const path = dlqPath('n8');
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
      cast.description?.includes('candidateScoreP95P90Ratio'),
      `cast description should mention candidateScoreP95P90Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
