/**
 * CCCCCCCC: explanation.candidateScoreWinsorizedMean in ch1tty/cast when explain:true.
 *
 * candidateScoreWinsorizedMean: number — 10% Winsorized mean: each score clamped to
 * [candidateScoreP10, candidateScoreP90] before averaging.
 * mean(max(P10, min(P90, score_i))).
 *
 * Present when: >= 2 candidates (same as P10/P90).
 * Absent when: no_match or single candidate.
 * Always >= 0.
 * Always >= candidateScoreP10.
 * Always <= candidateScoreP90.
 * For n=2: equals candidateScoreMean (P90+P10 = w+r, average = mean).
 *
 * Covered:
 *   CCCCCCCC-1: present when >= 2 candidates
 *   CCCCCCCC-2: always >= 0 and finite when present
 *   CCCCCCCC-3: always >= candidateScoreP10 and <= candidateScoreP90
 *   CCCCCCCC-4: for n=2 equals candidateScoreMean
 *   CCCCCCCC-5: absent on cast:no_match
 *   CCCCCCCC-6: absent when only 1 candidate
 *   CCCCCCCC-7: always <= winnerScore when present
 *   CCCCCCCC-8: tool description documents candidateScoreWinsorizedMean
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-cccccccc-${label}-${Date.now()}.jsonl`);
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

test('CCCCCCCC-1: present when >= 2 candidates', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('c1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    assert.ok('candidateScoreWinsorizedMean' in explanation,
      `candidateScoreWinsorizedMean should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.candidateScoreWinsorizedMean, 'number', 'candidateScoreWinsorizedMean should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('CCCCCCCC-2: always >= 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('c2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreWinsorizedMean' in explanation) {
      assert.ok(
        explanation.candidateScoreWinsorizedMean >= -1e-9,
        `candidateScoreWinsorizedMean should be >= 0, got ${explanation.candidateScoreWinsorizedMean}`,
      );
      assert.ok(
        Number.isFinite(explanation.candidateScoreWinsorizedMean),
        `candidateScoreWinsorizedMean should be finite, got ${explanation.candidateScoreWinsorizedMean}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('CCCCCCCC-3: always >= candidateScoreP10 and <= candidateScoreP90', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('c3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreWinsorizedMean' in explanation && 'candidateScoreP10' in explanation && 'candidateScoreP90' in explanation) {
      assert.ok(
        explanation.candidateScoreWinsorizedMean >= explanation.candidateScoreP10 - 1e-9,
        `candidateScoreWinsorizedMean (${explanation.candidateScoreWinsorizedMean}) should be >= P10 (${explanation.candidateScoreP10})`,
      );
      assert.ok(
        explanation.candidateScoreWinsorizedMean <= explanation.candidateScoreP90 + 1e-9,
        `candidateScoreWinsorizedMean (${explanation.candidateScoreWinsorizedMean}) should be <= P90 (${explanation.candidateScoreP90})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('CCCCCCCC-4: for n=2 equals candidateScoreMean', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('c4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreWinsorizedMean' in explanation && 'candidateScoreMean' in explanation && explanation.candidateCount === 2) {
      assert.ok(
        Math.abs(explanation.candidateScoreWinsorizedMean - explanation.candidateScoreMean) < 1e-9,
        `candidateScoreWinsorizedMean (${explanation.candidateScoreWinsorizedMean}) should equal candidateScoreMean (${explanation.candidateScoreMean}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('CCCCCCCC-5: absent on cast:no_match', async () => {
  const path = dlqPath('c5');
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
      !('candidateScoreWinsorizedMean' in parsed.explanation),
      `candidateScoreWinsorizedMean should be absent on no_match, found: ${parsed.explanation.candidateScoreWinsorizedMean}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('CCCCCCCC-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('c6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreWinsorizedMean' in explanation),
      `candidateScoreWinsorizedMean should be absent with single candidate, found: ${explanation.candidateScoreWinsorizedMean}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('CCCCCCCC-7: always <= winnerScore when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('c7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreWinsorizedMean' in explanation && 'winnerScore' in explanation) {
      assert.ok(
        explanation.candidateScoreWinsorizedMean <= explanation.winnerScore + 1e-9,
        `candidateScoreWinsorizedMean (${explanation.candidateScoreWinsorizedMean}) should be <= winnerScore (${explanation.winnerScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('CCCCCCCC-8: tool description documents candidateScoreWinsorizedMean', async () => {
  const path = dlqPath('c8');
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
      cast.description?.includes('candidateScoreWinsorizedMean'),
      `cast description should mention candidateScoreWinsorizedMean, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
