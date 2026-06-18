/**
 * ZZZZZZ: explanation.candidateScoreMeanRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreMeanRatio: number — candidateScoreMean / winnerScore.
 * Normalized measure of how far the average candidate is from the winner.
 *
 * Present when: >= 2 candidates and winnerScore > 0.
 * Absent when: no_match, single candidate, or winnerScore === 0.
 * Always in (0, 1]: 1 = all scores equal; near 0 = winner dominates.
 *
 * Covered:
 *   ZZZZZZ-1: present when >= 2 candidates
 *   ZZZZZZ-2: always in (0, 1] when present
 *   ZZZZZZ-3: equals 1 when all candidates have identical scores
 *   ZZZZZZ-4: identity — candidateScoreMeanRatio * winnerScore === candidateScoreMean
 *   ZZZZZZ-5: absent on cast:no_match
 *   ZZZZZZ-6: absent when only 1 candidate
 *   ZZZZZZ-7: present regardless of focus (focus inactive)
 *   ZZZZZZ-8: tool description documents candidateScoreMeanRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-zzzzzz-${label}-${Date.now()}.jsonl`);
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

test('ZZZZZZ-1: present when >= 2 candidates', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    assert.ok('candidateScoreMeanRatio' in explanation,
      `candidateScoreMeanRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.candidateScoreMeanRatio, 'number', 'candidateScoreMeanRatio should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZZZ-2: always in (0, 1] when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('candidateScoreMeanRatio' in explanation, 'candidateScoreMeanRatio should be present');
    assert.ok(
      explanation.candidateScoreMeanRatio > -1e-9,
      `candidateScoreMeanRatio should be > 0, got ${explanation.candidateScoreMeanRatio}`,
    );
    assert.ok(
      explanation.candidateScoreMeanRatio <= 1 + 1e-9,
      `candidateScoreMeanRatio should be <= 1, got ${explanation.candidateScoreMeanRatio}`,
    );
    assert.ok(
      Number.isFinite(explanation.candidateScoreMeanRatio),
      `candidateScoreMeanRatio should be finite, got ${explanation.candidateScoreMeanRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZZZ-3: equals 1 when all candidates have identical scores', async () => {
  const SAME_DESC = 'billing invoice payment charge query database';
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: SAME_DESC, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('candidateScoreMeanRatio' in explanation, 'candidateScoreMeanRatio should be present');
    if (Math.abs(explanation.winnerScore - explanation.runnerUpScore) < 1e-9) {
      assert.ok(
        Math.abs(explanation.candidateScoreMeanRatio - 1) < 1e-9,
        `candidateScoreMeanRatio should be 1 when all scores equal, got ${explanation.candidateScoreMeanRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZZZ-4: identity — candidateScoreMeanRatio * winnerScore === candidateScoreMean', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanRatio' in explanation) {
      const reconstructed = explanation.candidateScoreMeanRatio * explanation.winnerScore;
      assert.ok(
        Math.abs(reconstructed - explanation.candidateScoreMean) < 1e-9,
        `candidateScoreMeanRatio * winnerScore (${reconstructed}) should equal candidateScoreMean (${explanation.candidateScoreMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZZZ-5: absent on cast:no_match', async () => {
  const path = dlqPath('z5');
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
      !('candidateScoreMeanRatio' in parsed.explanation),
      `candidateScoreMeanRatio should be absent on no_match, found: ${parsed.explanation.candidateScoreMeanRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('ZZZZZZ-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreMeanRatio' in explanation),
      `candidateScoreMeanRatio should be absent with single candidate, found: ${explanation.candidateScoreMeanRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZZZ-7: present regardless of focus (focus inactive)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('z7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok('candidateScoreMeanRatio' in explanation,
      `candidateScoreMeanRatio should be present without focus; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('ZZZZZZ-8: tool description documents candidateScoreMeanRatio', async () => {
  const path = dlqPath('z8');
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
      cast.description?.includes('candidateScoreMeanRatio'),
      `cast description should mention candidateScoreMeanRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
