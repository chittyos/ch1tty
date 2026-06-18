/**
 * WWWWWWW: explanation.candidateScoreP10 in ch1tty/cast when explain:true.
 *
 * candidateScoreP10: number — 10th percentile of the ascending candidate score distribution.
 * Computed via linear interpolation on the sorted pool (sorted descending in scoredTools).
 * Ascending P10 = descending index (n-1)*0.9.
 *
 * Present when: >= 2 candidates.
 * Absent when: no_match or single candidate.
 * Always >= 0.
 * Always >= lowestCandidateScore (at or above the minimum).
 * Always <= medianCandidateScore (P10 is at or below the median).
 * Always <= candidateScoreP90 (lower tail <= upper tail).
 * For n=2: candidateScoreP10 = 0.1 * winnerScore + 0.9 * runnerUpScore.
 *
 * Covered:
 *   WWWWWWW-1: present when >= 2 candidates
 *   WWWWWWW-2: always >= 0 and finite when present
 *   WWWWWWW-3: always >= lowestCandidateScore
 *   WWWWWWW-4: for n=2: equals 0.1*winnerScore + 0.9*runnerUpScore
 *   WWWWWWW-5: absent on cast:no_match
 *   WWWWWWW-6: absent when only 1 candidate
 *   WWWWWWW-7: always <= candidateScoreP90 when both present
 *   WWWWWWW-8: tool description documents candidateScoreP10
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-wwwwwww-${label}-${Date.now()}.jsonl`);
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

test('WWWWWWW-1: present when >= 2 candidates', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    assert.ok('candidateScoreP10' in explanation,
      `candidateScoreP10 should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.candidateScoreP10, 'number', 'candidateScoreP10 should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('WWWWWWW-2: always >= 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP10' in explanation) {
      assert.ok(
        explanation.candidateScoreP10 >= -1e-9,
        `candidateScoreP10 should be >= 0, got ${explanation.candidateScoreP10}`,
      );
      assert.ok(
        Number.isFinite(explanation.candidateScoreP10),
        `candidateScoreP10 should be finite, got ${explanation.candidateScoreP10}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('WWWWWWW-3: always >= lowestCandidateScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP10' in explanation && 'lowestCandidateScore' in explanation) {
      assert.ok(
        explanation.candidateScoreP10 >= explanation.lowestCandidateScore - 1e-9,
        `candidateScoreP10 (${explanation.candidateScoreP10}) should be >= lowestCandidateScore (${explanation.lowestCandidateScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('WWWWWWW-4: for n=2 equals 0.1*winnerScore + 0.9*runnerUpScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP10' in explanation && 'winnerScore' in explanation && 'runnerUpScore' in explanation
        && explanation.candidateCount === 2) {
      const expected = 0.1 * explanation.winnerScore + 0.9 * explanation.runnerUpScore;
      assert.ok(
        Math.abs(explanation.candidateScoreP10 - expected) < 1e-9,
        `candidateScoreP10 (${explanation.candidateScoreP10}) should equal 0.1*winnerScore+0.9*runnerUpScore (${expected}) when n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('WWWWWWW-5: absent on cast:no_match', async () => {
  const path = dlqPath('w5');
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
      !('candidateScoreP10' in parsed.explanation),
      `candidateScoreP10 should be absent on no_match, found: ${parsed.explanation.candidateScoreP10}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('WWWWWWW-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP10' in explanation),
      `candidateScoreP10 should be absent with single candidate, found: ${explanation.candidateScoreP10}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('WWWWWWW-7: always <= candidateScoreP90 when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP10' in explanation && 'candidateScoreP90' in explanation) {
      assert.ok(
        explanation.candidateScoreP10 <= explanation.candidateScoreP90 + 1e-9,
        `candidateScoreP10 (${explanation.candidateScoreP10}) should be <= candidateScoreP90 (${explanation.candidateScoreP90})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('WWWWWWW-8: tool description documents candidateScoreP10', async () => {
  const path = dlqPath('w8');
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
      cast.description?.includes('candidateScoreP10'),
      `cast description should mention candidateScoreP10, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
