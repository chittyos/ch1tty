/**
 * IIIIIII: explanation.nonZeroCandidateFraction in ch1tty/cast when explain:true.
 *
 * nonZeroCandidateFraction: number — count(score > 0) / candidateCount.
 * Fraction of the full candidate pool with any keyword overlap with the intent.
 * Sparsity indicator: near 1 = dense match; near 1/n = only the winner matched.
 *
 * Present when: >= 2 candidates (winner always scores > 0 on a match).
 * Absent when: no_match or single candidate.
 * Always in (0, 1].
 *
 * Covered:
 *   IIIIIII-1: present when >= 2 candidates
 *   IIIIIII-2: always in (0, 1] and finite when present
 *   IIIIIII-3: equals 1 when all candidates score > 0
 *   IIIIIII-4: consistent with candidateCount (nonZeroCandidateFraction * candidateCount === nonZeroCount)
 *   IIIIIII-5: absent on cast:no_match
 *   IIIIIII-6: absent when only 1 candidate
 *   IIIIIII-7: present regardless of focus (focus inactive)
 *   IIIIIII-8: tool description documents nonZeroCandidateFraction
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-iiiiiii-${label}-${Date.now()}.jsonl`);
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

test('IIIIIII-1: present when >= 2 candidates', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('i1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    assert.ok('nonZeroCandidateFraction' in explanation,
      `nonZeroCandidateFraction should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.nonZeroCandidateFraction, 'number', 'nonZeroCandidateFraction should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('IIIIIII-2: always in (0, 1] and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('i2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('nonZeroCandidateFraction' in explanation) {
      assert.ok(
        explanation.nonZeroCandidateFraction > -1e-9,
        `nonZeroCandidateFraction should be > 0, got ${explanation.nonZeroCandidateFraction}`,
      );
      assert.ok(
        explanation.nonZeroCandidateFraction <= 1 + 1e-9,
        `nonZeroCandidateFraction should be <= 1, got ${explanation.nonZeroCandidateFraction}`,
      );
      assert.ok(
        Number.isFinite(explanation.nonZeroCandidateFraction),
        `nonZeroCandidateFraction should be finite, got ${explanation.nonZeroCandidateFraction}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('IIIIIII-3: equals 1 when all candidates score > 0', async () => {
  const SAME_DESC = 'billing invoice payment charge query database';
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('i3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: SAME_DESC, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('nonZeroCandidateFraction' in explanation && explanation.lowestCandidateScore > 0) {
      assert.ok(
        Math.abs(explanation.nonZeroCandidateFraction - 1) < 1e-9,
        `nonZeroCandidateFraction should be 1 when all scores > 0, got ${explanation.nonZeroCandidateFraction}`,
      );
    }
    assert.ok(explanation.candidateCount >= 1, 'should have candidates');
  } finally {
    await agg.shutdown();
  }
});

test('IIIIIII-4: consistent with candidateCount — nonZeroCandidateFraction * candidateCount is an integer', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('i4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('nonZeroCandidateFraction' in explanation) {
      const nonZeroCount = explanation.nonZeroCandidateFraction * explanation.candidateCount;
      assert.ok(
        Math.abs(nonZeroCount - Math.round(nonZeroCount)) < 1e-9,
        `nonZeroCandidateFraction * candidateCount (${nonZeroCount}) should be an integer`,
      );
      assert.ok(nonZeroCount >= 1, 'at least 1 candidate must score > 0 (the winner)');
    }
  } finally {
    await agg.shutdown();
  }
});

test('IIIIIII-5: absent on cast:no_match', async () => {
  const path = dlqPath('i5');
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
      !('nonZeroCandidateFraction' in parsed.explanation),
      `nonZeroCandidateFraction should be absent on no_match, found: ${parsed.explanation.nonZeroCandidateFraction}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('IIIIIII-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('i6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('nonZeroCandidateFraction' in explanation),
      `nonZeroCandidateFraction should be absent with single candidate, found: ${explanation.nonZeroCandidateFraction}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('IIIIIII-7: present regardless of focus (focus inactive)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('i7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok('nonZeroCandidateFraction' in explanation,
      `nonZeroCandidateFraction should be present without focus; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('IIIIIII-8: tool description documents nonZeroCandidateFraction', async () => {
  const path = dlqPath('i8');
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
      cast.description?.includes('nonZeroCandidateFraction'),
      `cast description should mention nonZeroCandidateFraction, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
