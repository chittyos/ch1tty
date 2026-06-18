/**
 * AAAAAAAA: explanation.candidateScoreMedianToP05Ratio in ch1tty/cast when explain:true.
 *
 * candidateScoreMedianToP05Ratio: number — ratio of median to P05:
 * medianCandidateScore / candidateScoreP05.
 *
 * Present when: >= 2 candidates, medianCandidateScore defined, candidateScoreP05 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP05 === 0.
 * Always >= 1 (median >= P05 by definition).
 * Always >= candidateScoreMedianToP10Ratio (P05 <= P10 so median/P05 >= median/P10).
 * For n=2: (w+r) / (2*(0.05*w + 0.95*r)).
 * Identity: candidateScoreMedianToP05Ratio * candidateScoreP05 === medianCandidateScore.
 *
 * Covered:
 *   AAAAAAAA-1: present when >= 2 candidates and candidateScoreP05 > 0
 *   AAAAAAAA-2: always >= 1 and finite when present
 *   AAAAAAAA-3: always >= candidateScoreMedianToP10Ratio when both present (P05 <= P10)
 *   AAAAAAAA-4: for n=2 equals (w+r) / (2*(0.05*w + 0.95*r))
 *   AAAAAAAA-5: absent on cast:no_match
 *   AAAAAAAA-6: absent when only 1 candidate
 *   AAAAAAAA-7: identity — candidateScoreMedianToP05Ratio * candidateScoreP05 === medianCandidateScore
 *   AAAAAAAA-8: tool description documents candidateScoreMedianToP05Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-aaaaaaaa-${label}-${Date.now()}.jsonl`);
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

test('AAAAAAAA-1: present when >= 2 candidates and candidateScoreP05 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('a1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreP05' in explanation && explanation.candidateScoreP05 > 0 && 'medianCandidateScore' in explanation) {
      assert.ok('candidateScoreMedianToP05Ratio' in explanation,
        `candidateScoreMedianToP05Ratio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreMedianToP05Ratio, 'number', 'candidateScoreMedianToP05Ratio should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('AAAAAAAA-2: always >= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('a2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMedianToP05Ratio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreMedianToP05Ratio),
        `candidateScoreMedianToP05Ratio should be finite, got ${explanation.candidateScoreMedianToP05Ratio}`,
      );
      assert.ok(
        explanation.candidateScoreMedianToP05Ratio >= 1 - 1e-9,
        `candidateScoreMedianToP05Ratio should be >= 1, got ${explanation.candidateScoreMedianToP05Ratio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('AAAAAAAA-3: always >= candidateScoreMedianToP10Ratio when both present (P05 <= P10)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('a3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMedianToP05Ratio' in explanation && 'candidateScoreMedianToP10Ratio' in explanation) {
      assert.ok(
        explanation.candidateScoreMedianToP05Ratio >= explanation.candidateScoreMedianToP10Ratio - 1e-9,
        `candidateScoreMedianToP05Ratio (${explanation.candidateScoreMedianToP05Ratio}) should be >= candidateScoreMedianToP10Ratio (${explanation.candidateScoreMedianToP10Ratio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('AAAAAAAA-4: for n=2 equals (w+r) / (2*(0.05*w + 0.95*r))', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('a4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMedianToP05Ratio' in explanation && explanation.candidateCount === 2) {
      const p05 = 0.05 * explanation.winnerScore + 0.95 * explanation.runnerUpScore;
      if (p05 > 0) {
        const median = (explanation.winnerScore + explanation.runnerUpScore) / 2;
        const expected = median / p05;
        assert.ok(
          Math.abs(explanation.candidateScoreMedianToP05Ratio - expected) < 1e-9,
          `candidateScoreMedianToP05Ratio (${explanation.candidateScoreMedianToP05Ratio}) should equal (w+r)/(2*(0.05w+0.95r)) (${expected}) for n=2`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('AAAAAAAA-5: absent on cast:no_match', async () => {
  const path = dlqPath('a5');
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
      !('candidateScoreMedianToP05Ratio' in parsed.explanation),
      `candidateScoreMedianToP05Ratio should be absent on no_match, found: ${parsed.explanation.candidateScoreMedianToP05Ratio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('AAAAAAAA-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('a6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreMedianToP05Ratio' in explanation),
      `candidateScoreMedianToP05Ratio should be absent with single candidate, found: ${explanation.candidateScoreMedianToP05Ratio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('AAAAAAAA-7: identity — candidateScoreMedianToP05Ratio * candidateScoreP05 === medianCandidateScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('a7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMedianToP05Ratio' in explanation && 'candidateScoreP05' in explanation && 'medianCandidateScore' in explanation) {
      const product = explanation.candidateScoreMedianToP05Ratio * explanation.candidateScoreP05;
      assert.ok(
        Math.abs(product - explanation.medianCandidateScore) < 1e-9,
        `candidateScoreMedianToP05Ratio * candidateScoreP05 (${product}) should equal medianCandidateScore (${explanation.medianCandidateScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('AAAAAAAA-8: tool description documents candidateScoreMedianToP05Ratio', async () => {
  const path = dlqPath('a8');
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
      cast.description?.includes('candidateScoreMedianToP05Ratio'),
      `cast description should mention candidateScoreMedianToP05Ratio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
