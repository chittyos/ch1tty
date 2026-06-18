/**
 * 04040404: explanation.winnerScoreToGeometricMeanRatio in ch1tty/cast when explain:true.
 *
 * winnerScoreToGeometricMeanRatio: number — ratio of winner score to full-pool geometric mean:
 * winnerScore / candidateScoreGeometricMean.
 *
 * Present when: >= 2 candidates and candidateScoreGeometricMean > 0 (all scores > 0).
 * Absent when: no_match, single candidate, any score === 0 (geometric mean requires all positive).
 * Always >= winnerScoreToMeanRatio (AM >= GM implies winner/gm >= winner/am).
 * Always >= 1 (winner >= geometric mean always).
 * Identity: winnerScoreToGeometricMeanRatio * candidateScoreGeometricMean === winnerScore.
 * For n=2: w / sqrt(w*r) = sqrt(w/r) = sqrt(winnerScoreRatio).
 *
 * Covered:
 *   04040404-1: present when >= 2 candidates and candidateScoreGeometricMean > 0
 *   04040404-2: >= 1 and finite when present
 *   04040404-3: >= winnerScoreToMeanRatio when both present (AM >= GM)
 *   04040404-4: for n=2 equals sqrt(winnerScoreRatio)
 *   04040404-5: absent on cast:no_match
 *   04040404-6: absent when only 1 candidate
 *   04040404-7: identity — winnerScoreToGeometricMeanRatio * candidateScoreGeometricMean === winnerScore
 *   04040404-8: tool description documents winnerScoreToGeometricMeanRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-04040404-${label}-${Date.now()}.jsonl`);
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

test('04040404-1: present when >= 2 candidates and candidateScoreGeometricMean > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ee1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('candidateScoreGeometricMean' in explanation && explanation.candidateScoreGeometricMean > 0) {
      assert.ok('winnerScoreToGeometricMeanRatio' in explanation,
        `winnerScoreToGeometricMeanRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.winnerScoreToGeometricMeanRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('04040404-2: >= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ee2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToGeometricMeanRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.winnerScoreToGeometricMeanRatio),
        `should be finite, got ${explanation.winnerScoreToGeometricMeanRatio}`,
      );
      assert.ok(
        explanation.winnerScoreToGeometricMeanRatio >= 1 - 1e-9,
        `should be >= 1 (winner >= geometric mean), got ${explanation.winnerScoreToGeometricMeanRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('04040404-3: >= winnerScoreToMeanRatio when both present (AM >= GM)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ee3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToGeometricMeanRatio' in explanation && 'winnerScoreToMeanRatio' in explanation) {
      assert.ok(
        explanation.winnerScoreToGeometricMeanRatio >= explanation.winnerScoreToMeanRatio - 1e-9,
        `winnerScoreToGeometricMeanRatio (${explanation.winnerScoreToGeometricMeanRatio}) should be >= winnerScoreToMeanRatio (${explanation.winnerScoreToMeanRatio}) since AM >= GM`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('04040404-4: for n=2 equals sqrt(winnerScoreRatio)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ee4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToGeometricMeanRatio' in explanation && explanation.candidateCount === 2 && 'winnerScoreRatio' in explanation) {
      const expected = Math.sqrt(explanation.winnerScoreRatio);
      assert.ok(
        Math.abs(explanation.winnerScoreToGeometricMeanRatio - expected) < 1e-9,
        `winnerScoreToGeometricMeanRatio (${explanation.winnerScoreToGeometricMeanRatio}) should equal sqrt(winnerScoreRatio) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('04040404-5: absent on cast:no_match', async () => {
  const path = dlqPath('ee5');
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
      !('winnerScoreToGeometricMeanRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.winnerScoreToGeometricMeanRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('04040404-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ee6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('winnerScoreToGeometricMeanRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.winnerScoreToGeometricMeanRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('04040404-7: identity — winnerScoreToGeometricMeanRatio * candidateScoreGeometricMean === winnerScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ee7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerScoreToGeometricMeanRatio' in explanation && 'candidateScoreGeometricMean' in explanation && 'winnerScore' in explanation) {
      const product = explanation.winnerScoreToGeometricMeanRatio * explanation.candidateScoreGeometricMean;
      assert.ok(
        Math.abs(product - explanation.winnerScore) < 1e-9,
        `winnerScoreToGeometricMeanRatio * candidateScoreGeometricMean (${product}) should equal winnerScore (${explanation.winnerScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('04040404-8: tool description documents winnerScoreToGeometricMeanRatio', async () => {
  const path = dlqPath('ee8');
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
      cast.description?.includes('winnerScoreToGeometricMeanRatio'),
      `cast description should mention winnerScoreToGeometricMeanRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
