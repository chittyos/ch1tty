/**
 * 45454545: explanation.candidateScoreNonWinnerCoefficientOfVariation in ch1tty/cast when explain:true.
 *
 * candidateScoreNonWinnerCoefficientOfVariation: number — CV of the non-winner pool:
 * candidateScoreNonWinnerStdDev / candidateScoreNonWinnerMean.
 *
 * Present when: >= 3 candidates and candidateScoreNonWinnerMean > 0.
 * Absent when: no_match, < 3 candidates, or all non-winner scores are zero.
 * Always >= 0.
 * For n=3: equals runnerUpThirdGap / (2 * candidateScoreNonWinnerMean).
 * Identity: candidateScoreNonWinnerCoefficientOfVariation * candidateScoreNonWinnerMean === candidateScoreNonWinnerStdDev.
 *
 * Covered:
 *   45454545-1: present when >= 3 candidates and nonWinnerMean > 0
 *   45454545-2: always finite and >= 0 when present
 *   45454545-3: identity — CV * nonWinnerMean === nonWinnerStdDev
 *   45454545-4: for n=3 equals runnerUpThirdGap / (2 * nonWinnerMean)
 *   45454545-5: absent on cast:no_match
 *   45454545-6: absent when fewer than 3 candidates
 *   45454545-7: candidateScoreNonWinnerStdDev also present and >= 0 when CV present
 *   45454545-8: tool description documents candidateScoreNonWinnerCoefficientOfVariation
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-45454545-${label}-${Date.now()}.jsonl`);
}

const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe Payments', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.test/mcp',
};
const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.test/mcp',
};
const LINEAR_CFG: ServerConfig = {
  id: 'linear', name: 'Linear', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://linear.test/mcp',
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

const stripeTools: ToolEntry[] = [
  { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
];
const neonTools: ToolEntry[] = [
  { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
];
const linearTools: ToolEntry[] = [
  { name: 'create_issue', description: 'billing issue tracking project', inputSchema: { type: 'object', properties: {} } },
];

test('45454545-1: present when >= 3 candidates and nonWinnerMean > 0', async () => {
  const agg = buildAgg('ttt1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3 && explanation.candidateScoreNonWinnerMean > 0) {
      assert.ok('candidateScoreNonWinnerCoefficientOfVariation' in explanation,
        `candidateScoreNonWinnerCoefficientOfVariation should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreNonWinnerCoefficientOfVariation, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('45454545-2: always finite and >= 0 when present', async () => {
  const agg = buildAgg('ttt2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerCoefficientOfVariation' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreNonWinnerCoefficientOfVariation),
        `should be finite, got ${explanation.candidateScoreNonWinnerCoefficientOfVariation}`,
      );
      assert.ok(
        explanation.candidateScoreNonWinnerCoefficientOfVariation >= 0,
        `should be >= 0, got ${explanation.candidateScoreNonWinnerCoefficientOfVariation}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('45454545-3: identity — CV * nonWinnerMean === nonWinnerStdDev', async () => {
  const agg = buildAgg('ttt3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerCoefficientOfVariation' in explanation &&
        'candidateScoreNonWinnerMean' in explanation &&
        'candidateScoreNonWinnerStdDev' in explanation) {
      const product = explanation.candidateScoreNonWinnerCoefficientOfVariation * explanation.candidateScoreNonWinnerMean;
      const expected = explanation.candidateScoreNonWinnerStdDev;
      assert.ok(
        Math.abs(product - expected) < 1e-9,
        `CV * nonWinnerMean (${product}) should equal nonWinnerStdDev (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('45454545-4: for n=3 equals runnerUpThirdGap / (2 * nonWinnerMean)', async () => {
  const agg = buildAgg('ttt4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerCoefficientOfVariation' in explanation &&
        'runnerUpThirdGap' in explanation &&
        'candidateScoreNonWinnerMean' in explanation &&
        explanation.candidateCount === 3) {
      const expected = explanation.runnerUpThirdGap / (2 * explanation.candidateScoreNonWinnerMean);
      assert.ok(
        Math.abs(explanation.candidateScoreNonWinnerCoefficientOfVariation - expected) < 1e-9,
        `for n=3, CV (${explanation.candidateScoreNonWinnerCoefficientOfVariation}) should equal runnerUpThirdGap/(2*nonWinnerMean) (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('45454545-5: absent on cast:no_match', async () => {
  const path = dlqPath('ttt5');
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
      !('candidateScoreNonWinnerCoefficientOfVariation' in parsed.explanation),
      `should be absent on no_match, found: ${parsed.explanation.candidateScoreNonWinnerCoefficientOfVariation}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('45454545-6: absent when fewer than 3 candidates', async () => {
  const path = dlqPath('ttt6');
  const twoAgg = new Aggregator([STRIPE_CFG, NEON_CFG], {
    backendFactory: (cfg) => makeBackend(cfg.id === 'stripe' ? stripeTools : neonTools),
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
  });
  try {
    const r = await twoAgg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if (explanation.candidateCount < 3) {
      assert.ok(
        !('candidateScoreNonWinnerCoefficientOfVariation' in explanation),
        `should be absent with < 3 candidates, found: ${explanation.candidateScoreNonWinnerCoefficientOfVariation}`,
      );
    }
  } finally {
    await twoAgg.shutdown();
  }
});

test('45454545-7: candidateScoreNonWinnerStdDev also present and >= 0 when CV present', async () => {
  const agg = buildAgg('ttt7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerCoefficientOfVariation' in explanation) {
      assert.ok(
        'candidateScoreNonWinnerStdDev' in explanation,
        `candidateScoreNonWinnerStdDev should be present when CV is present; keys: ${Object.keys(explanation).join(', ')}`,
      );
      assert.ok(
        explanation.candidateScoreNonWinnerStdDev >= 0,
        `candidateScoreNonWinnerStdDev should be >= 0, got ${explanation.candidateScoreNonWinnerStdDev}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('45454545-8: tool description documents candidateScoreNonWinnerCoefficientOfVariation', async () => {
  const path = dlqPath('ttt8');
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
      cast.description?.includes('candidateScoreNonWinnerCoefficientOfVariation'),
      `cast description should mention candidateScoreNonWinnerCoefficientOfVariation, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
