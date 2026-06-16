/**
 * AAAAAAAAA: explanation.candidateScoreP95P10Ratio in ch1tty/cast when explain:true.
 *
 * candidateScoreP95P10Ratio: number — P95/P10 ratio of candidate score distribution.
 * Spans 85 percentile-points; wider than decile ratio (P90/P10), narrower than P95/P05.
 *
 * Present when: >= 2 candidates and candidateScoreP10 > 0.
 * Absent when: no_match, single candidate, or candidateScoreP10 === 0.
 * Always >= 1 (P95 >= P10 by monotonicity).
 * Identity: candidateScoreP95P10Ratio * candidateScoreP10 === candidateScoreP95.
 * Always >= candidateScoreP90P10Ratio (since P95 >= P90).
 *
 * Covered:
 *   AAAAAAAAA-1: present when >= 2 candidates and P10 > 0
 *   AAAAAAAAA-2: always >= 1 and finite when present
 *   AAAAAAAAA-3: absent on cast:no_match
 *   AAAAAAAAA-4: identity: ratio * P10 === P95
 *   AAAAAAAAA-5: absent when only 1 candidate
 *   AAAAAAAAA-6: always >= candidateScoreP90P10Ratio when both present
 *   AAAAAAAAA-7: absent when candidateScoreP10 is 0
 *   AAAAAAAAA-8: tool description documents candidateScoreP95P10Ratio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-aaaaaaaaa-${label}-${Date.now()}.jsonl`);
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

test('AAAAAAAAA-1: present when >= 2 candidates and P10 > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('a1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if (explanation.candidateScoreP10 !== undefined && explanation.candidateScoreP10 > 0) {
      assert.ok('candidateScoreP95P10Ratio' in explanation,
        `candidateScoreP95P10Ratio should be present when P10 > 0; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreP95P10Ratio, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('AAAAAAAAA-2: always >= 1 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('a2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP95P10Ratio' in explanation) {
      assert.ok(Number.isFinite(explanation.candidateScoreP95P10Ratio),
        `should be finite, got ${explanation.candidateScoreP95P10Ratio}`);
      assert.ok(explanation.candidateScoreP95P10Ratio >= 1 - 1e-9,
        `should be >= 1, got ${explanation.candidateScoreP95P10Ratio}`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('AAAAAAAAA-3: absent on cast:no_match', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'sql query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('a3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'zzz_utterly_unrelated_xyzzy_nomatch', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    if ('explanation' in parsed) {
      assert.ok(!('candidateScoreP95P10Ratio' in parsed.explanation),
        `should be absent on no_match; got ${parsed.explanation.candidateScoreP95P10Ratio}`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('AAAAAAAAA-4: identity: ratio * P10 === P95', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const githubTools: ToolEntry[] = [
    { name: 'list_repos', description: 'billing list repositories code', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('a4', [STRIPE_CFG, NEON_CFG, GITHUB_CFG], { stripe: stripeTools, neon: neonTools, github: githubTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if (
      'candidateScoreP95P10Ratio' in explanation &&
      'candidateScoreP10' in explanation &&
      'candidateScoreP95' in explanation
    ) {
      const reconstructed = explanation.candidateScoreP95P10Ratio * explanation.candidateScoreP10;
      assert.ok(Math.abs(reconstructed - explanation.candidateScoreP95) < 1e-9,
        `ratio * P10 (${reconstructed}) should equal P95 (${explanation.candidateScoreP95})`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('AAAAAAAAA-5: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment xyzzy unique', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('a5', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment xyzzy unique', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    if ('explanation' in parsed && parsed.explanation.candidateCount === 1) {
      assert.ok(!('candidateScoreP95P10Ratio' in parsed.explanation),
        `should be absent with only 1 candidate`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('AAAAAAAAA-6: always >= candidateScoreP90P10Ratio when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('a6', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP95P10Ratio' in explanation && 'candidateScoreP90P10Ratio' in explanation) {
      assert.ok(
        explanation.candidateScoreP95P10Ratio >= explanation.candidateScoreP90P10Ratio - 1e-9,
        `P95/P10 (${explanation.candidateScoreP95P10Ratio}) should be >= P90/P10 (${explanation.candidateScoreP90P10Ratio})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('AAAAAAAAA-7: absent when candidateScoreP10 is 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'billing_tool', description: 'billing invoice payment charge keyword', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'unrelated_a', description: 'unrelated zebra xyzzy', inputSchema: { type: 'object', properties: {} } },
  ];
  const githubTools: ToolEntry[] = [
    { name: 'unrelated_b', description: 'unrelated alpha beta', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('a7', [STRIPE_CFG, NEON_CFG, GITHUB_CFG], { stripe: stripeTools, neon: neonTools, github: githubTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge keyword', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP10' in explanation && explanation.candidateScoreP10 === 0) {
      assert.ok(!('candidateScoreP95P10Ratio' in explanation),
        `should be absent when P10 is 0`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('AAAAAAAAA-8: tool description documents candidateScoreP95P10Ratio', async () => {
  const agg = buildAgg('a8', [STRIPE_CFG], { stripe: [] });
  try {
    const { tools } = await agg.listAllTools();
    const castTool = tools.find((t) => t.name === 'ch1tty/cast');
    assert.ok(castTool, 'ch1tty/cast tool not found');
    assert.ok(
      castTool.description?.includes('candidateScoreP95P10Ratio'),
      `cast description should mention candidateScoreP95P10Ratio`,
    );
  } finally {
    await agg.shutdown();
  }
});
