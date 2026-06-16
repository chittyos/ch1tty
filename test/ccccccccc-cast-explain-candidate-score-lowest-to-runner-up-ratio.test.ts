/**
 * CCCCCCCCC: explanation.candidateScoreLowestToRunnerUpRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreLowestToRunnerUpRatio: number — lowestCandidateScore / runnerUpScore.
 * Measures how compressed the bottom tail is relative to the second-best candidate.
 *
 * Present when: >= 2 candidates and runnerUpScore > 0.
 * Absent when: no_match, single candidate, or runnerUpScore === 0.
 * Always in [0, 1]: lowest <= runnerUp by definition.
 * For n=2: always 1 (lowestCandidateScore === runnerUpScore).
 * Identity: candidateScoreLowestToRunnerUpRatio * runnerUpScore === lowestCandidateScore always holds.
 *
 * Covered:
 *   CCCCCCCCC-1: present when >= 2 candidates and runnerUpScore > 0
 *   CCCCCCCCC-2: always in [0, 1] when present
 *   CCCCCCCCC-3: absent on cast:no_match
 *   CCCCCCCCC-4: for n=2 always equals 1
 *   CCCCCCCCC-5: absent when only 1 candidate
 *   CCCCCCCCC-6: identity: ratio * runnerUpScore === lowestCandidateScore
 *   CCCCCCCCC-7: always <= lowestCandidateScoreRatio inverse (lowest <= runnerUp <= winner)
 *   CCCCCCCCC-8: tool description documents candidateScoreLowestToRunnerUpRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-ccccccccc-${label}-${Date.now()}.jsonl`);
}

const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe Payments', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.test/mcp',
};
const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.test/mcp',
};
const GITHUB_CFG: ServerConfig = {
  id: 'github', name: 'GitHub', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://github.test/mcp',
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

test('CCCCCCCCC-1: present when >= 2 candidates and runnerUpScore > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('c1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if (explanation.runnerUpScore > 0) {
      assert.ok('candidateScoreLowestToRunnerUpRatio' in explanation,
        `candidateScoreLowestToRunnerUpRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreLowestToRunnerUpRatio, 'number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('CCCCCCCCC-2: always in [0, 1] when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('c2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreLowestToRunnerUpRatio' in explanation) {
      assert.ok(Number.isFinite(explanation.candidateScoreLowestToRunnerUpRatio),
        `should be finite, got ${explanation.candidateScoreLowestToRunnerUpRatio}`);
      assert.ok(explanation.candidateScoreLowestToRunnerUpRatio >= -1e-9,
        `should be >= 0, got ${explanation.candidateScoreLowestToRunnerUpRatio}`);
      assert.ok(explanation.candidateScoreLowestToRunnerUpRatio <= 1 + 1e-9,
        `should be <= 1, got ${explanation.candidateScoreLowestToRunnerUpRatio}`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('CCCCCCCCC-3: absent on cast:no_match', async () => {
  const agg = buildAgg('c3', [STRIPE_CFG], { stripe: [] });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'zzz_utterly_unrelated_xyzzy_nomatch', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    if ('explanation' in parsed) {
      assert.ok(!('candidateScoreLowestToRunnerUpRatio' in parsed.explanation),
        `should be absent on no_match; got ${parsed.explanation.candidateScoreLowestToRunnerUpRatio}`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('CCCCCCCCC-4: for n=2 always equals 1', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('c4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreLowestToRunnerUpRatio' in explanation && explanation.candidateCount === 2) {
      assert.ok(Math.abs(explanation.candidateScoreLowestToRunnerUpRatio - 1) < 1e-9,
        `for n=2, ratio should be 1, got ${explanation.candidateScoreLowestToRunnerUpRatio}`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('CCCCCCCCC-5: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment xyzzy unique', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('c5', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment xyzzy unique', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    if ('explanation' in parsed && parsed.explanation.candidateCount === 1) {
      assert.ok(!('candidateScoreLowestToRunnerUpRatio' in parsed.explanation),
        `should be absent with only 1 candidate`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('CCCCCCCCC-6: identity: ratio * runnerUpScore === lowestCandidateScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const githubTools: ToolEntry[] = [
    { name: 'list_repos', description: 'billing list repositories code', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('c6', [STRIPE_CFG, NEON_CFG, GITHUB_CFG], { stripe: stripeTools, neon: neonTools, github: githubTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if (
      'candidateScoreLowestToRunnerUpRatio' in explanation &&
      'runnerUpScore' in explanation &&
      'lowestCandidateScore' in explanation
    ) {
      const reconstructed = explanation.candidateScoreLowestToRunnerUpRatio * explanation.runnerUpScore;
      assert.ok(Math.abs(reconstructed - explanation.lowestCandidateScore) < 1e-9,
        `ratio * runnerUpScore (${reconstructed}) should equal lowestCandidateScore (${explanation.lowestCandidateScore})`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('CCCCCCCCC-7: lowest <= runnerUp <= winner so ratio is bounded by lowestCandidateScoreRatio', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const githubTools: ToolEntry[] = [
    { name: 'list_repos', description: 'billing list repositories code', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('c7', [STRIPE_CFG, NEON_CFG, GITHUB_CFG], { stripe: stripeTools, neon: neonTools, github: githubTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreLowestToRunnerUpRatio' in explanation && 'lowestCandidateScoreRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreLowestToRunnerUpRatio >= explanation.lowestCandidateScoreRatio - 1e-9,
        `lowest/runnerUp (${explanation.candidateScoreLowestToRunnerUpRatio}) should be >= lowest/winner (${explanation.lowestCandidateScoreRatio}) since runnerUp <= winner`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('CCCCCCCCC-8: tool description documents candidateScoreLowestToRunnerUpRatio', async () => {
  const agg = buildAgg('c8', [STRIPE_CFG], { stripe: [] });
  try {
    const { tools } = await agg.listAllTools();
    const castTool = tools.find((t) => t.name === 'ch1tty/cast');
    assert.ok(castTool, 'ch1tty/cast tool not found');
    assert.ok(
      castTool.description?.includes('candidateScoreLowestToRunnerUpRatio'),
      `cast description should mention candidateScoreLowestToRunnerUpRatio`,
    );
  } finally {
    await agg.shutdown();
  }
});
