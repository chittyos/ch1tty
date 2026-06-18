/**
 * VVVVVVV: explanation.candidateScoreP90 in ch1tty/cast when explain:true.
 *
 * candidateScoreP90: number — 90th percentile of the ascending candidate score distribution.
 * Computed via linear interpolation on the sorted pool (sorted descending in scoredTools).
 * Ascending P90 = descending index (n-1)*0.1.
 *
 * Present when: >= 2 candidates.
 * Absent when: no_match or single candidate.
 * Always >= 0.
 * Always <= winnerScore (maximum).
 * Always >= lowestCandidateScore (minimum).
 * Always >= medianCandidateScore (P90 is above the median).
 * For n=2: candidateScoreP90 = 0.9 * winnerScore + 0.1 * runnerUpScore.
 *
 * Covered:
 *   VVVVVVV-1: present when >= 2 candidates
 *   VVVVVVV-2: always >= 0 and finite when present
 *   VVVVVVV-3: always <= winnerScore
 *   VVVVVVV-4: for n=2: equals 0.9*winnerScore + 0.1*runnerUpScore
 *   VVVVVVV-5: absent on cast:no_match
 *   VVVVVVV-6: absent when only 1 candidate
 *   VVVVVVV-7: always >= medianCandidateScore when both present
 *   VVVVVVV-8: tool description documents candidateScoreP90
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-vvvvvvv-${label}-${Date.now()}.jsonl`);
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

test('VVVVVVV-1: present when >= 2 candidates', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('v1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    assert.ok('candidateScoreP90' in explanation,
      `candidateScoreP90 should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.candidateScoreP90, 'number', 'candidateScoreP90 should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('VVVVVVV-2: always >= 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('v2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP90' in explanation) {
      assert.ok(
        explanation.candidateScoreP90 >= -1e-9,
        `candidateScoreP90 should be >= 0, got ${explanation.candidateScoreP90}`,
      );
      assert.ok(
        Number.isFinite(explanation.candidateScoreP90),
        `candidateScoreP90 should be finite, got ${explanation.candidateScoreP90}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('VVVVVVV-3: always <= winnerScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('v3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP90' in explanation && 'winnerScore' in explanation) {
      assert.ok(
        explanation.candidateScoreP90 <= explanation.winnerScore + 1e-9,
        `candidateScoreP90 (${explanation.candidateScoreP90}) should be <= winnerScore (${explanation.winnerScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('VVVVVVV-4: for n=2 equals 0.9*winnerScore + 0.1*runnerUpScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('v4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP90' in explanation && 'winnerScore' in explanation && 'runnerUpScore' in explanation
        && explanation.candidateCount === 2) {
      const expected = 0.9 * explanation.winnerScore + 0.1 * explanation.runnerUpScore;
      assert.ok(
        Math.abs(explanation.candidateScoreP90 - expected) < 1e-9,
        `candidateScoreP90 (${explanation.candidateScoreP90}) should equal 0.9*winnerScore+0.1*runnerUpScore (${expected}) when n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('VVVVVVV-5: absent on cast:no_match', async () => {
  const path = dlqPath('v5');
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
      !('candidateScoreP90' in parsed.explanation),
      `candidateScoreP90 should be absent on no_match, found: ${parsed.explanation.candidateScoreP90}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('VVVVVVV-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('v6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP90' in explanation),
      `candidateScoreP90 should be absent with single candidate, found: ${explanation.candidateScoreP90}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('VVVVVVV-7: always >= medianCandidateScore when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('v7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP90' in explanation && 'medianCandidateScore' in explanation) {
      assert.ok(
        explanation.candidateScoreP90 >= explanation.medianCandidateScore - 1e-9,
        `candidateScoreP90 (${explanation.candidateScoreP90}) should be >= medianCandidateScore (${explanation.medianCandidateScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('VVVVVVV-8: tool description documents candidateScoreP90', async () => {
  const path = dlqPath('v8');
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
      cast.description?.includes('candidateScoreP90'),
      `cast description should mention candidateScoreP90, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
