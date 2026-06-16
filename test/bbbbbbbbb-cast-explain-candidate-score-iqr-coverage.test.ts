/**
 * BBBBBBBBB: explanation.candidateScoreIQRCoverage in ch1tty/cast when explain:true.
 *
 * candidateScoreIQRCoverage: number — IQR / spread (fraction of full range covered by middle 50%).
 * Measures how much of the total score range is "bulk" vs driven by outlier extremes.
 *
 * Present when: >= 2 candidates and candidateScoreSpread > 0.
 * Absent when: no_match, single candidate, or all candidates score identically (spread === 0).
 * Always in [0, 1]: IQR <= spread by definition.
 * For n=2: always 0.5 (IQR = 0.5 * spread for exactly 2 candidates).
 * Identity: candidateScoreIQRCoverage * spread === candidateScoreIQR always holds.
 *
 * Covered:
 *   BBBBBBBBB-1: present when >= 2 candidates and spread > 0
 *   BBBBBBBBB-2: always in [0, 1] when present
 *   BBBBBBBBB-3: absent on cast:no_match
 *   BBBBBBBBB-4: for n=2 equals 0.5
 *   BBBBBBBBB-5: absent when only 1 candidate
 *   BBBBBBBBB-6: identity: IQRCoverage * spread === IQR
 *   BBBBBBBBB-7: absent when all candidates score identically
 *   BBBBBBBBB-8: tool description documents candidateScoreIQRCoverage
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-bbbbbbbbb-${label}-${Date.now()}.jsonl`);
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

test('BBBBBBBBB-1: present when >= 2 candidates and spread > 0', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('b1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    if (explanation.candidateScoreSpread !== undefined && explanation.candidateScoreSpread > 0) {
      assert.ok('candidateScoreIQRCoverage' in explanation,
        `candidateScoreIQRCoverage should be present when spread > 0; keys: ${Object.keys(explanation).join(', ')}`);
      assert.equal(typeof explanation.candidateScoreIQRCoverage, 'number', 'should be a number');
    }
  } finally {
    await agg.shutdown();
  }
});

test('BBBBBBBBB-2: always in [0, 1] when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('b2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreIQRCoverage' in explanation) {
      assert.ok(Number.isFinite(explanation.candidateScoreIQRCoverage),
        `should be finite, got ${explanation.candidateScoreIQRCoverage}`);
      assert.ok(explanation.candidateScoreIQRCoverage >= -1e-9,
        `should be >= 0, got ${explanation.candidateScoreIQRCoverage}`);
      assert.ok(explanation.candidateScoreIQRCoverage <= 1 + 1e-9,
        `should be <= 1, got ${explanation.candidateScoreIQRCoverage}`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('BBBBBBBBB-3: absent on cast:no_match', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'sql query', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('b3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'zzz_utterly_unrelated_xyzzy_nomatch', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    if ('explanation' in parsed) {
      assert.ok(!('candidateScoreIQRCoverage' in parsed.explanation),
        `should be absent on no_match; got ${parsed.explanation.candidateScoreIQRCoverage}`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('BBBBBBBBB-4: for n=2 equals 0.5', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('b4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreIQRCoverage' in explanation && explanation.candidateCount === 2) {
      assert.ok(Math.abs(explanation.candidateScoreIQRCoverage - 0.5) < 1e-9,
        `for n=2, IQRCoverage should be 0.5, got ${explanation.candidateScoreIQRCoverage}`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('BBBBBBBBB-5: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment xyzzy unique', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('b5', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment xyzzy unique', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    if ('explanation' in parsed && parsed.explanation.candidateCount === 1) {
      assert.ok(!('candidateScoreIQRCoverage' in parsed.explanation),
        `should be absent with only 1 candidate`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('BBBBBBBBB-6: identity: IQRCoverage * spread === IQR', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const githubTools: ToolEntry[] = [
    { name: 'list_repos', description: 'billing list repositories code', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('b6', [STRIPE_CFG, NEON_CFG, GITHUB_CFG], { stripe: stripeTools, neon: neonTools, github: githubTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if (
      'candidateScoreIQRCoverage' in explanation &&
      'candidateScoreIQR' in explanation &&
      'candidateScoreSpread' in explanation
    ) {
      const reconstructed = explanation.candidateScoreIQRCoverage * explanation.candidateScoreSpread;
      assert.ok(Math.abs(reconstructed - explanation.candidateScoreIQR) < 1e-9,
        `IQRCoverage * spread (${reconstructed}) should equal IQR (${explanation.candidateScoreIQR})`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('BBBBBBBBB-7: absent when all candidates score identically', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'apple', description: 'apple fruit', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'apricot', description: 'apricot fruit', inputSchema: { type: 'object', properties: {} } },
  ];
  const githubTools: ToolEntry[] = [
    { name: 'avocado', description: 'avocado fruit', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('b7', [STRIPE_CFG, NEON_CFG, GITHUB_CFG], { stripe: stripeTools, neon: neonTools, github: githubTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'fruit', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if (explanation.candidateScoreSpread === 0) {
      assert.ok(!('candidateScoreIQRCoverage' in explanation),
        `should be absent when spread is 0 (all identical); keys: ${Object.keys(explanation).join(', ')}`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('BBBBBBBBB-8: tool description documents candidateScoreIQRCoverage', async () => {
  const agg = buildAgg('b8', [STRIPE_CFG], { stripe: [] });
  try {
    const { tools } = await agg.listAllTools();
    const castTool = tools.find((t) => t.name === 'ch1tty/cast');
    assert.ok(castTool, 'ch1tty/cast tool not found');
    assert.ok(
      castTool.description?.includes('candidateScoreIQRCoverage'),
      `cast description should mention candidateScoreIQRCoverage`,
    );
  } finally {
    await agg.shutdown();
  }
});
