/**
 * CCCCCCCCC: explanation.lowestToThirdRatio in ch1tty/cast when explain:true.
 *
 * lowestToThirdRatio: number — lowestCandidateScore / thirdCandidateScore.
 * Measures how compressed the distribution floor is relative to the 3rd-ranked tool.
 *
 * Present when: >= 3 candidates, thirdCandidateScore > 0, lowestCandidateScore > 0.
 * Absent when: no_match, < 3 candidates, zero third or zero lowest.
 * Always in (0, 1]: lowest <= third by ranking.
 * For n=3: always 1 (lowest IS the third).
 * Chain: lowestCandidateScoreRatio <= lowestToRunnerUpRatio <= lowestToThirdRatio.
 * Identity: lowestToThirdRatio * thirdCandidateScore === lowestCandidateScore.
 *
 * Covered:
 *   CCCCCCCCC-1: present when >= 3 candidates with positive scores
 *   CCCCCCCCC-2: always in (0, 1] when present
 *   CCCCCCCCC-3: absent on cast:no_match
 *   CCCCCCCCC-4: for n=3 always equals 1
 *   CCCCCCCCC-5: absent when only 2 candidates
 *   CCCCCCCCC-6: identity: ratio * thirdCandidateScore === lowestCandidateScore
 *   CCCCCCCCC-7: always >= lowestToRunnerUpRatio when both present
 *   CCCCCCCCC-8: tool description documents lowestToThirdRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-ccccccccc-ltt-${label}-${Date.now()}.jsonl`);
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

test('CCCCCCCCC-1: present when >= 3 candidates with positive scores', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const githubTools: ToolEntry[] = [
    { name: 'list_repos', description: 'billing repositories code', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('c1', [STRIPE_CFG, NEON_CFG, GITHUB_CFG], { stripe: stripeTools, neon: neonTools, github: githubTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    if (explanation.candidateCount >= 3 && explanation.thirdCandidateScore > 0 && explanation.lowestCandidateScore > 0) {
      assert.ok('lowestToThirdRatio' in explanation,
        `lowestToThirdRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.lowestToThirdRatio, 'number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('CCCCCCCCC-2: always in (0, 1] when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const githubTools: ToolEntry[] = [
    { name: 'list_repos', description: 'billing repositories code', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('c2', [STRIPE_CFG, NEON_CFG, GITHUB_CFG], { stripe: stripeTools, neon: neonTools, github: githubTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('lowestToThirdRatio' in explanation) {
      assert.ok(Number.isFinite(explanation.lowestToThirdRatio),
        `should be finite, got ${explanation.lowestToThirdRatio}`);
      assert.ok(explanation.lowestToThirdRatio > -1e-9,
        `should be > 0, got ${explanation.lowestToThirdRatio}`);
      assert.ok(explanation.lowestToThirdRatio <= 1 + 1e-9,
        `should be <= 1, got ${explanation.lowestToThirdRatio}`);
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
      assert.ok(!('lowestToThirdRatio' in parsed.explanation),
        `should be absent on no_match; got ${parsed.explanation.lowestToThirdRatio}`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('CCCCCCCCC-4: for n=3 always equals 1', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const githubTools: ToolEntry[] = [
    { name: 'list_repos', description: 'billing repositories code', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('c4', [STRIPE_CFG, NEON_CFG, GITHUB_CFG], { stripe: stripeTools, neon: neonTools, github: githubTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('lowestToThirdRatio' in explanation && explanation.candidateCount === 3) {
      assert.ok(Math.abs(explanation.lowestToThirdRatio - 1) < 1e-9,
        `for n=3, ratio should be 1 (lowest IS third), got ${explanation.lowestToThirdRatio}`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('CCCCCCCCC-5: absent when only 2 candidates', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('c5', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if (explanation.candidateCount === 2) {
      assert.ok(!('lowestToThirdRatio' in explanation),
        `should be absent with only 2 candidates`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('CCCCCCCCC-6: identity: ratio * thirdCandidateScore === lowestCandidateScore', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const githubTools: ToolEntry[] = [
    { name: 'list_repos', description: 'billing repositories code', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('c6', [STRIPE_CFG, NEON_CFG, GITHUB_CFG], { stripe: stripeTools, neon: neonTools, github: githubTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if (
      'lowestToThirdRatio' in explanation &&
      'thirdCandidateScore' in explanation &&
      'lowestCandidateScore' in explanation
    ) {
      const reconstructed = explanation.lowestToThirdRatio * explanation.thirdCandidateScore;
      assert.ok(Math.abs(reconstructed - explanation.lowestCandidateScore) < 1e-9,
        `ratio * third (${reconstructed}) should equal lowest (${explanation.lowestCandidateScore})`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('CCCCCCCCC-7: always >= lowestToRunnerUpRatio when both present (runnerUp >= third)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const githubTools: ToolEntry[] = [
    { name: 'list_repos', description: 'billing repositories code', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('c7', [STRIPE_CFG, NEON_CFG, GITHUB_CFG], { stripe: stripeTools, neon: neonTools, github: githubTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('lowestToThirdRatio' in explanation && 'lowestToRunnerUpRatio' in explanation) {
      assert.ok(
        explanation.lowestToThirdRatio >= explanation.lowestToRunnerUpRatio - 1e-9,
        `lowest/third (${explanation.lowestToThirdRatio}) should be >= lowest/runnerUp (${explanation.lowestToRunnerUpRatio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('CCCCCCCCC-8: tool description documents lowestToThirdRatio', async () => {
  const agg = buildAgg('c8', [STRIPE_CFG], { stripe: [] });
  try {
    const { tools } = await agg.listAllTools();
    const castTool = tools.find((t) => t.name === 'ch1tty/cast');
    assert.ok(castTool, 'ch1tty/cast tool not found');
    assert.ok(
      castTool.description?.includes('lowestToThirdRatio'),
      `cast description should mention lowestToThirdRatio`,
    );
  } finally {
    await agg.shutdown();
  }
});
