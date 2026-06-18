/**
 * 57575757: explanation.winnerToNonWinnerMassRatio in ch1tty/cast when explain:true.
 *
 * winnerToNonWinnerMassRatio: number — winner score divided by total non-winner score mass:
 * winnerScore / (candidateScoreEntropyTotal - winnerScore).
 *
 * Present when: >= 2 candidates, total > 0, and non-winner mass > 0.
 * Absent when: no_match, single candidate, zero total, or all non-winner scores zero.
 * Always > 0.
 * For n=2: equals winnerScoreRatio (= winnerScore / runnerUpScore).
 * Always >= scoreDominanceIndex.
 * Ratio identity: winnerToNonWinnerMassRatio === scoreDominanceIndex / nonWinnerScoreHeavinessRatio.
 *
 * Covered:
 *   57575757-1: present when >= 2 candidates, total > 0, and non-winner mass > 0
 *   57575757-2: always finite and > 0
 *   57575757-3: ratio identity — equals scoreDominanceIndex / nonWinnerScoreHeavinessRatio
 *   57575757-4: for n=2 equals winnerScoreRatio
 *   57575757-5: absent on cast:no_match
 *   57575757-6: absent when single candidate
 *   57575757-7: always >= scoreDominanceIndex
 *   57575757-8: tool description documents winnerToNonWinnerMassRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-57575757-${label}-${Date.now()}.jsonl`);
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

test('57575757-1: present when >= 2 candidates, total > 0, and non-winner mass > 0', async () => {
  const agg = buildAgg('fff1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    const total = explanation.candidateScoreMean * explanation.candidateCount;
    const nonWinnerMass = total - explanation.winnerScore;
    if (explanation.candidateCount >= 2 && total > 0 && nonWinnerMass > 0) {
      assert.ok('winnerToNonWinnerMassRatio' in explanation,
        `winnerToNonWinnerMassRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.winnerToNonWinnerMassRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('57575757-2: always finite and > 0', async () => {
  const agg = buildAgg('fff2', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerToNonWinnerMassRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.winnerToNonWinnerMassRatio),
        `should be finite, got ${explanation.winnerToNonWinnerMassRatio}`,
      );
      assert.ok(
        explanation.winnerToNonWinnerMassRatio > 0,
        `should be > 0, got ${explanation.winnerToNonWinnerMassRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('57575757-3: ratio identity — equals scoreDominanceIndex / nonWinnerScoreHeavinessRatio', async () => {
  const agg = buildAgg('fff3', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerToNonWinnerMassRatio' in explanation &&
        'scoreDominanceIndex' in explanation &&
        'nonWinnerScoreHeavinessRatio' in explanation &&
        explanation.nonWinnerScoreHeavinessRatio > 0) {
      const expected = explanation.scoreDominanceIndex / explanation.nonWinnerScoreHeavinessRatio;
      assert.ok(
        Math.abs(explanation.winnerToNonWinnerMassRatio - expected) < 1e-9,
        `winnerToNonWinnerMassRatio (${explanation.winnerToNonWinnerMassRatio}) should equal scoreDominanceIndex/nonWinnerHeaviness (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('57575757-4: for n=2 equals winnerScoreRatio', async () => {
  const agg = buildAgg('fff4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerToNonWinnerMassRatio' in explanation &&
        'winnerScoreRatio' in explanation &&
        explanation.candidateCount === 2) {
      assert.ok(
        Math.abs(explanation.winnerToNonWinnerMassRatio - explanation.winnerScoreRatio) < 1e-9,
        `for n=2, winnerToNonWinnerMassRatio (${explanation.winnerToNonWinnerMassRatio}) should equal winnerScoreRatio (${explanation.winnerScoreRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('57575757-5: absent on cast:no_match', async () => {
  const path = dlqPath('fff5');
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
      !('winnerToNonWinnerMassRatio' in parsed.explanation),
      `should be absent on no_match`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('57575757-6: absent when single candidate', async () => {
  const path = dlqPath('fff6');
  const singleAgg = new Aggregator([STRIPE_CFG], {
    backendFactory: () => makeBackend([stripeTools[0]]),
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
  });
  try {
    const r = await singleAgg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if (explanation.candidateCount <= 1) {
      assert.ok(
        !('winnerToNonWinnerMassRatio' in explanation),
        `should be absent with single candidate`,
      );
    }
  } finally {
    await singleAgg.shutdown();
  }
});

test('57575757-7: always >= scoreDominanceIndex', async () => {
  const agg = buildAgg('fff7', [STRIPE_CFG, NEON_CFG, LINEAR_CFG], { stripe: stripeTools, neon: neonTools, linear: linearTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('winnerToNonWinnerMassRatio' in explanation && 'scoreDominanceIndex' in explanation) {
      assert.ok(
        explanation.winnerToNonWinnerMassRatio >= explanation.scoreDominanceIndex - 1e-9,
        `winnerToNonWinnerMassRatio (${explanation.winnerToNonWinnerMassRatio}) should be >= scoreDominanceIndex (${explanation.scoreDominanceIndex})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('57575757-8: tool description documents winnerToNonWinnerMassRatio', async () => {
  const path = dlqPath('fff8');
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
      cast.description?.includes('winnerToNonWinnerMassRatio'),
      `cast description should mention winnerToNonWinnerMassRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
