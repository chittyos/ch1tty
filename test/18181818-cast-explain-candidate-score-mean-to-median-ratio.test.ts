/**
 * 18181818: explanation.candidateScoreMeanToMedianRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreMeanToMedianRatio: number — ratio of arithmetic mean to median:
 * candidateScoreMean / medianCandidateScore.
 *
 * Present when: >= 2 candidates, medianCandidateScore > 0, and candidateScoreEntropyTotal > 0.
 * Absent when: no_match, single candidate, medianCandidateScore === 0, or all scores === 0.
 * No fixed bound relative to 1 (mean vs median depends on skew).
 * Exact inverse of medianToMeanRatio: product === 1.
 * For n=2: median === AM, so ratio === 1 always.
 * Identity: candidateScoreMeanToMedianRatio * medianCandidateScore === candidateScoreMean.
 *
 * Covered:
 *   18181818-1: present when >= 2 candidates, medianCandidateScore > 0, and mean > 0
 *   18181818-2: > 0 and finite when present
 *   18181818-3: inverse of medianToMeanRatio — product === 1 when both present
 *   18181818-4: for n=2 equals 1
 *   18181818-5: absent on cast:no_match
 *   18181818-6: absent when only 1 candidate
 *   18181818-7: identity — candidateScoreMeanToMedianRatio * medianCandidateScore === candidateScoreMean
 *   18181818-8: tool description documents candidateScoreMeanToMedianRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-18181818-${label}-${Date.now()}.jsonl`);
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

test('18181818-1: present when >= 2 candidates, medianCandidateScore > 0, and mean > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ss1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if ('medianCandidateScore' in explanation && explanation.medianCandidateScore > 0 &&
        'candidateScoreMean' in explanation && explanation.candidateScoreMean > 0) {
      assert.ok('candidateScoreMeanToMedianRatio' in explanation,
        `candidateScoreMeanToMedianRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreMeanToMedianRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('18181818-2: > 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ss2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToMedianRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreMeanToMedianRatio),
        `should be finite, got ${explanation.candidateScoreMeanToMedianRatio}`,
      );
      assert.ok(
        explanation.candidateScoreMeanToMedianRatio > 0,
        `should be > 0, got ${explanation.candidateScoreMeanToMedianRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('18181818-3: inverse of medianToMeanRatio — product === 1 when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ss3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToMedianRatio' in explanation && 'medianToMeanRatio' in explanation) {
      const product = explanation.candidateScoreMeanToMedianRatio * explanation.medianToMeanRatio;
      assert.ok(
        Math.abs(product - 1) < 1e-9,
        `candidateScoreMeanToMedianRatio * medianToMeanRatio (${product}) should equal 1`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('18181818-4: for n=2 equals 1', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ss4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToMedianRatio' in explanation && explanation.candidateCount === 2) {
      assert.ok(
        Math.abs(explanation.candidateScoreMeanToMedianRatio - 1) < 1e-9,
        `for n=2, candidateScoreMeanToMedianRatio (${explanation.candidateScoreMeanToMedianRatio}) should equal 1`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('18181818-5: absent on cast:no_match', async () => {
  const path = dlqPath('ss5');
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
      !('candidateScoreMeanToMedianRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.candidateScoreMeanToMedianRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('18181818-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ss6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreMeanToMedianRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.candidateScoreMeanToMedianRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('18181818-7: identity — candidateScoreMeanToMedianRatio * medianCandidateScore === candidateScoreMean', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('ss7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMeanToMedianRatio' in explanation && 'medianCandidateScore' in explanation && 'candidateScoreMean' in explanation) {
      const product = explanation.candidateScoreMeanToMedianRatio * explanation.medianCandidateScore;
      assert.ok(
        Math.abs(product - explanation.candidateScoreMean) < 1e-9,
        `candidateScoreMeanToMedianRatio * medianCandidateScore (${product}) should equal candidateScoreMean (${explanation.candidateScoreMean})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('18181818-8: tool description documents candidateScoreMeanToMedianRatio', async () => {
  const path = dlqPath('ss8');
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
      cast.description?.includes('candidateScoreMeanToMedianRatio'),
      `cast description should mention candidateScoreMeanToMedianRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
