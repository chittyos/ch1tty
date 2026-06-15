/**
 * WWWWWW: explanation.candidateScoreStdDev in ch1tty/cast when explain:true.
 *
 * candidateScoreStdDev: number — standard deviation of the full candidate pool
 * (sqrt of candidateScoreVariance). Expressed in the same units as scores.
 *
 * Present when: >= 2 candidates.
 * Absent when: no_match or single candidate.
 * Always >= 0. Identity: candidateScoreStdDev^2 === candidateScoreVariance.
 * When candidateCount <= 5: equals topCandidatesScoreStdDev (same pool).
 *
 * Covered:
 *   WWWWWW-1: present when >= 2 candidates
 *   WWWWWW-2: always >= 0 and finite when present
 *   WWWWWW-3: equals 0 when all candidates have identical scores
 *   WWWWWW-4: identity — candidateScoreStdDev^2 === candidateScoreVariance
 *   WWWWWW-5: absent on cast:no_match
 *   WWWWWW-6: absent when only 1 candidate
 *   WWWWWW-7: equals topCandidatesScoreStdDev when candidateCount <= 5
 *   WWWWWW-8: tool description documents candidateScoreStdDev
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-wwwwww-${label}-${Date.now()}.jsonl`);
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

test('WWWWWW-1: present when >= 2 candidates', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    assert.ok('candidateScoreStdDev' in explanation,
      `candidateScoreStdDev should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.candidateScoreStdDev, 'number', 'candidateScoreStdDev should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('WWWWWW-2: always >= 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('candidateScoreStdDev' in explanation, 'candidateScoreStdDev should be present');
    assert.ok(
      explanation.candidateScoreStdDev >= -1e-9,
      `candidateScoreStdDev should be >= 0, got ${explanation.candidateScoreStdDev}`,
    );
    assert.ok(
      Number.isFinite(explanation.candidateScoreStdDev),
      `candidateScoreStdDev should be finite, got ${explanation.candidateScoreStdDev}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('WWWWWW-3: equals 0 when all candidates have identical scores', async () => {
  const SAME_DESC = 'billing invoice payment charge query database';
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: SAME_DESC, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('candidateScoreStdDev' in explanation, 'candidateScoreStdDev should be present');
    if (Math.abs(explanation.winnerScore - explanation.runnerUpScore) < 1e-9) {
      assert.ok(
        Math.abs(explanation.candidateScoreStdDev) < 1e-9,
        `candidateScoreStdDev should be 0 when all scores equal, got ${explanation.candidateScoreStdDev}`,
      );
    }
    assert.ok(explanation.candidateScoreStdDev >= -1e-9, 'stddev should be >= 0');
  } finally {
    await agg.shutdown();
  }
});

test('WWWWWW-4: identity — candidateScoreStdDev^2 === candidateScoreVariance', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('candidateScoreStdDev' in explanation, 'candidateScoreStdDev should be present');
    assert.ok('candidateScoreVariance' in explanation, 'candidateScoreVariance should be present');
    const reconstructed = explanation.candidateScoreStdDev ** 2;
    assert.ok(
      Math.abs(reconstructed - explanation.candidateScoreVariance) < 1e-9,
      `candidateScoreStdDev^2 (${reconstructed}) should equal candidateScoreVariance (${explanation.candidateScoreVariance})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('WWWWWW-5: absent on cast:no_match', async () => {
  const path = dlqPath('w5');
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
      !('candidateScoreStdDev' in parsed.explanation),
      `candidateScoreStdDev should be absent on no_match, found: ${parsed.explanation.candidateScoreStdDev}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('WWWWWW-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreStdDev' in explanation),
      `candidateScoreStdDev should be absent with single candidate, found: ${explanation.candidateScoreStdDev}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('WWWWWW-7: equals topCandidatesScoreStdDev when candidateCount <= 5', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('w7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount <= 5, 'test requires candidateCount <= 5');
    assert.ok('candidateScoreStdDev' in explanation, 'candidateScoreStdDev should be present');
    assert.ok('topCandidatesScoreStdDev' in explanation, 'topCandidatesScoreStdDev should be present');
    assert.ok(
      Math.abs(explanation.candidateScoreStdDev - explanation.topCandidatesScoreStdDev) < 1e-9,
      `candidateScoreStdDev (${explanation.candidateScoreStdDev}) should equal topCandidatesScoreStdDev (${explanation.topCandidatesScoreStdDev}) when candidateCount <= 5`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('WWWWWW-8: tool description documents candidateScoreStdDev', async () => {
  const path = dlqPath('w8');
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
      cast.description?.includes('candidateScoreStdDev'),
      `cast description should mention candidateScoreStdDev, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
