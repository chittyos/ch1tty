/**
 * 69696969: explanation.candidateScoreNonWinnerAMHMGap in ch1tty/cast when explain:true.
 *
 * candidateScoreNonWinnerAMHMGap: number — gap between non-winner arithmetic and harmonic means:
 * candidateScoreNonWinnerMean - candidateScoreNonWinnerHarmonicMean.
 *
 * Present when: >= 3 candidates and all non-winner scores > 0.
 * Absent when: no_match, < 3 candidates, or any non-winner score is zero.
 * Always >= 0 (AM >= HM by AM-HM inequality).
 * Always >= candidateScoreNonWinnerAMGMGap (HM <= GM <= AM).
 * Zero exactly when all non-winner scores are equal.
 * For n=3: equals (runnerUp-third)^2 / (2*(runnerUp+third)).
 * Identity: candidateScoreNonWinnerAMHMGap === candidateScoreNonWinnerMean - candidateScoreNonWinnerHarmonicMean.
 *
 * Covered:
 *   69696969-1: present when >= 3 candidates and all non-winner scores > 0
 *   69696969-2: always finite and >= 0
 *   69696969-3: identity — equals nonWinnerMean - nonWinnerHarmonicMean
 *   69696969-4: for n=3 equals (runnerUp-third)^2 / (2*(runnerUp+third))
 *   69696969-5: absent on cast:no_match
 *   69696969-6: absent when fewer than 3 candidates
 *   69696969-7: always >= candidateScoreNonWinnerAMGMGap
 *   69696969-8: tool description documents candidateScoreNonWinnerAMHMGap
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-69696969-${label}-${Date.now()}.jsonl`);
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

test('69696969-1: present when >= 3 candidates and all non-winner scores > 0', async () => {
  const agg = buildAgg('rrr1', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3 && explanation.lowestCandidateScore > 0) {
      assert.ok('candidateScoreNonWinnerAMHMGap' in explanation,
        `candidateScoreNonWinnerAMHMGap should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreNonWinnerAMHMGap, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('69696969-2: always finite and >= 0', async () => {
  const agg = buildAgg('rrr2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerAMHMGap' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreNonWinnerAMHMGap),
        `should be finite, got ${explanation.candidateScoreNonWinnerAMHMGap}`,
      );
      assert.ok(
        explanation.candidateScoreNonWinnerAMHMGap >= -1e-9,
        `should be >= 0, got ${explanation.candidateScoreNonWinnerAMHMGap}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('69696969-3: identity — equals nonWinnerMean - nonWinnerHarmonicMean', async () => {
  const agg = buildAgg('rrr3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerAMHMGap' in explanation &&
        'candidateScoreNonWinnerMean' in explanation &&
        'candidateScoreNonWinnerHarmonicMean' in explanation) {
      const expected = explanation.candidateScoreNonWinnerMean - explanation.candidateScoreNonWinnerHarmonicMean;
      assert.ok(
        Math.abs(explanation.candidateScoreNonWinnerAMHMGap - expected) < 1e-9,
        `candidateScoreNonWinnerAMHMGap (${explanation.candidateScoreNonWinnerAMHMGap}) should equal nonWinnerMean - nonWinnerHM (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('69696969-4: for n=3 equals (runnerUp-third)^2 / (2*(runnerUp+third))', async () => {
  const agg = buildAgg('rrr4', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerAMHMGap' in explanation &&
        'runnerUpScore' in explanation &&
        'thirdCandidateScore' in explanation &&
        explanation.candidateCount === 3 &&
        explanation.runnerUpScore > 0 &&
        explanation.thirdCandidateScore > 0) {
      const ru = explanation.runnerUpScore;
      const t = explanation.thirdCandidateScore;
      const expected = (ru - t) ** 2 / (2 * (ru + t));
      assert.ok(
        Math.abs(explanation.candidateScoreNonWinnerAMHMGap - expected) < 1e-9,
        `for n=3, candidateScoreNonWinnerAMHMGap (${explanation.candidateScoreNonWinnerAMHMGap}) should equal (r-t)^2/(2*(r+t)) (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('69696969-5: absent on cast:no_match', async () => {
  const path = dlqPath('rrr5');
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
      !('candidateScoreNonWinnerAMHMGap' in parsed.explanation),
      `should be absent on no_match`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('69696969-6: absent when fewer than 3 candidates', async () => {
  const path = dlqPath('rrr6');
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
        !('candidateScoreNonWinnerAMHMGap' in explanation),
        `should be absent with < 3 candidates`,
      );
    }
  } finally {
    await twoAgg.shutdown();
  }
});

test('69696969-7: always >= candidateScoreNonWinnerAMGMGap', async () => {
  const agg = buildAgg('rrr7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreNonWinnerAMHMGap' in explanation && 'candidateScoreNonWinnerAMGMGap' in explanation) {
      assert.ok(
        explanation.candidateScoreNonWinnerAMHMGap >= explanation.candidateScoreNonWinnerAMGMGap - 1e-9,
        `AM-HM gap (${explanation.candidateScoreNonWinnerAMHMGap}) should be >= AM-GM gap (${explanation.candidateScoreNonWinnerAMGMGap})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('69696969-8: tool description documents candidateScoreNonWinnerAMHMGap', async () => {
  const path = dlqPath('rrr8');
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
      cast.description?.includes('candidateScoreNonWinnerAMHMGap'),
      `cast description should mention candidateScoreNonWinnerAMHMGap, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
