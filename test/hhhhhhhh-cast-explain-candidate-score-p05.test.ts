/**
 * HHHHHHHH: explanation.candidateScoreP05 in ch1tty/cast when explain:true.
 *
 * candidateScoreP05: number — 5th percentile of candidate scores,
 * computed via linear interpolation on the descending-sorted pool.
 * Ascending P05 = descending index (n-1)*0.95.
 *
 * Present when: >= 2 candidates.
 * Absent when: no_match or single candidate.
 * Always >= 0.
 * Always <= candidateScoreP10.
 * Always >= lowestCandidateScore.
 * For n=2: 0.05 * winnerScore + 0.95 * runnerUpScore.
 *
 * Covered:
 *   HHHHHHHH-1: present when >= 2 candidates
 *   HHHHHHHH-2: always >= 0 and finite when present
 *   HHHHHHHH-3: always <= candidateScoreP10 when both present
 *   HHHHHHHH-4: for n=2 equals 0.05*winnerScore + 0.95*runnerUpScore
 *   HHHHHHHH-5: absent on cast:no_match
 *   HHHHHHHH-6: absent when only 1 candidate
 *   HHHHHHHH-7: always >= lowestCandidateScore
 *   HHHHHHHH-8: tool description documents candidateScoreP05
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

test('HHHHHHHH-1: present when >= 2 candidates', async () => {
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
    assert.ok('candidateScoreP05' in explanation,
      `candidateScoreP05 should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.candidateScoreP05, 'number', 'candidateScoreP05 should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('HHHHHHHH-2: always >= 0 and finite when present', async () => {
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
    if ('candidateScoreP05' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP05),
        `candidateScoreP05 should be finite, got ${explanation.candidateScoreP05}`,
      );
      assert.ok(
        explanation.candidateScoreP05 >= -1e-9,
        `candidateScoreP05 should be >= 0, got ${explanation.candidateScoreP05}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('HHHHHHHH-3: always <= candidateScoreP10 when both present', async () => {
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
    if ('candidateScoreP05' in explanation && 'candidateScoreP10' in explanation) {
      assert.ok(
        explanation.candidateScoreP05 <= explanation.candidateScoreP10 + 1e-9,
        `candidateScoreP05 (${explanation.candidateScoreP05}) should be <= candidateScoreP10 (${explanation.candidateScoreP10})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('HHHHHHHH-4: for n=2 equals 0.05*winnerScore + 0.95*runnerUpScore', async () => {
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
    if ('candidateScoreP05' in explanation && explanation.candidateCount === 2) {
      const expected = 0.05 * explanation.winnerScore + 0.95 * explanation.runnerUpScore;
      assert.ok(
        Math.abs(explanation.candidateScoreP05 - expected) < 1e-9,
        `candidateScoreP05 (${explanation.candidateScoreP05}) should equal 0.05*winner+0.95*runnerUp (${expected}) for n=2`,
      );
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
      !('candidateScoreP05' in parsed.explanation),
      `candidateScoreP05 should be absent on no_match, found: ${parsed.explanation.candidateScoreP05}`,
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
      !('candidateScoreP05' in explanation),
      `candidateScoreP05 should be absent with single candidate, found: ${explanation.candidateScoreP05}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('HHHHHHHH-7: always >= lowestCandidateScore', async () => {
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
    if ('candidateScoreP05' in explanation && 'lowestCandidateScore' in explanation) {
      assert.ok(
        explanation.candidateScoreP05 >= explanation.lowestCandidateScore - 1e-9,
        `candidateScoreP05 (${explanation.candidateScoreP05}) should be >= lowestCandidateScore (${explanation.lowestCandidateScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('HHHHHHHH-8: tool description documents candidateScoreP05', async () => {
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
      cast.description?.includes('candidateScoreP05'),
      `cast description should mention candidateScoreP05, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
