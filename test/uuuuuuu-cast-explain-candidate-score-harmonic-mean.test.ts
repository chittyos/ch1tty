/**
 * UUUUUUU: explanation.candidateScoreHarmonicMean in ch1tty/cast when explain:true.
 *
 * candidateScoreHarmonicMean: number — harmonic mean of nonzero candidate scores.
 * nonZeroCount / sum(1/score). Completes the AM-GM-HM inequality.
 *
 * Present when: >= 2 candidates and candidateScoreEntropyTotal > 0.
 * Absent when: no_match, single candidate, or all scores zero.
 * Always > 0.
 * AM-GM-HM: candidateScoreHarmonicMean <= candidateScoreGeometricMean <= candidateScoreMean
 *   (when all scores nonzero; equality when all equal).
 *
 * Covered:
 *   UUUUUUU-1: present when >= 2 candidates with nonzero total
 *   UUUUUUU-2: always > 0 and finite when present
 *   UUUUUUU-3: equals candidateScoreMean when all scores identical (HM = AM at equality)
 *   UUUUUUU-4: always <= candidateScoreGeometricMean when all candidates have nonzero scores (HM-GM)
 *   UUUUUUU-5: absent on cast:no_match
 *   UUUUUUU-6: absent when only 1 candidate
 *   UUUUUUU-7: always <= candidateScoreMean when all candidates have nonzero scores (HM-AM)
 *   UUUUUUU-8: tool description documents candidateScoreHarmonicMean
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-uuuuuuu-${label}-${Date.now()}.jsonl`);
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

test('UUUUUUU-1: present when >= 2 candidates with nonzero total', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('u1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    assert.ok('candidateScoreHarmonicMean' in explanation,
      `candidateScoreHarmonicMean should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.candidateScoreHarmonicMean, 'number', 'candidateScoreHarmonicMean should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('UUUUUUU-2: always > 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('u2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreHarmonicMean' in explanation) {
      assert.ok(
        explanation.candidateScoreHarmonicMean > 0,
        `candidateScoreHarmonicMean should be > 0, got ${explanation.candidateScoreHarmonicMean}`,
      );
      assert.ok(
        Number.isFinite(explanation.candidateScoreHarmonicMean),
        `candidateScoreHarmonicMean should be finite, got ${explanation.candidateScoreHarmonicMean}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('UUUUUUU-3: equals candidateScoreMean when all candidates have identical scores', async () => {
  const SAME_DESC = 'billing invoice payment charge query database';
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('u3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: SAME_DESC, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreHarmonicMean' in explanation && 'candidateScoreMean' in explanation) {
      if (Math.abs(explanation.candidateScoreSpread) < 1e-9 && explanation.lowestCandidateScore > 0) {
        assert.ok(
          Math.abs(explanation.candidateScoreHarmonicMean - explanation.candidateScoreMean) < 1e-6,
          `harmonic mean (${explanation.candidateScoreHarmonicMean}) should equal arithmetic mean (${explanation.candidateScoreMean}) when all scores identical`,
        );
      }
    }
    assert.ok(explanation.candidateCount >= 1, 'should have candidates');
  } finally {
    await agg.shutdown();
  }
});

test('UUUUUUU-4: always <= candidateScoreGeometricMean when all candidates have nonzero scores', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('u4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if (
      'candidateScoreHarmonicMean' in explanation &&
      'candidateScoreGeometricMean' in explanation &&
      'nonZeroCandidateFraction' in explanation &&
      Math.abs(explanation.nonZeroCandidateFraction - 1) < 1e-9
    ) {
      assert.ok(
        explanation.candidateScoreHarmonicMean <= explanation.candidateScoreGeometricMean + 1e-9,
        `harmonic mean (${explanation.candidateScoreHarmonicMean}) should be <= geometric mean (${explanation.candidateScoreGeometricMean}) by HM-GM`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('UUUUUUU-5: absent on cast:no_match', async () => {
  const path = dlqPath('u5');
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
      !('candidateScoreHarmonicMean' in parsed.explanation),
      `candidateScoreHarmonicMean should be absent on no_match, found: ${parsed.explanation.candidateScoreHarmonicMean}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('UUUUUUU-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('u6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreHarmonicMean' in explanation),
      `candidateScoreHarmonicMean should be absent with single candidate, found: ${explanation.candidateScoreHarmonicMean}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('UUUUUUU-7: always <= candidateScoreMean when all candidates have nonzero scores', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('u7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if (
      'candidateScoreHarmonicMean' in explanation &&
      'candidateScoreMean' in explanation &&
      'nonZeroCandidateFraction' in explanation &&
      Math.abs(explanation.nonZeroCandidateFraction - 1) < 1e-9
    ) {
      assert.ok(
        explanation.candidateScoreHarmonicMean <= explanation.candidateScoreMean + 1e-9,
        `harmonic mean (${explanation.candidateScoreHarmonicMean}) should be <= arithmetic mean (${explanation.candidateScoreMean}) by HM-AM`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('UUUUUUU-8: tool description documents candidateScoreHarmonicMean', async () => {
  const path = dlqPath('u8');
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
      cast.description?.includes('candidateScoreHarmonicMean'),
      `cast description should mention candidateScoreHarmonicMean, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
