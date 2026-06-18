/**
 * IIIIIIII: explanation.candidateScoreP90Range in ch1tty/cast when explain:true.
 *
 * candidateScoreP90Range: number — the 90th-percentile range:
 * candidateScoreP95 - candidateScoreP05.
 *
 * Present when: >= 2 candidates (same as P95 and P05).
 * Absent when: no_match or single candidate.
 * Always >= 0 (P05 <= P95 by definition).
 * Always >= candidateScoreP80Range.
 * Always >= candidateScoreIQR.
 * For n=2: 0.9 * winnerRunnerUpGap.
 * Identity: === candidateScoreP95 - candidateScoreP05.
 *
 * Covered:
 *   IIIIIIII-1: present when >= 2 candidates
 *   IIIIIIII-2: always >= 0 and finite when present
 *   IIIIIIII-3: identity — equals candidateScoreP95 - candidateScoreP05
 *   IIIIIIII-4: for n=2 equals 0.9 * winnerRunnerUpGap
 *   IIIIIIII-5: absent on cast:no_match
 *   IIIIIIII-6: absent when only 1 candidate
 *   IIIIIIII-7: always >= candidateScoreP80Range when both present
 *   IIIIIIII-8: tool description documents candidateScoreP90Range
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-iiiiiiii-${label}-${Date.now()}.jsonl`);
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

test('IIIIIIII-1: present when >= 2 candidates', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('i1', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    assert.ok('explanation' in parsed, 'explanation absent');
    const { explanation } = parsed;
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    assert.ok('candidateScoreP90Range' in explanation,
      `candidateScoreP90Range should be present; keys: ${Object.keys(explanation).join(', ')}`);
    assert.equal(typeof explanation.candidateScoreP90Range, 'number', 'candidateScoreP90Range should be a number');
  } finally {
    await agg.shutdown();
  }
});

test('IIIIIIII-2: always >= 0 and finite when present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('i2', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP90Range' in explanation) {
      assert.ok(
        Number.isFinite(explanation.candidateScoreP90Range),
        `candidateScoreP90Range should be finite, got ${explanation.candidateScoreP90Range}`,
      );
      assert.ok(
        explanation.candidateScoreP90Range >= -1e-9,
        `candidateScoreP90Range should be >= 0, got ${explanation.candidateScoreP90Range}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('IIIIIIII-3: identity — equals candidateScoreP95 - candidateScoreP05', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('i3', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP90Range' in explanation && 'candidateScoreP95' in explanation && 'candidateScoreP05' in explanation) {
      const expected = explanation.candidateScoreP95 - explanation.candidateScoreP05;
      assert.ok(
        Math.abs(explanation.candidateScoreP90Range - expected) < 1e-9,
        `candidateScoreP90Range (${explanation.candidateScoreP90Range}) should equal P95 - P05 (${expected})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('IIIIIIII-4: for n=2 equals 0.9 * winnerRunnerUpGap', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('i4', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP90Range' in explanation && explanation.candidateCount === 2 && 'winnerRunnerUpGap' in explanation) {
      const expected = 0.9 * explanation.winnerRunnerUpGap;
      assert.ok(
        Math.abs(explanation.candidateScoreP90Range - expected) < 1e-9,
        `candidateScoreP90Range (${explanation.candidateScoreP90Range}) should equal 0.9 * winnerRunnerUpGap (${expected}) for n=2`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('IIIIIIII-5: absent on cast:no_match', async () => {
  const path = dlqPath('i5');
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
      !('candidateScoreP90Range' in parsed.explanation),
      `candidateScoreP90Range should be absent on no_match, found: ${parsed.explanation.candidateScoreP90Range}`,
    );
  } finally {
    await emptyAgg.shutdown();
  }
});

test('IIIIIIII-6: absent when only 1 candidate', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('i6', [STRIPE_CFG], { stripe: stripeTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly one candidate');
    assert.ok(
      !('candidateScoreP90Range' in explanation),
      `candidateScoreP90Range should be absent with single candidate, found: ${explanation.candidateScoreP90Range}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('IIIIIIII-7: always >= candidateScoreP80Range when both present', async () => {
  const stripeTools: ToolEntry[] = [
    { name: 'create_invoice', description: 'billing invoice payment charge', inputSchema: { type: 'object', properties: {} } },
  ];
  const neonTools: ToolEntry[] = [
    { name: 'run_sql', description: 'billing sql query database', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = buildAgg('i7', [STRIPE_CFG, NEON_CFG], { stripe: stripeTools, neon: neonTools });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if ('candidateScoreP90Range' in explanation && 'candidateScoreP80Range' in explanation) {
      assert.ok(
        explanation.candidateScoreP90Range >= explanation.candidateScoreP80Range - 1e-9,
        `candidateScoreP90Range (${explanation.candidateScoreP90Range}) should be >= candidateScoreP80Range (${explanation.candidateScoreP80Range})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('IIIIIIII-8: tool description documents candidateScoreP90Range', async () => {
  const path = dlqPath('i8');
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
      cast.description?.includes('candidateScoreP90Range'),
      `cast description should mention candidateScoreP90Range, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
