/**
 * SSSSSS: explanation.candidateGiniCoefficient in ch1tty/cast when explain:true.
 *
 * candidateGiniCoefficient: number — Gini coefficient of the full candidate pool
 * (all scored tools). G = (2·Σ(i+1)·s[i] / (n·totalScore)) − (n+1)/n, scores
 * sorted ascending (0-indexed i).
 *
 * Present when: >= 2 candidates and totalCandidateScore > 0.
 * Absent when: no_match, single candidate, or all scores are 0.
 * Always in [0, 1).
 * 0 = all candidates scored equally; approaches 1 = one tool monopolises scores.
 * When candidateCount <= 5: equals topCandidatesGiniCoefficient (same pool).
 *
 * Covered:
 *   SSSSSS-1: present when >= 2 candidates
 *   SSSSSS-2: always in [0, 1) when present
 *   SSSSSS-3: equals 0 when all candidates have equal scores
 *   SSSSSS-4: identity equals topCandidatesGiniCoefficient when candidateCount <= 5
 *   SSSSSS-5: absent on cast:no_match
 *   SSSSSS-6: absent when only 1 candidate
 *   SSSSSS-7: present regardless of focus (focus inactive)
 *   SSSSSS-8: tool description documents candidateGiniCoefficient
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-ssssss-${label}-${Date.now()}.jsonl`);
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

test('SSSSSS-1: present when >= 2 candidates', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('s1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    assert.ok('candidateGiniCoefficient' in explanation,
      `candidateGiniCoefficient should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.candidateGiniCoefficient, 'number', 'candidateGiniCoefficient should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('SSSSSS-2: always in [0, 1) when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('s2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('candidateGiniCoefficient' in explanation, 'candidateGiniCoefficient should be present');
    assert.ok(
      explanation.candidateGiniCoefficient >= -1e-9,
      `candidateGiniCoefficient should be >= 0, got ${explanation.candidateGiniCoefficient}`,
    );
    assert.ok(
      explanation.candidateGiniCoefficient < 1 + 1e-9,
      `candidateGiniCoefficient should be < 1, got ${explanation.candidateGiniCoefficient}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('SSSSSS-3: equals 0 when all candidates have equal scores', async () => {
  const SAME_DESC = 'billing invoice payment charge query database';
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('s3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: SAME_DESC, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('candidateGiniCoefficient' in explanation, 'candidateGiniCoefficient should be present');
    // When both tools get the same score, Gini = 0 (perfect equality)
    if (Math.abs(explanation.winnerScore - explanation.runnerUpScore) < 1e-9) {
      assert.ok(
        Math.abs(explanation.candidateGiniCoefficient) < 1e-9,
        `candidateGiniCoefficient should be 0 when scores are equal, got ${explanation.candidateGiniCoefficient}`,
      );
    }
    assert.ok(explanation.candidateGiniCoefficient >= -1e-9, 'Gini should be >= 0');
    assert.ok(explanation.candidateGiniCoefficient < 1 + 1e-9, 'Gini should be < 1');
  } finally {
    await agg.shutdown();
  }
});

test('SSSSSS-4: equals topCandidatesGiniCoefficient when candidateCount <= 5', async () => {
  // With only 2 candidates, full pool === top-5 pool, so both Ginis must agree.
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('s4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount <= 5, 'test requires candidateCount <= 5');
    assert.ok('candidateGiniCoefficient' in explanation, 'candidateGiniCoefficient should be present');
    assert.ok('topCandidatesGiniCoefficient' in explanation, 'topCandidatesGiniCoefficient should be present');
    assert.ok(
      Math.abs(explanation.candidateGiniCoefficient - explanation.topCandidatesGiniCoefficient) < 1e-9,
      `candidateGiniCoefficient (${explanation.candidateGiniCoefficient}) should equal topCandidatesGiniCoefficient (${explanation.topCandidatesGiniCoefficient}) when candidateCount <= 5`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('SSSSSS-5: absent on cast:no_match', async () => {
  const path = dlqPath('s5');
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
      !('candidateGiniCoefficient' in parsed.explanation),
      `candidateGiniCoefficient should be absent on no_match, found: ${parsed.explanation.candidateGiniCoefficient}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('SSSSSS-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('s6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateGiniCoefficient' in explanation),
      `candidateGiniCoefficient should be absent with single candidate, found: ${explanation.candidateGiniCoefficient}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('SSSSSS-7: present regardless of focus (focus inactive)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('s7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok('candidateGiniCoefficient' in explanation,
      `candidateGiniCoefficient should be present without focus; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('SSSSSS-8: tool description documents candidateGiniCoefficient', async () => {
  const path = dlqPath('s8');
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
      cast.description?.includes('candidateGiniCoefficient'),
      `cast description should mention candidateGiniCoefficient, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
