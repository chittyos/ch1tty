/**
 * VVVVVV: explanation.candidateScoreVariance in ch1tty/cast when explain:true.
 *
 * candidateScoreVariance: number — variance of the full candidate pool.
 * variance = (1/n) * sum((x_i - mean)^2) over all scored tools.
 *
 * Present when: >= 2 candidates.
 * Absent when: no_match or single candidate.
 * Always >= 0; 0 when all candidates score identically.
 * When candidateCount <= 5: equals topCandidatesScoreVariance (same pool).
 *
 * Covered:
 *   VVVVVV-1: present when >= 2 candidates
 *   VVVVVV-2: always >= 0 when present
 *   VVVVVV-3: equals 0 when all candidates have identical scores
 *   VVVVVV-4: equals topCandidatesScoreVariance when candidateCount <= 5
 *   VVVVVV-5: absent on cast:no_match
 *   VVVVVV-6: absent when only 1 candidate
 *   VVVVVV-7: present regardless of focus (focus inactive)
 *   VVVVVV-8: tool description documents candidateScoreVariance
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-vvvvvv-${label}-${Date.now()}.jsonl`);
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

test('VVVVVV-1: present when >= 2 candidates', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('v1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    assert.ok('candidateScoreVariance' in explanation,
      `candidateScoreVariance should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.candidateScoreVariance, 'number', 'candidateScoreVariance should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('VVVVVV-2: always >= 0 when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('v2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('candidateScoreVariance' in explanation, 'candidateScoreVariance should be present');
    assert.ok(
      explanation.candidateScoreVariance >= -1e-9,
      `candidateScoreVariance should be >= 0, got ${explanation.candidateScoreVariance}`,
    );
    assert.ok(
      Number.isFinite(explanation.candidateScoreVariance),
      `candidateScoreVariance should be a finite number, got ${explanation.candidateScoreVariance}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('VVVVVV-3: equals 0 when all candidates have identical scores', async () => {
  const SAME_DESC = 'billing invoice payment charge query database';
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('v3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: SAME_DESC, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('candidateScoreVariance' in explanation, 'candidateScoreVariance should be present');
    if (Math.abs(explanation.winnerScore - explanation.runnerUpScore) < 1e-9) {
      assert.ok(
        Math.abs(explanation.candidateScoreVariance) < 1e-9,
        `candidateScoreVariance should be 0 when all scores equal, got ${explanation.candidateScoreVariance}`,
      );
    }
    assert.ok(explanation.candidateScoreVariance >= -1e-9, 'variance should be >= 0');
  } finally {
    await agg.shutdown();
  }
});

test('VVVVVV-4: equals topCandidatesScoreVariance when candidateCount <= 5', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('v4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount <= 5, 'test requires candidateCount <= 5');
    assert.ok('candidateScoreVariance' in explanation, 'candidateScoreVariance should be present');
    assert.ok('topCandidatesScoreVariance' in explanation, 'topCandidatesScoreVariance should be present');
    assert.ok(
      Math.abs(explanation.candidateScoreVariance - explanation.topCandidatesScoreVariance) < 1e-9,
      `candidateScoreVariance (${explanation.candidateScoreVariance}) should equal topCandidatesScoreVariance (${explanation.topCandidatesScoreVariance}) when candidateCount <= 5`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('VVVVVV-5: absent on cast:no_match', async () => {
  const path = dlqPath('v5');
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
      !('candidateScoreVariance' in parsed.explanation),
      `candidateScoreVariance should be absent on no_match, found: ${parsed.explanation.candidateScoreVariance}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('VVVVVV-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('v6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreVariance' in explanation),
      `candidateScoreVariance should be absent with single candidate, found: ${explanation.candidateScoreVariance}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('VVVVVV-7: present regardless of focus (focus inactive)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('v7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok('candidateScoreVariance' in explanation,
      `candidateScoreVariance should be present without focus; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('VVVVVV-8: tool description documents candidateScoreVariance', async () => {
  const path = dlqPath('v8');
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
      cast.description?.includes('candidateScoreVariance'),
      `cast description should mention candidateScoreVariance, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
