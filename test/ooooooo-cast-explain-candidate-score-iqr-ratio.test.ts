/**
 * OOOOOOO: explanation.candidateScoreIQRRatio in ch1tty/cast when explain:true.
 *
 * candidateScoreIQRRatio: number — candidateScoreIQR / candidateScoreMean.
 * Scale-free (relative) IQR: robust spread expressed as a multiple of the mean.
 * Analogous to candidateScoreCoefficientOfVariation (stddev/mean) but using IQR.
 *
 * Present when: >= 2 candidates and candidateScoreMean > 0.
 * Absent when: no_match, single candidate, or all scores are 0.
 * Always >= 0. 0 when IQR is 0 (all scores identical in middle 50%).
 * Identity: candidateScoreIQRRatio * candidateScoreMean === candidateScoreIQR.
 *
 * Covered:
 *   OOOOOOO-1: present when >= 2 candidates with nonzero mean
 *   OOOOOOO-2: always >= 0 and finite when present
 *   OOOOOOO-3: equals 0 when all candidates have identical scores
 *   OOOOOOO-4: identity — candidateScoreIQRRatio * candidateScoreMean === candidateScoreIQR
 *   OOOOOOO-5: absent on cast:no_match
 *   OOOOOOO-6: absent when only 1 candidate
 *   OOOOOOO-7: present regardless of focus (focus inactive)
 *   OOOOOOO-8: tool description documents candidateScoreIQRRatio
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-ooooooo-${label}-${Date.now()}.jsonl`);
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

test('OOOOOOO-1: present when >= 2 candidates with nonzero mean', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('o1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    assert.ok('candidateScoreIQRRatio' in explanation,
      `candidateScoreIQRRatio should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.candidateScoreIQRRatio, 'number', 'candidateScoreIQRRatio should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('OOOOOOO-2: always >= 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('o2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreIQRRatio' in explanation) {
      assert.ok(
        explanation.candidateScoreIQRRatio >= -1e-9,
        `candidateScoreIQRRatio should be >= 0, got ${explanation.candidateScoreIQRRatio}`,
      );
      assert.ok(
        Number.isFinite(explanation.candidateScoreIQRRatio),
        `candidateScoreIQRRatio should be finite, got ${explanation.candidateScoreIQRRatio}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('OOOOOOO-3: equals 0 when all candidates have identical scores', async () => {
  const SAME_DESC = 'billing invoice payment charge query database';
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: SAME_DESC, inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('o3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: SAME_DESC, explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreIQRRatio' in explanation) {
      if (Math.abs(explanation.candidateScoreSpread) < 1e-9) {
        assert.ok(
          Math.abs(explanation.candidateScoreIQRRatio) < 1e-9,
          `candidateScoreIQRRatio should be 0 when all scores equal, got ${explanation.candidateScoreIQRRatio}`,
        );
      }
    }
    assert.ok(explanation.candidateCount >= 1, 'should have candidates');
  } finally {
    await agg.shutdown();
  }
});

test('OOOOOOO-4: identity — candidateScoreIQRRatio * candidateScoreMean === candidateScoreIQR', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('o4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreIQRRatio' in explanation && 'candidateScoreIQR' in explanation && 'candidateScoreMean' in explanation) {
      const reconstructed = explanation.candidateScoreIQRRatio * explanation.candidateScoreMean;
      assert.ok(
        Math.abs(reconstructed - explanation.candidateScoreIQR) < 1e-9,
        `candidateScoreIQRRatio * candidateScoreMean (${reconstructed}) should equal candidateScoreIQR (${explanation.candidateScoreIQR})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('OOOOOOO-5: absent on cast:no_match', async () => {
  const path = dlqPath('o5');
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
      !('candidateScoreIQRRatio' in parsed.explanation),
      `candidateScoreIQRRatio should be absent on no_match, found: ${parsed.explanation.candidateScoreIQRRatio}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('OOOOOOO-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('o6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreIQRRatio' in explanation),
      `candidateScoreIQRRatio should be absent with single candidate, found: ${explanation.candidateScoreIQRRatio}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('OOOOOOO-7: present regardless of focus (focus inactive)', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('o7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'no focus should be active');
    assert.ok('candidateScoreIQRRatio' in explanation,
      `candidateScoreIQRRatio should be present without focus; keys: ${Object.keys(explanation).join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('OOOOOOO-8: tool description documents candidateScoreIQRRatio', async () => {
  const path = dlqPath('o8');
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
      cast.description?.includes('candidateScoreIQRRatio'),
      `cast description should mention candidateScoreIQRRatio, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
