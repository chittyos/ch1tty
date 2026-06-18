/**
 * JJJJJJJJ: explanation.candidateScoreP75P10Ratio in ch1tty/cast when explain:true.
 *
 * candidateScoreP75P10Ratio: number — ratio of P75 (Q3) to P10:
 * candidateScoreP75 / candidateScoreP10.
 *
 * Present when: >= 2 candidates and candidateScoreP10 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP10 === 0.
 * Always >= 1 (P75 >= P10 by definition).
 * Always <= candidateScoreP90P10Ratio (P90/P10) when both present (P75 <= P90).
 * Always >= candidateScoreP75P25Ratio (P75/P25) when both present (P10 <= P25).
 * For n=2: (0.75*w + 0.25*r) / (0.1*w + 0.9*r).
 * Identity: candidateScoreP75P10Ratio * candidateScoreP10 === candidateScoreP75.
 *
 * Covered:
 *   JJJJJJJJ-1: present when >= 2 candidates and candidateScoreP10 > 0
 *   JJJJJJJJ-2: always >= 1 and finite when present
 *   JJJJJJJJ-3: always <= candidateScoreP90P10Ratio when both present (P75 <= P90)
 *   JJJJJJJJ-4: for n=2 equals (0.75*w + 0.25*r) / (0.1*w + 0.9*r)
 *   JJJJJJJJ-5: absent on cast:no_match
 *   JJJJJJJJ-6: absent when only 1 candidate
 *   JJJJJJJJ-7: identity — candidateScoreP75P10Ratio * candidateScoreP10 === candidateScoreP75
 *   JJJJJJJJ-8: tool description documents candidateScoreP75P10Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-jjjjjjjj-${label}-${Date.now()}.jsonl`);
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

test('JJJJJJJJ-1: present when >= 2 candidates and candidateScoreP10 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('j1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP10' in explanation && explanation.candidateScoreP10 > 0 && 'candidateScoreP75' in explanation) {
      assert.ok('candidateScoreP75P10Ratio' in explanation,
        `candidateScoreP75P10Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreP75P10Ratio, 'number', 'candidateScoreP75P10Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('JJJJJJJJ-2: always >= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('j2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP75P10Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP75P10Ratio),
        `candidateScoreP75P10Ratio should be finite, got ${explanation.candidateScoreP75P10Ratio}`,
      );
      assert.ok(
        explanation.candidateScoreP75P10Ratio >= 1 - 1e-9,
        `candidateScoreP75P10Ratio should be >= 1, got ${explanation.candidateScoreP75P10Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('JJJJJJJJ-3: always <= candidateScoreP90P10Ratio when both present (P75 <= P90)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('j3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP75P10Ratio' in explanation && 'candidateScoreP90P10Ratio' in explanation) {
      assert.ok(
        explanation.candidateScoreP75P10Ratio <= explanation.candidateScoreP90P10Ratio + 1e-9,
        `candidateScoreP75P10Ratio (${explanation.candidateScoreP75P10Ratio}) should be <= candidateScoreP90P10Ratio (${explanation.candidateScoreP90P10Ratio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('JJJJJJJJ-4: for n=2 equals (0.75*w + 0.25*r) / (0.1*w + 0.9*r)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('j4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP75P10Ratio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0) {
      const p75 = 0.75 * explanation.winnerScore + 0.25 * explanation.runnerUpScore;
      const p10 = 0.1 * explanation.winnerScore + 0.9 * explanation.runnerUpScore;
      if (p10 > 0) {
        const expected = p75 / p10;
        assert.ok(
          Math.abs(explanation.candidateScoreP75P10Ratio - expected) < 1e-9,
          `candidateScoreP75P10Ratio (${explanation.candidateScoreP75P10Ratio}) should equal (0.75w+0.25r)/(0.1w+0.9r) (${expected}) for n=2`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('JJJJJJJJ-5: absent on cast:no_match', async () => {
  const path = dlqPath('j5');
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
      !('candidateScoreP75P10Ratio' in parsed.explanation),
      `candidateScoreP75P10Ratio should be absent on no_match, found: ${parsed.explanation.candidateScoreP75P10Ratio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('JJJJJJJJ-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('j6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP75P10Ratio' in explanation),
      `candidateScoreP75P10Ratio should be absent with single candidate, found: ${explanation.candidateScoreP75P10Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('JJJJJJJJ-7: identity — candidateScoreP75P10Ratio * candidateScoreP10 === candidateScoreP75', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('j7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP75P10Ratio' in explanation && 'candidateScoreP10' in explanation && 'candidateScoreP75' in explanation) {
      const product = explanation.candidateScoreP75P10Ratio * explanation.candidateScoreP10;
      assert.ok(
        Math.abs(product - explanation.candidateScoreP75) < 1e-9,
        `candidateScoreP75P10Ratio * candidateScoreP10 (${product}) should equal candidateScoreP75 (${explanation.candidateScoreP75})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('JJJJJJJJ-8: tool description documents candidateScoreP75P10Ratio', async () => {
  const path = dlqPath('j8');
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
      cast.description?.includes('candidateScoreP75P10Ratio'),
      `cast description should mention candidateScoreP75P10Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
