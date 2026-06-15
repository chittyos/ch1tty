/**
 * YYYYYY: explanation.medianCandidateScore in ch1tty/cast when explain:true.
 *
 * medianCandidateScore: number — median (50th percentile) of the full candidate
 * pool. For odd n: middle score. For even n: average of two middle scores.
 *
 * Present when: >= 2 candidates.
 * Absent when: no_match or single candidate.
 * Always in [lowestCandidateScore, winnerScore].
 *
 * Covered:
 *   YYYYYY-1: present when >= 2 candidates
 *   YYYYYY-2: always in [lowestCandidateScore, winnerScore]
 *   YYYYYY-3: equals winnerScore when all candidates have identical scores
 *   YYYYYY-4: is a finite number when present
 *   YYYYYY-5: absent on cast:no_match
 *   YYYYYY-6: absent when only 1 candidate
 *   YYYYYY-7: present regardless of focus (focus inactive)
 *   YYYYYY-8: tool description documents medianCandidateScore
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-yyyyyy-${label}-${Date.now()}.jsonl`);
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

test('YYYYYY-1: present when >= 2 candidates', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('y1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    assert.ok('medianCandidateScore' in explanation,
      `medianCandidateScore should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.medianCandidateScore, 'number', 'medianCandidateScore should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('YYYYYY-2: always in [lowestCandidateScore, winnerScore]', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('y2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('medianCandidateScore' in explanation, 'medianCandidateScore should be present');
    assert.ok(
      explanation.medianCandidateScore >= explanation.lowestCandidateScore - 1e-9,
      `medianCandidateScore (${explanation.medianCandidateScore}) should be >= lowestCandidateScore (${explanation.lowestCandidateScore})`,
    );
    assert.ok(
      explanation.medianCandidateScore <= explanation.winnerScore + 1e-9,
      `medianCandidateScore (${explanation.medianCandidateScore}) should be <= winnerScore (${explanation.winnerScore})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('YYYYYY-3: equals winnerScore when all candidates have identical scores', async () => {
  const SAME_DESC = 'billing invoice payment charge query database';
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('y3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: SAME_DESC, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('medianCandidateScore' in explanation, 'medianCandidateScore should be present');
    if (Math.abs(explanation.winnerScore - explanation.runnerUpScore) < 1e-9) {
      assert.ok(
        Math.abs(explanation.medianCandidateScore - explanation.winnerScore) < 1e-9,
        `medianCandidateScore (${explanation.medianCandidateScore}) should equal winnerScore (${explanation.winnerScore}) when all scores are equal`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('YYYYYY-4: is a finite number when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('y4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('medianCandidateScore' in explanation) {
      assert.ok(
        Number.isFinite(explanation.medianCandidateScore),
        `medianCandidateScore should be finite, got ${explanation.medianCandidateScore}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('YYYYYY-5: absent on cast:no_match', async () => {
  const path = dlqPath('y5');
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
      !('medianCandidateScore' in parsed.explanation),
      `medianCandidateScore should be absent on no_match, found: ${parsed.explanation.medianCandidateScore}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('YYYYYY-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('y6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('medianCandidateScore' in explanation),
      `medianCandidateScore should be absent with single candidate, found: ${explanation.medianCandidateScore}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('YYYYYY-7: present regardless of focus (focus inactive)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('y7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok('medianCandidateScore' in explanation,
      `medianCandidateScore should be present without focus; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('YYYYYY-8: tool description documents medianCandidateScore', async () => {
  const path = dlqPath('y8');
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
      cast.description?.includes('medianCandidateScore'),
      `cast description should mention medianCandidateScore, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
