/**
 * DDDDDDD: explanation.winnerScoreZScore in ch1tty/cast when explain:true.
 *
 * winnerScoreZScore: number — (winnerScore - candidateScoreMean) / candidateScoreStdDev.
 * How many standard deviations the winner sits above the full-pool mean.
 * Always >= 0 (winner is the maximum, so it is always >= mean).
 *
 * Present when: >= 2 candidates and candidateScoreStdDev > 0.
 * Absent when: no_match, single candidate, or all scores identical (stddev === 0).
 * Identity: winnerScoreZScore * candidateScoreStdDev + candidateScoreMean === winnerScore.
 *
 * Covered:
 *   DDDDDDD-1: present when >= 2 candidates with nonzero stddev
 *   DDDDDDD-2: always >= 0 and finite when present
 *   DDDDDDD-3: absent when all candidates have identical scores (stddev === 0)
 *   DDDDDDD-4: identity — winnerScoreZScore * candidateScoreStdDev + candidateScoreMean === winnerScore
 *   DDDDDDD-5: absent on cast:no_match
 *   DDDDDDD-6: absent when only 1 candidate
 *   DDDDDDD-7: present regardless of focus (focus inactive)
 *   DDDDDDD-8: tool description documents winnerScoreZScore
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-ddddddd-${label}-${Date.now()}.jsonl`);
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

test('DDDDDDD-1: present when >= 2 candidates with nonzero stddev', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('d1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if (explanation.candidateScoreStdDev > 0) {
      assert.ok('winnerScoreZScore' in explanation,
        `winnerScoreZScore should be present when stddev > 0; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.winnerScoreZScore, 'number', 'winnerScoreZScore should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('DDDDDDD-2: always >= 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('d2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreZScore' in explanation) {
      assert.ok(
        explanation.winnerScoreZScore >= -1e-9,
        `winnerScoreZScore should be >= 0, got ${explanation.winnerScoreZScore}`,
      );
      assert.ok(
        Number.isFinite(explanation.winnerScoreZScore),
        `winnerScoreZScore should be finite, got ${explanation.winnerScoreZScore}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('DDDDDDD-3: absent when all candidates have identical scores (stddev === 0)', async () => {
  const SAME_DESC = 'billing invoice payment charge query database';
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('d3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: SAME_DESC, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if (Math.abs(explanation.winnerScore - explanation.runnerUpScore) < 1e-9) {
      assert.ok(
        !('winnerScoreZScore' in explanation),
        `winnerScoreZScore should be absent when all scores equal (stddev=0), found: ${explanation.winnerScoreZScore}`,
      );
    }
    assert.ok(explanation.candidateCount >= 1, 'should have candidates');
  } finally {
    await agg.shutdown();
  }
});

test('DDDDDDD-4: identity — winnerScoreZScore * candidateScoreStdDev + candidateScoreMean === winnerScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('d4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreZScore' in explanation && 'candidateScoreStdDev' in explanation && 'candidateScoreMean' in explanation) {
      const reconstructed = explanation.winnerScoreZScore * explanation.candidateScoreStdDev + explanation.candidateScoreMean;
      assert.ok(
        Math.abs(reconstructed - explanation.winnerScore) < 1e-9,
        `winnerScoreZScore * stddev + mean (${reconstructed}) should equal winnerScore (${explanation.winnerScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('DDDDDDD-5: absent on cast:no_match', async () => {
  const path = dlqPath('d5');
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
      !('winnerScoreZScore' in parsed.explanation),
      `winnerScoreZScore should be absent on no_match, found: ${parsed.explanation.winnerScoreZScore}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('DDDDDDD-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('d6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('winnerScoreZScore' in explanation),
      `winnerScoreZScore should be absent with single candidate, found: ${explanation.winnerScoreZScore}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('DDDDDDD-7: present regardless of focus (focus inactive)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('d7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    if (explanation.candidateScoreStdDev > 0) {
      assert.ok('winnerScoreZScore' in explanation,
        `winnerScoreZScore should be present without focus when stddev > 0; keys: ${Object.keys(explanation).join(', ')}`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('DDDDDDD-8: tool description documents winnerScoreZScore', async () => {
  const path = dlqPath('d8');
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
      cast.description?.includes('winnerScoreZScore'),
      `cast description should mention winnerScoreZScore, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
