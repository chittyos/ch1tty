/**
 * SSSSSSSS: explanation.candidateScoreP25MedianRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreP25MedianRatio: number — ratio of P25 (Q1) to median (P50):
 * candidateScoreP25 / medianCandidateScore.
 *
 * Present when: >= 2 candidates and medianCandidateScore > 0.
 * Absent when: no_match, single candidate, or medianCandidateScore === 0.
 * Always <= 1 (P25 <= P50 by definition).
 * Always >= candidateScoreP10MedianRatio when both present (P25 >= P10).
 * Inverse of candidateScoreMedianToP25Ratio: product === 1 when both present.
 * For n=2: (0.25*w + 0.75*r) / (0.5*w + 0.5*r).
 * Identity: candidateScoreP25MedianRatio * medianCandidateScore === candidateScoreP25.
 *
 * Covered:
 *   SSSSSSSS-1: present when >= 2 candidates and medianCandidateScore > 0
 *   SSSSSSSS-2: always <= 1 and finite when present
 *   SSSSSSSS-3: always >= candidateScoreP10MedianRatio when both present (P25 >= P10)
 *   SSSSSSSS-4: for n=2 equals (0.25*w + 0.75*r) / (0.5*w + 0.5*r)
 *   SSSSSSSS-5: absent on cast:no_match
 *   SSSSSSSS-6: absent when only 1 candidate
 *   SSSSSSSS-7: identity — candidateScoreP25MedianRatio * medianCandidateScore === candidateScoreP25
 *   SSSSSSSS-8: tool description documents candidateScoreP25MedianRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-ssssssss-${label}-${Date.now()}.jsonl`);
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

test('SSSSSSSS-1: present when >= 2 candidates and medianCandidateScore > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('s1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('medianCandidateScore' in explanation && explanation.medianCandidateScore > 0 && 'candidateScoreP25' in explanation) {
      assert.ok('candidateScoreP25MedianRatio' in explanation,
        `candidateScoreP25MedianRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreP25MedianRatio, 'number', 'candidateScoreP25MedianRatio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('SSSSSSSS-2: always <= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('s2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP25MedianRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP25MedianRatio),
        `candidateScoreP25MedianRatio should be finite, got ${explanation.candidateScoreP25MedianRatio}`,
      );
      assert.ok(
        explanation.candidateScoreP25MedianRatio <= 1 + 1e-9,
        `candidateScoreP25MedianRatio should be <= 1, got ${explanation.candidateScoreP25MedianRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('SSSSSSSS-3: always >= candidateScoreP10MedianRatio when both present (P25 >= P10)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('s3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP25MedianRatio' in explanation && 'candidateScoreP10MedianRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreP25MedianRatio >= explanation.candidateScoreP10MedianRatio - 1e-9,
        `candidateScoreP25MedianRatio (${explanation.candidateScoreP25MedianRatio}) should be >= candidateScoreP10MedianRatio (${explanation.candidateScoreP10MedianRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('SSSSSSSS-4: for n=2 equals (0.25*w + 0.75*r) / (0.5*w + 0.5*r)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('s4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP25MedianRatio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0) {
      const p25 = 0.25 * explanation.winnerScore + 0.75 * explanation.runnerUpScore;
      const median = 0.5 * explanation.winnerScore + 0.5 * explanation.runnerUpScore;
      if (median > 0) {
        const expected = p25 / median;
        assert.ok(
          Math.abs(explanation.candidateScoreP25MedianRatio - expected) < 1e-9,
          `candidateScoreP25MedianRatio (${explanation.candidateScoreP25MedianRatio}) should equal (0.25w+0.75r)/(0.5w+0.5r) (${expected}) for n=2`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('SSSSSSSS-5: absent on cast:no_match', async () => {
  const path = dlqPath('s5');
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
      !('candidateScoreP25MedianRatio' in parsed.explanation),
      `candidateScoreP25MedianRatio should be absent on no_match, found: ${parsed.explanation.candidateScoreP25MedianRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('SSSSSSSS-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('s6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP25MedianRatio' in explanation),
      `candidateScoreP25MedianRatio should be absent with single candidate, found: ${explanation.candidateScoreP25MedianRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('SSSSSSSS-7: identity — candidateScoreP25MedianRatio * medianCandidateScore === candidateScoreP25', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('s7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP25MedianRatio' in explanation && 'medianCandidateScore' in explanation && 'candidateScoreP25' in explanation) {
      const product = explanation.candidateScoreP25MedianRatio * explanation.medianCandidateScore;
      assert.ok(
        Math.abs(product - explanation.candidateScoreP25) < 1e-9,
        `candidateScoreP25MedianRatio * medianCandidateScore (${product}) should equal candidateScoreP25 (${explanation.candidateScoreP25})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('SSSSSSSS-8: tool description documents candidateScoreP25MedianRatio', async () => {
  const path = dlqPath('s8');
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
      cast.description?.includes('candidateScoreP25MedianRatio'),
      `cast description should mention candidateScoreP25MedianRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
