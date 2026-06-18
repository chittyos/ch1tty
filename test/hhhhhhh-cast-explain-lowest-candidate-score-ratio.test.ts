/**
 * HHHHHHH: explanation.lowestCandidateScoreRatio in ch1tty/cast when explain:true.
 *
 * lowestCandidateScoreRatio: number — lowestCandidateScore / winnerScore.
 * How strong the weakest candidate is relative to the winner.
 * Always in [0, 1]. 1 = all scores identical. 0 = weakest scored nothing.
 *
 * Present when: >= 2 candidates and winnerScore > 0.
 * Absent when: no_match, single candidate, or winnerScore === 0.
 * Identity: lowestCandidateScoreRatio * winnerScore === lowestCandidateScore.
 *
 * Covered:
 *   HHHHHHH-1: present when >= 2 candidates with nonzero winnerScore
 *   HHHHHHH-2: always in [0, 1] and finite when present
 *   HHHHHHH-3: equals 1 when all candidates have identical scores
 *   HHHHHHH-4: identity — lowestCandidateScoreRatio * winnerScore === lowestCandidateScore
 *   HHHHHHH-5: absent on cast:no_match
 *   HHHHHHH-6: absent when only 1 candidate
 *   HHHHHHH-7: present regardless of focus (focus inactive)
 *   HHHHHHH-8: tool description documents lowestCandidateScoreRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-hhhhhhh-${label}-${Date.now()}.jsonl`);
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

test('HHHHHHH-1: present when >= 2 candidates with nonzero winnerScore', async () => {
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
    assert.ok('lowestCandidateScoreRatio' in explanation,
      `lowestCandidateScoreRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.lowestCandidateScoreRatio, 'number', 'lowestCandidateScoreRatio should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('HHHHHHH-2: always in [0, 1] and finite when present', async () => {
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
    if ('lowestCandidateScoreRatio' in explanation) {
      assert.ok(
        explanation.lowestCandidateScoreRatio >= -1e-9,
        `lowestCandidateScoreRatio should be >= 0, got ${explanation.lowestCandidateScoreRatio}`,
      );
      assert.ok(
        explanation.lowestCandidateScoreRatio <= 1 + 1e-9,
        `lowestCandidateScoreRatio should be <= 1, got ${explanation.lowestCandidateScoreRatio}`,
      );
      assert.ok(
        Number.isFinite(explanation.lowestCandidateScoreRatio),
        `lowestCandidateScoreRatio should be finite, got ${explanation.lowestCandidateScoreRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('HHHHHHH-3: equals 1 when all candidates have identical scores', async () => {
  const SAME_DESC = 'billing invoice payment charge query database';
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('h3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: SAME_DESC, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('lowestCandidateScoreRatio' in explanation) {
      if (Math.abs(explanation.winnerScore - explanation.runnerUpScore) < 1e-9) {
        assert.ok(
          Math.abs(explanation.lowestCandidateScoreRatio - 1) < 1e-9,
          `lowestCandidateScoreRatio should be 1 when all scores equal, got ${explanation.lowestCandidateScoreRatio}`,
        );
      }
    }
    assert.ok(explanation.candidateCount >= 1, 'should have candidates');
  } finally {
    await agg.shutdown();
  }
});

test('HHHHHHH-4: identity — lowestCandidateScoreRatio * winnerScore === lowestCandidateScore', async () => {
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
    if ('lowestCandidateScoreRatio' in explanation && 'lowestCandidateScore' in explanation) {
      const reconstructed = explanation.lowestCandidateScoreRatio * explanation.winnerScore;
      assert.ok(
        Math.abs(reconstructed - explanation.lowestCandidateScore) < 1e-9,
        `lowestCandidateScoreRatio * winnerScore (${reconstructed}) should equal lowestCandidateScore (${explanation.lowestCandidateScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('HHHHHHH-5: absent on cast:no_match', async () => {
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
      !('lowestCandidateScoreRatio' in parsed.explanation),
      `lowestCandidateScoreRatio should be absent on no_match, found: ${parsed.explanation.lowestCandidateScoreRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('HHHHHHH-6: absent when only 1 candidate', async () => {
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
      !('lowestCandidateScoreRatio' in explanation),
      `lowestCandidateScoreRatio should be absent with single candidate, found: ${explanation.lowestCandidateScoreRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('HHHHHHH-7: present regardless of focus (focus inactive)', async () => {
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
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok('lowestCandidateScoreRatio' in explanation,
      `lowestCandidateScoreRatio should be present without focus; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('HHHHHHH-8: tool description documents lowestCandidateScoreRatio', async () => {
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
      cast.description?.includes('lowestCandidateScoreRatio'),
      `cast description should mention lowestCandidateScoreRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
