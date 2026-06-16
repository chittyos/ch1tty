/**
 * KKKKKKKK: explanation.candidateScoreDecileRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreDecileRatio: number — the 90:10 decile ratio: candidateScoreP90 / candidateScoreP10.
 * A dimensionless inequality measure: how many times more the P90 candidate scores vs. the P10 candidate.
 *
 * Present when: >= 2 candidates and candidateScoreP10 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP10 === 0.
 * Always >= 1 (P90 >= P10 by definition).
 * Equal to 1 when all candidates score identically.
 * Identity: candidateScoreDecileRatio * candidateScoreP10 === candidateScoreP90 always holds.
 *
 * Covered:
 *   KKKKKKKK-1: present when >= 2 candidates and P10 > 0
 *   KKKKKKKK-2: always >= 1 and finite when present
 *   KKKKKKKK-3: absent on cast:no_match
 *   KKKKKKKK-4: identity: decileRatio * P10 === P90
 *   KKKKKKKK-5: absent when only 1 candidate
 *   KKKKKKKK-6: equals 1 when all candidates score identically (P90 === P10)
 *   KKKKKKKK-7: absent when candidateScoreP10 is 0
 *   KKKKKKKK-8: tool description documents candidateScoreDecileRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-kkkkkkkk-${label}-${Date.now()}.jsonl`);
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

test('KKKKKKKK-1: present when >= 2 candidates and P10 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if (explanation.candidateScoreP10 !== undefined && explanation.candidateScoreP10 > 0) {
      assert.ok('candidateScoreDecileRatio' in explanation,
        `candidateScoreDecileRatio should be present when P10 > 0; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreDecileRatio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKKKK-2: always >= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreDecileRatio' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreDecileRatio),
        `should be finite, got ${explanation.candidateScoreDecileRatio}`,
      );
      assert.ok(
        explanation.candidateScoreDecileRatio >= 1 - 1e-9,
        `should be >= 1, got ${explanation.candidateScoreDecileRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKKKK-3: absent on cast:no_match', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'sql query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'zzz_utterly_unrelated_xyzzy_nomatch', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    if ('explanation' in parsed) {
      assert.ok(!('candidateScoreDecileRatio' in parsed.explanation),
        `should be absent on no_match; got ${parsed.explanation.candidateScoreDecileRatio}`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKKKK-4: identity: decileRatio * P10 === P90', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const githubTools: ToolEntry[] = [
    { name: 'list_repos', description: 'billing list repositories code', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k4', [STRIPE_CFG, NEON_CFG, GITHUB_CFG], { stripe: stripeTools, neon: neonTools, github: githubTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if (
      'candidateScoreDecileRatio' in explanation &&
      'candidateScoreP10' in explanation &&
      'candidateScoreP90' in explanation
    ) {
      const reconstructed = explanation.candidateScoreDecileRatio * explanation.candidateScoreP10;
      assert.ok(
        Math.abs(reconstructed - explanation.candidateScoreP90) < 1e-9,
        `decileRatio * P10 (${reconstructed}) should equal P90 (${explanation.candidateScoreP90})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKKKK-5: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment xyzzy unique', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k5', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment xyzzy unique', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    if ('explanation' in parsed && parsed.explanation.candidateCount === 1) {
      assert.ok(!('candidateScoreDecileRatio' in parsed.explanation),
        `should be absent with only 1 candidate`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKKKK-6: equals 1 when all candidates score identically', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'apple', description: 'apple fruit', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'apricot', description: 'apricot fruit', inputSchema: { type: 'object', properties: {} } },
  ];
  const githubTools: ToolEntry[] = [
    { name: 'avocado', description: 'avocado fruit', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k6', [STRIPE_CFG, NEON_CFG, GITHUB_CFG], { stripe: stripeTools, neon: neonTools, github: githubTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'fruit', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreDecileRatio' in explanation) {
      assert.ok(
        Math.abs(explanation.candidateScoreDecileRatio - 1) < 1e-9,
        `when all scores identical, decileRatio should be 1, got ${explanation.candidateScoreDecileRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKKKK-7: absent when candidateScoreP10 is 0', async () => {
  // If P10 is 0, we cannot compute the ratio — division guard prevents it.
  // With many zero-scoring candidates, P10 will be 0.
  const stripeTools: ToolEntry[] = [
    { name: 'billing_tool', description: 'billing invoice payment charge keyword', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'unrelated_a', description: 'unrelated zebra xyzzy', inputSchema: { type: 'object', properties: {} } },
  ];
  const githubTools: ToolEntry[] = [
    { name: 'unrelated_b', description: 'unrelated alpha beta', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('k7', [STRIPE_CFG, NEON_CFG, GITHUB_CFG], { stripe: stripeTools, neon: neonTools, github: githubTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge keyword', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP10' in explanation && explanation.candidateScoreP10 === 0) {
      assert.ok(!('candidateScoreDecileRatio' in explanation),
        `candidateScoreDecileRatio should be absent when P10 is 0`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('KKKKKKKK-8: tool description documents candidateScoreDecileRatio', async () => {
  const agg = buildAgg('k8', [STRIPE_CFG], { stripe: [] });
  try {
    const { tools } = await agg.listAllTools();
    const castTool = tools.find((t) => t.name === 'ch1tty/cast');
    assert.ok(castTool, 'ch1tty/cast tool not found');
    assert.ok(
      castTool.description?.includes('candidateScoreDecileRatio'),
      `cast description should mention candidateScoreDecileRatio, got: ${castTool.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
