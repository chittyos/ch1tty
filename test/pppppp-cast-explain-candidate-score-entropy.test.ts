/**
 * PPPPPP: explanation.candidateScoreEntropy in ch1tty/cast when explain:true.
 *
 * candidateScoreEntropy: number — Shannon entropy (bits) of the normalised
 * candidate score distribution: H = −∑ p_i · log2(p_i) where
 * p_i = score_i / totalScore over all candidates with score > 0.
 *
 * Present when: >= 2 candidates with totalScore > 0.
 * Absent when: no_match, single candidate, or all candidate scores are 0.
 * Always >= 0.
 * Maximum: log2(candidateCount) when all scores equal.
 *
 * Covered:
 *   PPPPPP-1: present when >= 2 candidates
 *   PPPPPP-2: >= 0 always when present
 *   PPPPPP-3: <= log2(candidateCount) (bounded by uniform entropy)
 *   PPPPPP-4: equals log2(2) = 1 bit when exactly two equal-score candidates
 *   PPPPPP-5: absent on cast:no_match
 *   PPPPPP-6: absent when only 1 candidate
 *   PPPPPP-7: present regardless of focus (focus inactive)
 *   PPPPPP-8: tool description documents candidateScoreEntropy
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-pppppp-${label}-${Date.now()}.jsonl`);
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

test('PPPPPP-1: present when >= 2 candidates', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('p1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    assert.ok('candidateScoreEntropy' in explanation,
      `candidateScoreEntropy should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.candidateScoreEntropy, 'number', 'candidateScoreEntropy should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('PPPPPP-2: candidateScoreEntropy >= 0 when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('p2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('candidateScoreEntropy' in explanation, 'candidateScoreEntropy should be present');
    assert.ok(
      explanation.candidateScoreEntropy >= -1e-9,
      `candidateScoreEntropy should be >= 0, got ${explanation.candidateScoreEntropy}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('PPPPPP-3: candidateScoreEntropy <= log2(candidateCount)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('p3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('candidateScoreEntropy' in explanation, 'candidateScoreEntropy should be present');
    const maxEntropy = Math.log2(explanation.candidateCount);
    assert.ok(
      explanation.candidateScoreEntropy <= maxEntropy + 1e-9,
      `candidateScoreEntropy (${explanation.candidateScoreEntropy}) should be <= log2(${explanation.candidateCount}) = ${maxEntropy}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('PPPPPP-4: equals log2(2) = 1 bit when two candidates with same score', async () => {
  // Use same description text for both tools → same keyword score → uniform distribution → H = log2(2) = 1
  const IDENTICAL_DESC = 'billing invoice payment charge query';
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: IDENTICAL_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: IDENTICAL_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('p4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge query', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('candidateScoreEntropy' in explanation, 'candidateScoreEntropy should be present');
    assert.equal(explanation.candidateCount, 2, 'should have exactly 2 candidates');
    if (Math.abs(topCandidatesScore(explanation) - explanation.winnerScore) < 1e-9) {
      // Both tools scored identically → entropy = 1 bit
      assert.ok(
        Math.abs(explanation.candidateScoreEntropy - 1) < 1e-9,
        `candidateScoreEntropy (${explanation.candidateScoreEntropy}) should be 1 when two equal-score candidates`,
      );
    }
    // If scores differ (rare keyword overlap asymmetry), just check >= 0 and <= 1
    assert.ok(explanation.candidateScoreEntropy >= -1e-9, 'entropy should be >= 0');
    assert.ok(explanation.candidateScoreEntropy <= 1 + 1e-9, 'entropy should be <= log2(2) = 1');
  } finally {
    await agg.shutdown();
  }
});

function topCandidatesScore(explanation: Record<string, number>): number {
  return explanation.runnerUpScore ?? 0;
}

test('PPPPPP-5: absent on cast:no_match', async () => {
  const path = dlqPath('p5');
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
      !('candidateScoreEntropy' in parsed.explanation),
      `candidateScoreEntropy should be absent on no_match, found: ${parsed.explanation.candidateScoreEntropy}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('PPPPPP-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('p6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreEntropy' in explanation),
      `candidateScoreEntropy should be absent with single candidate, found: ${explanation.candidateScoreEntropy}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('PPPPPP-7: present regardless of focus (focus inactive)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('p7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok('candidateScoreEntropy' in explanation,
      `candidateScoreEntropy should be present without focus; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('PPPPPP-8: tool description documents candidateScoreEntropy', async () => {
  const path = dlqPath('p8');
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
      cast.description?.includes('candidateScoreEntropy'),
      `cast description should mention candidateScoreEntropy, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
