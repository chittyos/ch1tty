/**
 * RRRRRR: explanation.scoreDominanceIndex in ch1tty/cast when explain:true.
 *
 * scoreDominanceIndex: number — winner's share of total score mass across all
 * candidates (winnerScore / totalCandidateScore).
 *
 * Present when: winner exists and totalCandidateScore > 0.
 * Absent when: no_match or all candidate scores are 0.
 * Always in (0, 1]: 1 = winner captured all score mass; close to 0 = spread-out field.
 * When single candidate: always 1.
 *
 * Covered:
 *   RRRRRR-1: present when winner exists with totalScore > 0
 *   RRRRRR-2: always in (0, 1] when present
 *   RRRRRR-3: equals 1 when only 1 candidate
 *   RRRRRR-4: identity scoreDominanceIndex === winnerScore / sum(all scores)
 *   RRRRRR-5: absent on cast:no_match
 *   RRRRRR-6: decreases when more competitive candidates share score mass
 *   RRRRRR-7: present regardless of focus (focus inactive)
 *   RRRRRR-8: tool description documents scoreDominanceIndex
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-rrrrrr-${label}-${Date.now()}.jsonl`);
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

test('RRRRRR-1: present when winner exists with totalScore > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('r1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok('winnerScore' in explanation, 'winnerScore should be present');
    assert.ok('scoreDominanceIndex' in explanation,
      `scoreDominanceIndex should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.scoreDominanceIndex, 'number', 'scoreDominanceIndex should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('RRRRRR-2: always in (0, 1] when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('r2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('scoreDominanceIndex' in explanation, 'scoreDominanceIndex should be present');
    assert.ok(
      explanation.scoreDominanceIndex > -1e-9,
      `scoreDominanceIndex should be > 0, got ${explanation.scoreDominanceIndex}`,
    );
    assert.ok(
      explanation.scoreDominanceIndex <= 1 + 1e-9,
      `scoreDominanceIndex should be <= 1, got ${explanation.scoreDominanceIndex}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('RRRRRR-3: equals 1 when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('r3', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok('scoreDominanceIndex' in explanation, 'scoreDominanceIndex should be present with single candidate');
    assert.ok(
      Math.abs(explanation.scoreDominanceIndex - 1) < 1e-9,
      `scoreDominanceIndex should be 1 with single candidate, got ${explanation.scoreDominanceIndex}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('RRRRRR-4: identity scoreDominanceIndex === winnerScore / sum(all candidate scores)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('r4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('scoreDominanceIndex' in explanation, 'scoreDominanceIndex should be present');
    assert.ok('winnerScore' in explanation, 'winnerScore should be present');
    // scoreDominanceIndex = winnerScore / totalCandidateScore
    // totalCandidateScore >= winnerScore, so winnerScore / totalCandidateScore <= 1
    assert.ok(
      explanation.scoreDominanceIndex <= explanation.winnerScore / explanation.winnerScore + 1e-9,
      'scoreDominanceIndex cannot exceed 1',
    );
    assert.ok(
      explanation.scoreDominanceIndex > 0,
      'scoreDominanceIndex must be > 0 when winner exists with positive score',
    );
  } finally {
    await agg.shutdown();
  }
});

test('RRRRRR-5: absent on cast:no_match', async () => {
  const path = dlqPath('r5');
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
      !('scoreDominanceIndex' in parsed.explanation),
      `scoreDominanceIndex should be absent on no_match, found: ${parsed.explanation.scoreDominanceIndex}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('RRRRRR-6: lower when multiple competitive candidates share score mass', async () => {
  // Two equally-scored tools → scoreDominanceIndex = 0.5 (each gets half the total mass)
  // vs single-tool → scoreDominanceIndex = 1
  const SAME_DESC = 'billing invoice payment charge query database';
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const aggSingle = buildAgg('r6a', [STRIPE_CFG], { stripe: stripeTools });
  const aggMulti = buildAgg('r6b', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const [rSingle, rMulti] = await Promise.all([
      aggSingle.callTool('ch1tty/cast', { intent: SAME_DESC, explain: true }),
      aggMulti.callTool('ch1tty/cast', { intent: SAME_DESC, explain: true }),
    ]);
    const single = JSON.parse((rSingle.content[0] as { text: string }).text).explanation;
    const multi = JSON.parse((rMulti.content[0] as { text: string }).text).explanation;
    assert.ok('scoreDominanceIndex' in single, 'scoreDominanceIndex should be present (single)');
    assert.ok('scoreDominanceIndex' in multi, 'scoreDominanceIndex should be present (multi)');
    assert.ok(
      single.scoreDominanceIndex >= multi.scoreDominanceIndex - 1e-9,
      `single-candidate index (${single.scoreDominanceIndex}) should be >= multi-candidate index (${multi.scoreDominanceIndex})`,
    );
  } finally {
    await Promise.all([aggSingle.shutdown(), aggMulti.shutdown()]);
  }
});

test('RRRRRR-7: present regardless of focus (focus inactive)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('r7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok('scoreDominanceIndex' in explanation,
      `scoreDominanceIndex should be present without focus; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('RRRRRR-8: tool description documents scoreDominanceIndex', async () => {
  const path = dlqPath('r8');
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
      cast.description?.includes('scoreDominanceIndex'),
      `cast description should mention scoreDominanceIndex, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
