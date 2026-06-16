/**
 * FFFFFFFF: explanation.candidateScoreP25 in ch1tty/cast when explain:true.
 *
 * candidateScoreP25: number — 25th percentile (Q1) of candidate scores,
 * computed via linear interpolation on the descending-sorted pool.
 * Ascending P25 = descending index (n-1)*0.75.
 *
 * Present when: >= 2 candidates.
 * Absent when: no_match or single candidate.
 * Always >= 0.
 * Always <= medianCandidateScore.
 * Always <= candidateScoreP75.
 * For n=2: 0.25 * winnerScore + 0.75 * runnerUpScore.
 * Identity: candidateScoreP75 - candidateScoreP25 === candidateScoreIQR when both present.
 *
 * Covered:
 *   FFFFFFFF-1: present when >= 2 candidates
 *   FFFFFFFF-2: always >= 0 and finite when present
 *   FFFFFFFF-3: always <= medianCandidateScore
 *   FFFFFFFF-4: for n=2 equals 0.25*winnerScore + 0.75*runnerUpScore
 *   FFFFFFFF-5: absent on cast:no_match
 *   FFFFFFFF-6: absent when only 1 candidate
 *   FFFFFFFF-7: always <= candidateScoreP75
 *   FFFFFFFF-8: tool description documents candidateScoreP25
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-ffffffff-${label}-${Date.now()}.jsonl`);
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

test('FFFFFFFF-1: present when >= 2 candidates', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('f1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    assert.ok('candidateScoreP25' in explanation,
      `candidateScoreP25 should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.candidateScoreP25, 'number', 'candidateScoreP25 should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('FFFFFFFF-2: always >= 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('f2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP25' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP25),
        `candidateScoreP25 should be finite, got ${explanation.candidateScoreP25}`,
      );
      assert.ok(
        explanation.candidateScoreP25 >= -1e-9,
        `candidateScoreP25 should be >= 0, got ${explanation.candidateScoreP25}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('FFFFFFFF-3: always <= medianCandidateScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('f3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP25' in explanation && 'medianCandidateScore' in explanation) {
      assert.ok(
        explanation.candidateScoreP25 <= explanation.medianCandidateScore + 1e-9,
        `candidateScoreP25 (${explanation.candidateScoreP25}) should be <= medianCandidateScore (${explanation.medianCandidateScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('FFFFFFFF-4: for n=2 equals 0.25*winnerScore + 0.75*runnerUpScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('f4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP25' in explanation && explanation.candidateCount === 2) {
      const expected = 0.25 * explanation.winnerScore + 0.75 * explanation.runnerUpScore;
      assert.ok(
        Math.abs(explanation.candidateScoreP25 - expected) < 1e-9,
        `candidateScoreP25 (${explanation.candidateScoreP25}) should equal 0.25*winner+0.75*runnerUp (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('FFFFFFFF-5: absent on cast:no_match', async () => {
  const path = dlqPath('f5');
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
      !('candidateScoreP25' in parsed.explanation),
      `candidateScoreP25 should be absent on no_match, found: ${parsed.explanation.candidateScoreP25}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('FFFFFFFF-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('f6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP25' in explanation),
      `candidateScoreP25 should be absent with single candidate, found: ${explanation.candidateScoreP25}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('FFFFFFFF-7: always <= candidateScoreP75', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('f7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP25' in explanation && 'candidateScoreP75' in explanation) {
      assert.ok(
        explanation.candidateScoreP25 <= explanation.candidateScoreP75 + 1e-9,
        `candidateScoreP25 (${explanation.candidateScoreP25}) should be <= candidateScoreP75 (${explanation.candidateScoreP75})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('FFFFFFFF-8: tool description documents candidateScoreP25', async () => {
  const path = dlqPath('f8');
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
      cast.description?.includes('candidateScoreP25'),
      `cast description should mention candidateScoreP25, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
