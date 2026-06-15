/**
 * XXXXXX: explanation.candidateScoreMean in ch1tty/cast when explain:true.
 *
 * candidateScoreMean: number — arithmetic mean of the full candidate pool
 * (totalCandidateScore / candidateCount).
 *
 * Present when: >= 2 candidates.
 * Absent when: no_match or single candidate.
 * Always <= winnerScore (winner is the maximum).
 * When candidateCount <= 5: equals topCandidatesMeanScore (same pool).
 *
 * Covered:
 *   XXXXXX-1: present when >= 2 candidates
 *   XXXXXX-2: always <= winnerScore when present
 *   XXXXXX-3: equals winnerScore when all candidates have identical scores
 *   XXXXXX-4: equals topCandidatesMeanScore when candidateCount <= 5
 *   XXXXXX-5: absent on cast:no_match
 *   XXXXXX-6: absent when only 1 candidate
 *   XXXXXX-7: present regardless of focus (focus inactive)
 *   XXXXXX-8: tool description documents candidateScoreMean
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-xxxxxx-${label}-${Date.now()}.jsonl`);
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

test('XXXXXX-1: present when >= 2 candidates', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('x1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    assert.ok('candidateScoreMean' in explanation,
      `candidateScoreMean should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.candidateScoreMean, 'number', 'candidateScoreMean should be a number');
    assert.ok(Number.isFinite(explanation.candidateScoreMean), 'candidateScoreMean should be finite');
  } finally {
    await agg.shutdown();
  }
});

test('XXXXXX-2: always <= winnerScore when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('x2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('candidateScoreMean' in explanation, 'candidateScoreMean should be present');
    assert.ok(
      explanation.candidateScoreMean <= explanation.winnerScore + 1e-9,
      `candidateScoreMean (${explanation.candidateScoreMean}) should be <= winnerScore (${explanation.winnerScore})`,
    );
    assert.ok(explanation.candidateScoreMean >= 0, 'candidateScoreMean should be >= 0');
  } finally {
    await agg.shutdown();
  }
});

test('XXXXXX-3: equals winnerScore when all candidates have identical scores', async () => {
  const SAME_DESC = 'billing invoice payment charge query database';
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('x3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: SAME_DESC, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('candidateScoreMean' in explanation, 'candidateScoreMean should be present');
    if (Math.abs(explanation.winnerScore - explanation.runnerUpScore) < 1e-9) {
      assert.ok(
        Math.abs(explanation.candidateScoreMean - explanation.winnerScore) < 1e-9,
        `candidateScoreMean (${explanation.candidateScoreMean}) should equal winnerScore (${explanation.winnerScore}) when all scores equal`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('XXXXXX-4: equals topCandidatesMeanScore when candidateCount <= 5', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('x4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount <= 5, 'test requires candidateCount <= 5');
    assert.ok('candidateScoreMean' in explanation, 'candidateScoreMean should be present');
    assert.ok('topCandidatesMeanScore' in explanation, 'topCandidatesMeanScore should be present');
    assert.ok(
      Math.abs(explanation.candidateScoreMean - explanation.topCandidatesMeanScore) < 1e-9,
      `candidateScoreMean (${explanation.candidateScoreMean}) should equal topCandidatesMeanScore (${explanation.topCandidatesMeanScore}) when candidateCount <= 5`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('XXXXXX-5: absent on cast:no_match', async () => {
  const path = dlqPath('x5');
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
      !('candidateScoreMean' in parsed.explanation),
      `candidateScoreMean should be absent on no_match, found: ${parsed.explanation.candidateScoreMean}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('XXXXXX-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('x6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreMean' in explanation),
      `candidateScoreMean should be absent with single candidate, found: ${explanation.candidateScoreMean}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('XXXXXX-7: present regardless of focus (focus inactive)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('x7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok('candidateScoreMean' in explanation,
      `candidateScoreMean should be present without focus; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('XXXXXX-8: tool description documents candidateScoreMean', async () => {
  const path = dlqPath('x8');
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
      cast.description?.includes('candidateScoreMean'),
      `cast description should mention candidateScoreMean, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
