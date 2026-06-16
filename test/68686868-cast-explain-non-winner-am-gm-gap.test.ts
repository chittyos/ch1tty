/**
 * 68686868: explanation.candidateScoreNonWinnerAMGMGap in ch1tty/cast when explain:true.
 *
 * candidateScoreNonWinnerAMGMGap: number — gap between non-winner arithmetic and geometric means:
 * candidateScoreNonWinnerMean - candidateScoreNonWinnerGeometricMean.
 *
 * Present when: >= 3 candidates and all non-winner scores > 0.
 * Absent when: no_match, < 3 candidates, or any non-winner score is zero.
 * Always >= 0 (AM >= GM by AM-GM inequality).
 * Zero exactly when all non-winner scores are equal.
 * For n=3: equals (runnerUp + third)/2 - sqrt(runnerUp * third).
 * Identity: candidateScoreNonWinnerAMGMGap === candidateScoreNonWinnerMean - candidateScoreNonWinnerGeometricMean.
 *
 * Covered:
 *   68686868-1: present when >= 3 candidates and all non-winner scores > 0
 *   68686868-2: always finite and >= 0
 *   68686868-3: identity — equals nonWinnerMean - nonWinnerGeometricMean
 *   68686868-4: for n=3 equals (runnerUp+third)/2 - sqrt(runnerUp*third)
 *   68686868-5: absent on cast:no_match
 *   68686868-6: absent when fewer than 3 candidates
 *   68686868-7: always <= candidateScoreNonWinnerMean - candidateScoreNonWinnerHarmonicMean (AM-HM gap >= AM-GM gap)
 *   68686868-8: tool description documents candidateScoreNonWinnerAMGMGap
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-68686868-${label}-${Date.now()}.jsonl`);
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

test('68686868-1: present when >= 3 candidates and all non-winner scores > 0', async () => {
  const agg = buildAgg('qqq1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3 && explanation.lowestCandidateScore > 0) {
      assert.ok('candidateScoreNonWinnerAMGMGap' in explanation,
        `candidateScoreNonWinnerAMGMGap should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreNonWinnerAMGMGap, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('68686868-2: always finite and >= 0', async () => {
  const agg = buildAgg('qqq2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerAMGMGap' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreNonWinnerAMGMGap),
        `should be finite, got ${explanation.candidateScoreNonWinnerAMGMGap}`,
      );
      assert.ok(
        explanation.candidateScoreNonWinnerAMGMGap >= -1e-9,
        `should be >= 0, got ${explanation.candidateScoreNonWinnerAMGMGap}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('68686868-3: identity — equals nonWinnerMean - nonWinnerGeometricMean', async () => {
  const agg = buildAgg('qqq3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerAMGMGap' in explanation &&
        'candidateScoreNonWinnerMean' in explanation &&
        'candidateScoreNonWinnerGeometricMean' in explanation) {
      const expected = explanation.candidateScoreNonWinnerMean - explanation.candidateScoreNonWinnerGeometricMean;
      assert.ok(
        Math.abs(explanation.candidateScoreNonWinnerAMGMGap - expected) < 1e-9,
        `candidateScoreNonWinnerAMGMGap (${explanation.candidateScoreNonWinnerAMGMGap}) should equal nonWinnerMean - nonWinnerGM (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('68686868-4: for n=3 equals (runnerUp+third)/2 - sqrt(runnerUp*third)', async () => {
  const agg = buildAgg('qqq4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerAMGMGap' in explanation &&
        'runnerUpScore' in explanation &&
        'thirdCandidateScore' in explanation &&
        explanation.candidateCount === 3 &&
        explanation.runnerUpScore > 0 &&
        explanation.thirdCandidateScore > 0) {
      const r2 = explanation.runnerUpScore;
      const t = explanation.thirdCandidateScore;
      const expected = (r2 + t) / 2 - Math.sqrt(r2 * t);
      assert.ok(
        Math.abs(explanation.candidateScoreNonWinnerAMGMGap - expected) < 1e-9,
        `for n=3, candidateScoreNonWinnerAMGMGap (${explanation.candidateScoreNonWinnerAMGMGap}) should equal (r+t)/2 - sqrt(r*t) (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('68686868-5: absent on cast:no_match', async () => {
  const path = dlqPath('qqq5');
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
      !('candidateScoreNonWinnerAMGMGap' in parsed.explanation),
      `should be absent on no_match`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('68686868-6: absent when fewer than 3 candidates', async () => {
  const path = dlqPath('qqq6');
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
        !('candidateScoreNonWinnerAMGMGap' in explanation),
        `should be absent with < 3 candidates`,
      );
    }
  } finally {
    await twoAgg.shutdown();
  }
});

test('68686868-7: always <= (nonWinnerMean - nonWinnerHarmonicMean) when harmonic mean present', async () => {
  const agg = buildAgg('qqq7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerAMGMGap' in explanation &&
        'candidateScoreNonWinnerMean' in explanation &&
        'candidateScoreNonWinnerHarmonicMean' in explanation) {
      const amHmGap = explanation.candidateScoreNonWinnerMean - explanation.candidateScoreNonWinnerHarmonicMean;
      assert.ok(
        explanation.candidateScoreNonWinnerAMGMGap <= amHmGap + 1e-9,
        `AM-GM gap (${explanation.candidateScoreNonWinnerAMGMGap}) should be <= AM-HM gap (${amHmGap}) by HM-GM-AM ordering`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('68686868-8: tool description documents candidateScoreNonWinnerAMGMGap', async () => {
  const path = dlqPath('qqq8');
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
      cast.description?.includes('candidateScoreNonWinnerAMGMGap'),
      `cast description should mention candidateScoreNonWinnerAMGMGap, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
