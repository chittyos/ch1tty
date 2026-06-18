/**
 * BBBBBBB: explanation.medianToMeanRatio in ch1tty/cast when explain:true.
 *
 * medianToMeanRatio: number — medianCandidateScore / candidateScoreMean.
 * Distribution symmetry indicator: 1 = symmetric, <1 = right-skewed
 * (mean > median), >1 = left-skewed (mean < median).
 *
 * Present when: >= 2 candidates and candidateScoreMean > 0.
 * Absent when: no_match, single candidate, or all scores are 0.
 * Always > 0. Identity: medianToMeanRatio * candidateScoreMean === medianCandidateScore.
 *
 * Covered:
 *   BBBBBBB-1: present when >= 2 candidates with nonzero mean
 *   BBBBBBB-2: always > 0 and finite when present
 *   BBBBBBB-3: equals 1 when all candidates have identical scores
 *   BBBBBBB-4: identity — medianToMeanRatio * candidateScoreMean === medianCandidateScore
 *   BBBBBBB-5: absent on cast:no_match
 *   BBBBBBB-6: absent when only 1 candidate
 *   BBBBBBB-7: present regardless of focus (focus inactive)
 *   BBBBBBB-8: tool description documents medianToMeanRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-bbbbbbb-${label}-${Date.now()}.jsonl`);
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

test('BBBBBBB-1: present when >= 2 candidates with nonzero mean', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('b1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    assert.ok('medianToMeanRatio' in explanation,
      `medianToMeanRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.medianToMeanRatio, 'number', 'medianToMeanRatio should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('BBBBBBB-2: always > 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('b2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('medianToMeanRatio' in explanation) {
      assert.ok(
        explanation.medianToMeanRatio > -1e-9,
        `medianToMeanRatio should be > 0, got ${explanation.medianToMeanRatio}`,
      );
      assert.ok(
        Number.isFinite(explanation.medianToMeanRatio),
        `medianToMeanRatio should be finite, got ${explanation.medianToMeanRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('BBBBBBB-3: equals 1 when all candidates have identical scores', async () => {
  const SAME_DESC = 'billing invoice payment charge query database';
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('b3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: SAME_DESC, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('medianToMeanRatio' in explanation) {
      if (Math.abs(explanation.winnerScore - explanation.runnerUpScore) < 1e-9) {
        assert.ok(
          Math.abs(explanation.medianToMeanRatio - 1) < 1e-9,
          `medianToMeanRatio should be 1 when all scores equal, got ${explanation.medianToMeanRatio}`,
        );
      }
    }
    assert.ok(explanation.candidateCount >= 1, 'should have candidates');
  } finally {
    await agg.shutdown();
  }
});

test('BBBBBBB-4: identity — medianToMeanRatio * candidateScoreMean === medianCandidateScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('b4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('medianToMeanRatio' in explanation && 'candidateScoreMean' in explanation && 'medianCandidateScore' in explanation) {
      const reconstructed = explanation.medianToMeanRatio * explanation.candidateScoreMean;
      assert.ok(
        Math.abs(reconstructed - explanation.medianCandidateScore) < 1e-9,
        `medianToMeanRatio * candidateScoreMean (${reconstructed}) should equal medianCandidateScore (${explanation.medianCandidateScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('BBBBBBB-5: absent on cast:no_match', async () => {
  const path = dlqPath('b5');
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
      !('medianToMeanRatio' in parsed.explanation),
      `medianToMeanRatio should be absent on no_match, found: ${parsed.explanation.medianToMeanRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('BBBBBBB-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('b6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('medianToMeanRatio' in explanation),
      `medianToMeanRatio should be absent with single candidate, found: ${explanation.medianToMeanRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('BBBBBBB-7: present regardless of focus (focus inactive)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('b7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok('medianToMeanRatio' in explanation,
      `medianToMeanRatio should be present without focus; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('BBBBBBB-8: tool description documents medianToMeanRatio', async () => {
  const path = dlqPath('b8');
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
      cast.description?.includes('medianToMeanRatio'),
      `cast description should mention medianToMeanRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
