/**
 * 03030303: explanation.candidateScoreMedianToWinnerRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreMedianToWinnerRatio: number — ratio of full-pool median to winner score:
 * medianCandidateScore / winnerScore.
 *
 * Present when: >= 2 candidates and winnerScore > 0.
 * Absent when: no_match, single candidate, or winnerScore === 0.
 * Exact inverse of winnerToMedianRatio: product === 1.
 * Always in (0, 1]: median <= winner always.
 * Identity: candidateScoreMedianToWinnerRatio * winnerScore === medianCandidateScore.
 * For n=2: (w + r) / (2 * w).
 *
 * Covered:
 *   03030303-1: present when >= 2 candidates and winnerScore > 0
 *   03030303-2: in (0, 1] and finite when present
 *   03030303-3: inverse of winnerToMedianRatio — product === 1 when both present
 *   03030303-4: for n=2 equals (w + r) / (2 * w)
 *   03030303-5: absent on cast:no_match
 *   03030303-6: absent when only 1 candidate
 *   03030303-7: identity — candidateScoreMedianToWinnerRatio * winnerScore === medianCandidateScore
 *   03030303-8: tool description documents candidateScoreMedianToWinnerRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-03030303-${label}-${Date.now()}.jsonl`);
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

test('03030303-1: present when >= 2 candidates and winnerScore > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('dd1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if (explanation.winnerScore > 0) {
      assert.ok('candidateScoreMedianToWinnerRatio' in explanation,
        `candidateScoreMedianToWinnerRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreMedianToWinnerRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('03030303-2: in (0, 1] and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('dd2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMedianToWinnerRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreMedianToWinnerRatio),
        `should be finite, got ${explanation.candidateScoreMedianToWinnerRatio}`,
      );
      assert.ok(
        explanation.candidateScoreMedianToWinnerRatio > 0,
        `should be > 0, got ${explanation.candidateScoreMedianToWinnerRatio}`,
      );
      assert.ok(
        explanation.candidateScoreMedianToWinnerRatio <= 1 + 1e-9,
        `should be <= 1 (median <= winner), got ${explanation.candidateScoreMedianToWinnerRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('03030303-3: inverse of winnerToMedianRatio — product === 1 when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('dd3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMedianToWinnerRatio' in explanation && 'winnerToMedianRatio' in explanation) {
      const product = explanation.candidateScoreMedianToWinnerRatio * explanation.winnerToMedianRatio;
      assert.ok(
        Math.abs(product - 1) < 1e-9,
        `candidateScoreMedianToWinnerRatio * winnerToMedianRatio (${product}) should equal 1`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('03030303-4: for n=2 equals (w + r) / (2 * w)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('dd4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMedianToWinnerRatio' in explanation && explanation.candidateCount === 2 && explanation.winnerScore > 0) {
      const w = explanation.winnerScore;
      const ru = explanation.runnerUpScore;
      const expected = (w + ru) / (2 * w);
      assert.ok(
        Math.abs(explanation.candidateScoreMedianToWinnerRatio - expected) < 1e-9,
        `candidateScoreMedianToWinnerRatio (${explanation.candidateScoreMedianToWinnerRatio}) should equal (w+r)/(2w) (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('03030303-5: absent on cast:no_match', async () => {
  const path = dlqPath('dd5');
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
      !('candidateScoreMedianToWinnerRatio' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.candidateScoreMedianToWinnerRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('03030303-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('dd6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreMedianToWinnerRatio' in explanation),
      `should be absent with single candidate, found: ${explanation.candidateScoreMedianToWinnerRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('03030303-7: identity — candidateScoreMedianToWinnerRatio * winnerScore === medianCandidateScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('dd7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreMedianToWinnerRatio' in explanation && 'medianCandidateScore' in explanation && 'winnerScore' in explanation) {
      const product = explanation.candidateScoreMedianToWinnerRatio * explanation.winnerScore;
      assert.ok(
        Math.abs(product - explanation.medianCandidateScore) < 1e-9,
        `candidateScoreMedianToWinnerRatio * winnerScore (${product}) should equal medianCandidateScore (${explanation.medianCandidateScore})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('03030303-8: tool description documents candidateScoreMedianToWinnerRatio', async () => {
  const path = dlqPath('dd8');
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
      cast.description?.includes('candidateScoreMedianToWinnerRatio'),
      `cast description should mention candidateScoreMedianToWinnerRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
