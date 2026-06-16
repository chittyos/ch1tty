/**
 * LLLLLLL: explanation.effectiveN in ch1tty/cast when explain:true.
 *
 * effectiveN: number — 1 / candidateScoreHerfindahlIndex.
 * Effective number of candidates (Hill number / inverse HHI).
 * The number of equally-scoring candidates that would produce the same HHI.
 *
 * Present when: same as candidateScoreHerfindahlIndex (>= 2 candidates, totalScore > 0).
 * Absent when: no_match, single candidate, or all scores are 0.
 * Always in [1, candidateCount].
 * Identity: effectiveN * candidateScoreHerfindahlIndex === 1.
 *
 * Covered:
 *   LLLLLLL-1: present when >= 2 candidates with nonzero total score
 *   LLLLLLL-2: always in [1, candidateCount] and finite when present
 *   LLLLLLL-3: equals candidateCount when all candidates have identical scores
 *   LLLLLLL-4: identity — effectiveN * candidateScoreHerfindahlIndex === 1
 *   LLLLLLL-5: absent on cast:no_match
 *   LLLLLLL-6: absent when only 1 candidate
 *   LLLLLLL-7: present regardless of focus (focus inactive)
 *   LLLLLLL-8: tool description documents effectiveN
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-lllllll-${label}-${Date.now()}.jsonl`);
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

test('LLLLLLL-1: present when >= 2 candidates with nonzero total score', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('l1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    assert.ok('effectiveN' in explanation,
      `effectiveN should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.effectiveN, 'number', 'effectiveN should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('LLLLLLL-2: always in [1, candidateCount] and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('l2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('effectiveN' in explanation) {
      assert.ok(
        explanation.effectiveN >= 1 - 1e-9,
        `effectiveN should be >= 1, got ${explanation.effectiveN}`,
      );
      assert.ok(
        explanation.effectiveN <= explanation.candidateCount + 1e-9,
        `effectiveN should be <= candidateCount (${explanation.candidateCount}), got ${explanation.effectiveN}`,
      );
      assert.ok(
        Number.isFinite(explanation.effectiveN),
        `effectiveN should be finite, got ${explanation.effectiveN}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('LLLLLLL-3: equals candidateCount when all candidates have identical scores', async () => {
  const SAME_DESC = 'billing invoice payment charge query database';
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('l3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: SAME_DESC, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('effectiveN' in explanation) {
      if (Math.abs(explanation.winnerScore - explanation.runnerUpScore) < 1e-9) {
        assert.ok(
          Math.abs(explanation.effectiveN - explanation.candidateCount) < 1e-9,
          `effectiveN should equal candidateCount (${explanation.candidateCount}) when all scores equal, got ${explanation.effectiveN}`,
        );
      }
    }
    assert.ok(explanation.candidateCount >= 1, 'should have candidates');
  } finally {
    await agg.shutdown();
  }
});

test('LLLLLLL-4: identity — effectiveN * candidateScoreHerfindahlIndex === 1', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('l4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('effectiveN' in explanation && 'candidateScoreHerfindahlIndex' in explanation) {
      const product = explanation.effectiveN * explanation.candidateScoreHerfindahlIndex;
      assert.ok(
        Math.abs(product - 1) < 1e-9,
        `effectiveN * candidateScoreHerfindahlIndex (${product}) should equal 1`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('LLLLLLL-5: absent on cast:no_match', async () => {
  const path = dlqPath('l5');
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
      !('effectiveN' in parsed.explanation),
      `effectiveN should be absent on no_match, found: ${parsed.explanation.effectiveN}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('LLLLLLL-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('l6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('effectiveN' in explanation),
      `effectiveN should be absent with single candidate, found: ${explanation.effectiveN}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('LLLLLLL-7: present regardless of focus (focus inactive)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('l7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok('effectiveN' in explanation,
      `effectiveN should be present without focus; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('LLLLLLL-8: tool description documents effectiveN', async () => {
  const path = dlqPath('l8');
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
      cast.description?.includes('effectiveN'),
      `cast description should mention effectiveN, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
