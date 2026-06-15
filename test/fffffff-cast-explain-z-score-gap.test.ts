/**
 * FFFFFFF: explanation.zScoreGap in ch1tty/cast when explain:true.
 *
 * zScoreGap: number — (winnerScore - runnerUpScore) / candidateScoreStdDev.
 * Equivalently: winnerScoreZScore - runnerUpScoreZScore.
 * Standardised top-2 margin — the score gap between winner and runner-up
 * expressed in units of full-pool spread.
 *
 * Present when: >= 2 candidates and candidateScoreStdDev > 0.
 * Absent when: no_match, single candidate, or all scores identical (stddev === 0).
 * Always >= 0 (winner >= runner-up).
 * Identity: zScoreGap = winnerScoreZScore - runnerUpScoreZScore.
 * Identity: zScoreGap * candidateScoreStdDev === winnerScore - runnerUpScore.
 *
 * Covered:
 *   FFFFFFF-1: present when >= 2 candidates with nonzero stddev
 *   FFFFFFF-2: always >= 0 and finite when present
 *   FFFFFFF-3: absent when all candidates have identical scores (stddev === 0)
 *   FFFFFFF-4: identity — zScoreGap = winnerScoreZScore - runnerUpScoreZScore
 *   FFFFFFF-5: absent on cast:no_match
 *   FFFFFFF-6: absent when only 1 candidate
 *   FFFFFFF-7: present regardless of focus (focus inactive)
 *   FFFFFFF-8: tool description documents zScoreGap
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-fffffff-${label}-${Date.now()}.jsonl`);
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

test('FFFFFFF-1: present when >= 2 candidates with nonzero stddev', async () => {
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
    if (explanation.candidateScoreStdDev > 0) {
      assert.ok('zScoreGap' in explanation,
        `zScoreGap should be present when stddev > 0; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.zScoreGap, 'number', 'zScoreGap should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('FFFFFFF-2: always >= 0 and finite when present', async () => {
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
    if ('zScoreGap' in explanation) {
      assert.ok(
        explanation.zScoreGap >= -1e-9,
        `zScoreGap should be >= 0, got ${explanation.zScoreGap}`,
      );
      assert.ok(
        Number.isFinite(explanation.zScoreGap),
        `zScoreGap should be finite, got ${explanation.zScoreGap}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('FFFFFFF-3: absent when all candidates have identical scores (stddev === 0)', async () => {
  const SAME_DESC = 'billing invoice payment charge query database';
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('f3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: SAME_DESC, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if (Math.abs(explanation.winnerScore - explanation.runnerUpScore) < 1e-9) {
      assert.ok(
        !('zScoreGap' in explanation),
        `zScoreGap should be absent when all scores equal (stddev=0), found: ${explanation.zScoreGap}`,
      );
    }
    assert.ok(explanation.candidateCount >= 1, 'should have candidates');
  } finally {
    await agg.shutdown();
  }
});

test('FFFFFFF-4: identity — zScoreGap === winnerScoreZScore - runnerUpScoreZScore', async () => {
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
    if ('zScoreGap' in explanation && 'winnerScoreZScore' in explanation && 'runnerUpScoreZScore' in explanation) {
      const fromZScores = explanation.winnerScoreZScore - explanation.runnerUpScoreZScore;
      assert.ok(
        Math.abs(explanation.zScoreGap - fromZScores) < 1e-9,
        `zScoreGap (${explanation.zScoreGap}) should equal winnerScoreZScore - runnerUpScoreZScore (${fromZScores})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('FFFFFFF-5: absent on cast:no_match', async () => {
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
      !('zScoreGap' in parsed.explanation),
      `zScoreGap should be absent on no_match, found: ${parsed.explanation.zScoreGap}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('FFFFFFF-6: absent when only 1 candidate', async () => {
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
      !('zScoreGap' in explanation),
      `zScoreGap should be absent with single candidate, found: ${explanation.zScoreGap}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('FFFFFFF-7: present regardless of focus (focus inactive)', async () => {
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
    assert.ok(!('focus' in explanation), 'no focus should be active');
    if (explanation.candidateScoreStdDev > 0) {
      assert.ok('zScoreGap' in explanation,
        `zScoreGap should be present without focus when stddev > 0; keys: ${Object.keys(explanation).join(', ')}`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('FFFFFFF-8: tool description documents zScoreGap', async () => {
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
      cast.description?.includes('zScoreGap'),
      `cast description should mention zScoreGap, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
