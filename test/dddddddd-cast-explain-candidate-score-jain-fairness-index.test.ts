/**
 * DDDDDDDD: explanation.candidateScoreJainFairnessIndex in ch1tty/cast when explain:true.
 *
 * candidateScoreJainFairnessIndex: number — Jain's fairness index:
 * (sum_i score_i)^2 / (n * sum_i score_i^2).
 *
 * Present when: >= 2 candidates and at least one nonzero score.
 * Absent when: no_match, single candidate, or all scores zero.
 * Always in (0, 1].
 * Equals 1 when all scores identical.
 * Identity: === 1 / (n * candidateScoreHerfindahlIndex) when both present.
 * For n=2: (w+r)^2 / (2*(w^2+r^2)); >= 0.5 always.
 *
 * Covered:
 *   DDDDDDDD-1: present when >= 2 candidates with nonzero scores
 *   DDDDDDDD-2: always in (0, 1] and finite
 *   DDDDDDDD-3: equals 1 when all scores identical
 *   DDDDDDDD-4: identity — equals 1 / (n * candidateScoreHerfindahlIndex)
 *   DDDDDDDD-5: absent on cast:no_match
 *   DDDDDDDD-6: absent when only 1 candidate
 *   DDDDDDDD-7: for n=2 always >= 0.5
 *   DDDDDDDD-8: tool description documents candidateScoreJainFairnessIndex
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-dddddddd-${label}-${Date.now()}.jsonl`);
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

test('DDDDDDDD-1: present when >= 2 candidates with nonzero scores', async () => {
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
    assert.ok('candidateScoreJainFairnessIndex' in explanation,
      `candidateScoreJainFairnessIndex should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.candidateScoreJainFairnessIndex, 'number', 'candidateScoreJainFairnessIndex should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('DDDDDDDD-2: always in (0, 1] and finite', async () => {
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
    if ('candidateScoreJainFairnessIndex' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreJainFairnessIndex),
        `candidateScoreJainFairnessIndex should be finite, got ${explanation.candidateScoreJainFairnessIndex}`,
      );
      assert.ok(
        explanation.candidateScoreJainFairnessIndex > 0,
        `candidateScoreJainFairnessIndex should be > 0, got ${explanation.candidateScoreJainFairnessIndex}`,
      );
      assert.ok(
        explanation.candidateScoreJainFairnessIndex <= 1 + 1e-9,
        `candidateScoreJainFairnessIndex (${explanation.candidateScoreJainFairnessIndex}) should be <= 1`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('DDDDDDDD-3: equals 1 when all scores identical', async () => {
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
    if ('candidateScoreJainFairnessIndex' in explanation && 'candidateScoreSpread' in explanation) {
      if (Math.abs(explanation.candidateScoreSpread) < 1e-9) {
        assert.ok(
          Math.abs(explanation.candidateScoreJainFairnessIndex - 1) < 1e-9,
          `candidateScoreJainFairnessIndex (${explanation.candidateScoreJainFairnessIndex}) should be 1 when all scores identical`,
        );
      }
    }
    assert.ok(explanation.candidateCount >= 1, 'should have candidates');
  } finally {
    await agg.shutdown();
  }
});

test('DDDDDDDD-4: identity — equals 1 / (n * candidateScoreHerfindahlIndex)', async () => {
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
    if (
      'candidateScoreJainFairnessIndex' in explanation &&
      'candidateScoreHerfindahlIndex' in explanation &&
      explanation.candidateScoreHerfindahlIndex > 0
    ) {
      const expected = 1 / (explanation.candidateCount * explanation.candidateScoreHerfindahlIndex);
      assert.ok(
        Math.abs(explanation.candidateScoreJainFairnessIndex - expected) < 1e-9,
        `candidateScoreJainFairnessIndex (${explanation.candidateScoreJainFairnessIndex}) should equal 1/(n*HHI) (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('DDDDDDDD-5: absent on cast:no_match', async () => {
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
      !('candidateScoreJainFairnessIndex' in parsed.explanation),
      `candidateScoreJainFairnessIndex should be absent on no_match, found: ${parsed.explanation.candidateScoreJainFairnessIndex}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('DDDDDDDD-6: absent when only 1 candidate', async () => {
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
      !('candidateScoreJainFairnessIndex' in explanation),
      `candidateScoreJainFairnessIndex should be absent with single candidate, found: ${explanation.candidateScoreJainFairnessIndex}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('DDDDDDDD-7: for n=2 always >= 0.5', async () => {
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
    if ('candidateScoreJainFairnessIndex' in explanation && explanation.candidateCount === 2) {
      assert.ok(
        explanation.candidateScoreJainFairnessIndex >= 0.5 - 1e-9,
        `candidateScoreJainFairnessIndex (${explanation.candidateScoreJainFairnessIndex}) should be >= 0.5 for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('DDDDDDDD-8: tool description documents candidateScoreJainFairnessIndex', async () => {
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
      cast.description?.includes('candidateScoreJainFairnessIndex'),
      `cast description should mention candidateScoreJainFairnessIndex, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
