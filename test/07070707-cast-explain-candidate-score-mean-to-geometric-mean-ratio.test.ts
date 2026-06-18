/**
 * 07070707: explanation.candidateScoreMeanToGeometricMeanRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreMeanToGeometricMeanRatio: number — ratio of arithmetic mean to geometric mean:
 * candidateScoreMean / candidateScoreGeometricMean.
 *
 * Present when: >= 2 candidates and candidateScoreGeometricMean > 0 (all scores > 0).
 * Absent when: no_match, single candidate, any score === 0.
 * Always >= 1 by AM-GM inequality.
 * Exact inverse of candidateScoreGeometricMeanToMeanRatio: product === 1.
 * Identity: candidateScoreMeanToGeometricMeanRatio * candidateScoreGeometricMean === candidateScoreMean.
 * For n=2: (w+r) / (2*sqrt(w*r)).
 *
 * Covered:
 *   07070707-1: present when >= 2 candidates and candidateScoreGeometricMean > 0
 *   07070707-2: >= 1 and finite when present
 *   07070707-3: inverse of candidateScoreGeometricMeanToMeanRatio — product === 1 when both present
 *   07070707-4: for n=2 equals (w+r)/(2*sqrt(w*r))
 *   07070707-5: absent on cast:no_match
 *   07070707-6: absent when only 1 candidate
 *   07070707-7: identity — candidateScoreMeanToGeometricMeanRatio * candidateScoreGeometricMean === candidateScoreMean
 *   07070707-8: tool description documents candidateScoreMeanToGeometricMeanRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-07070707-${label}-${Date.now()}.jsonl`);
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

test('07070707-1: present when >= 2 candidates and candidateScoreGeometricMean > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('hh1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreGeometricMean' in explanation && explanation.candidateScoreGeometricMean > 0) {
      assert.ok('candidateScoreMeanToGeometricMeanRatio' in explanation,
        `candidateScoreMeanToGeometricMeanRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreMeanToGeometricMeanRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('07070707-2: >= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('hh2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToGeometricMeanRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreMeanToGeometricMeanRatio),
        `should be finite, got ${explanation.candidateScoreMeanToGeometricMeanRatio}`,
      );
      assert.ok(
        explanation.candidateScoreMeanToGeometricMeanRatio >= 1 - 1e-9,
        `should be >= 1 (AM >= GM), got ${explanation.candidateScoreMeanToGeometricMeanRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('07070707-3: inverse of candidateScoreGeometricMeanToMeanRatio — product === 1 when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('hh3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToGeometricMeanRatio' in explanation && 'candidateScoreGeometricMeanToMeanRatio' in explanation) {
      const product = explanation.candidateScoreMeanToGeometricMeanRatio * explanation.candidateScoreGeometricMeanToMeanRatio;
      assert.ok(
        Math.abs(product - 1) < 1e-9,
        `candidateScoreMeanToGeometricMeanRatio * candidateScoreGeometricMeanToMeanRatio (${product}) should equal 1`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('07070707-4: for n=2 equals (w+r)/(2*sqrt(w*r))', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('hh4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToGeometricMeanRatio' in explanation && explanation.candidateCount === 2) {
      const w = explanation.winnerScore;
      const ru = explanation.runnerUpScore;
      const expected = (w + ru) / (2 * Math.sqrt(w * ru));
      assert.ok(
        Math.abs(explanation.candidateScoreMeanToGeometricMeanRatio - expected) < 1e-9,
        `candidateScoreMeanToGeometricMeanRatio (${explanation.candidateScoreMeanToGeometricMeanRatio}) should equal (w+r)/(2*sqrt(w*r)) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('07070707-5: absent on cast:no_match', async () => {
  const path = dlqPath('hh5');
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
      !('candidateScoreMeanToGeometricMeanRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.candidateScoreMeanToGeometricMeanRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('07070707-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('hh6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreMeanToGeometricMeanRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.candidateScoreMeanToGeometricMeanRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('07070707-7: identity — candidateScoreMeanToGeometricMeanRatio * candidateScoreGeometricMean === candidateScoreMean', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('hh7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToGeometricMeanRatio' in explanation && 'candidateScoreGeometricMean' in explanation && 'candidateScoreMean' in explanation) {
      const product = explanation.candidateScoreMeanToGeometricMeanRatio * explanation.candidateScoreGeometricMean;
      assert.ok(
        Math.abs(product - explanation.candidateScoreMean) < 1e-9,
        `candidateScoreMeanToGeometricMeanRatio * candidateScoreGeometricMean (${product}) should equal candidateScoreMean (${explanation.candidateScoreMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('07070707-8: tool description documents candidateScoreMeanToGeometricMeanRatio', async () => {
  const path = dlqPath('hh8');
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
      cast.description?.includes('candidateScoreMeanToGeometricMeanRatio'),
      `cast description should mention candidateScoreMeanToGeometricMeanRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
