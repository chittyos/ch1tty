/**
 * JJJJJJJJ: explanation.candidateScoreTrimmedMean in ch1tty/cast when explain:true.
 *
 * candidateScoreTrimmedMean: number — 10% trimmed mean of candidate scores:
 * arithmetic mean after excluding the bottom floor(n*0.1) and top floor(n*0.1)
 * candidates (symmetric count-based truncation).
 *
 * Present when: >= 2 candidates.
 * Absent when: no_match or single candidate.
 * Always >= 0.
 * Always <= winnerScore.
 * For n < 10: trimCount = 0, equals candidateScoreMean exactly.
 * For n >= 10: winner and lowest are excluded from the average.
 *
 * Covered:
 *   JJJJJJJJ-1: present when >= 2 candidates
 *   JJJJJJJJ-2: always >= 0 and finite when present
 *   JJJJJJJJ-3: for n < 10 equals candidateScoreMean (no trimming)
 *   JJJJJJJJ-4: always <= winnerScore
 *   JJJJJJJJ-5: absent on cast:no_match
 *   JJJJJJJJ-6: absent when only 1 candidate
 *   JJJJJJJJ-7: always >= lowestCandidateScore
 *   JJJJJJJJ-8: tool description documents candidateScoreTrimmedMean
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

test('JJJJJJJJ-1: present when >= 2 candidates', async () => {
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
    assert.ok('candidateScoreTrimmedMean' in explanation,
      `candidateScoreTrimmedMean should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.candidateScoreTrimmedMean, 'number', 'candidateScoreTrimmedMean should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('JJJJJJJJ-2: always >= 0 and finite when present', async () => {
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
    if ('candidateScoreTrimmedMean' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreTrimmedMean),
        `candidateScoreTrimmedMean should be finite, got ${explanation.candidateScoreTrimmedMean}`,
      );
      assert.ok(
        explanation.candidateScoreTrimmedMean >= -1e-9,
        `candidateScoreTrimmedMean should be >= 0, got ${explanation.candidateScoreTrimmedMean}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('JJJJJJJJ-3: for n < 10 equals candidateScoreMean (no trimming)', async () => {
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
    if ('candidateScoreTrimmedMean' in explanation && 'candidateScoreMean' in explanation && explanation.candidateCount < 10) {
      assert.ok(
        Math.abs(explanation.candidateScoreTrimmedMean - explanation.candidateScoreMean) < 1e-9,
        `candidateScoreTrimmedMean (${explanation.candidateScoreTrimmedMean}) should equal candidateScoreMean (${explanation.candidateScoreMean}) for n < 10`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('JJJJJJJJ-4: always <= winnerScore', async () => {
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
    if ('candidateScoreTrimmedMean' in explanation && 'winnerScore' in explanation) {
      assert.ok(
        explanation.candidateScoreTrimmedMean <= explanation.winnerScore + 1e-9,
        `candidateScoreTrimmedMean (${explanation.candidateScoreTrimmedMean}) should be <= winnerScore (${explanation.winnerScore})`,
      );
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
      !('candidateScoreTrimmedMean' in parsed.explanation),
      `candidateScoreTrimmedMean should be absent on no_match, found: ${parsed.explanation.candidateScoreTrimmedMean}`,
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
      !('candidateScoreTrimmedMean' in explanation),
      `candidateScoreTrimmedMean should be absent with single candidate, found: ${explanation.candidateScoreTrimmedMean}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('JJJJJJJJ-7: always >= lowestCandidateScore', async () => {
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
    if ('candidateScoreTrimmedMean' in explanation && 'lowestCandidateScore' in explanation) {
      assert.ok(
        explanation.candidateScoreTrimmedMean >= explanation.lowestCandidateScore - 1e-9,
        `candidateScoreTrimmedMean (${explanation.candidateScoreTrimmedMean}) should be >= lowestCandidateScore (${explanation.lowestCandidateScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('JJJJJJJJ-8: tool description documents candidateScoreTrimmedMean', async () => {
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
      cast.description?.includes('candidateScoreTrimmedMean'),
      `cast description should mention candidateScoreTrimmedMean, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
