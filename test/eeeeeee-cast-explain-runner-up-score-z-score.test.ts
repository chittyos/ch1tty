/**
 * EEEEEEE: explanation.runnerUpScoreZScore in ch1tty/cast when explain:true.
 *
 * runnerUpScoreZScore: number — (runnerUpScore - candidateScoreMean) / candidateScoreStdDev.
 * How many standard deviations the runner-up sits above (or below) the full-pool mean.
 * Parallel to winnerScoreZScore for the second-ranked candidate.
 *
 * Present when: >= 2 candidates and candidateScoreStdDev > 0.
 * Absent when: no_match, single candidate, or all scores identical (stddev === 0).
 * Can be positive, zero, or negative (runner-up may be above or below the mean).
 * Always <= winnerScoreZScore.
 * Identity: runnerUpScoreZScore * candidateScoreStdDev + candidateScoreMean === runnerUpScore.
 *
 * Covered:
 *   EEEEEEE-1: present when >= 2 candidates with nonzero stddev
 *   EEEEEEE-2: is a finite number when present
 *   EEEEEEE-3: always <= winnerScoreZScore when both present
 *   EEEEEEE-4: identity — runnerUpScoreZScore * candidateScoreStdDev + candidateScoreMean === runnerUpScore
 *   EEEEEEE-5: absent on cast:no_match
 *   EEEEEEE-6: absent when only 1 candidate
 *   EEEEEEE-7: present regardless of focus (focus inactive)
 *   EEEEEEE-8: tool description documents runnerUpScoreZScore
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-eeeeeee-${label}-${Date.now()}.jsonl`);
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

test('EEEEEEE-1: present when >= 2 candidates with nonzero stddev', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('e1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if (explanation.candidateScoreStdDev > 0) {
      assert.ok('runnerUpScoreZScore' in explanation,
        `runnerUpScoreZScore should be present when stddev > 0; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.runnerUpScoreZScore, 'number', 'runnerUpScoreZScore should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('EEEEEEE-2: is a finite number when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('e2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreZScore' in explanation) {
      assert.ok(
        Number.isFinite(explanation.runnerUpScoreZScore),
        `runnerUpScoreZScore should be finite, got ${explanation.runnerUpScoreZScore}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('EEEEEEE-3: always <= winnerScoreZScore when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('e3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreZScore' in explanation && 'winnerScoreZScore' in explanation) {
      assert.ok(
        explanation.runnerUpScoreZScore <= explanation.winnerScoreZScore + 1e-9,
        `runnerUpScoreZScore (${explanation.runnerUpScoreZScore}) should be <= winnerScoreZScore (${explanation.winnerScoreZScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('EEEEEEE-4: identity — runnerUpScoreZScore * candidateScoreStdDev + candidateScoreMean === runnerUpScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('e4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('runnerUpScoreZScore' in explanation && 'candidateScoreStdDev' in explanation && 'candidateScoreMean' in explanation) {
      const reconstructed = explanation.runnerUpScoreZScore * explanation.candidateScoreStdDev + explanation.candidateScoreMean;
      assert.ok(
        Math.abs(reconstructed - explanation.runnerUpScore) < 1e-9,
        `runnerUpScoreZScore * stddev + mean (${reconstructed}) should equal runnerUpScore (${explanation.runnerUpScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('EEEEEEE-5: absent on cast:no_match', async () => {
  const path = dlqPath('e5');
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
      !('runnerUpScoreZScore' in parsed.explanation),
      `runnerUpScoreZScore should be absent on no_match, found: ${parsed.explanation.runnerUpScoreZScore}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('EEEEEEE-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('e6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('runnerUpScoreZScore' in explanation),
      `runnerUpScoreZScore should be absent with single candidate, found: ${explanation.runnerUpScoreZScore}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('EEEEEEE-7: present regardless of focus (focus inactive)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('e7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    if (explanation.candidateScoreStdDev > 0) {
      assert.ok('runnerUpScoreZScore' in explanation,
        `runnerUpScoreZScore should be present without focus when stddev > 0; keys: ${Object.keys(explanation).join(', ')}`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('EEEEEEE-8: tool description documents runnerUpScoreZScore', async () => {
  const path = dlqPath('e8');
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
      cast.description?.includes('runnerUpScoreZScore'),
      `cast description should mention runnerUpScoreZScore, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
