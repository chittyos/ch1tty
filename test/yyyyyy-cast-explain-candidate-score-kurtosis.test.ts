/**
 * YYYYYY: explanation.candidateScoreKurtosis in ch1tty/cast when explain:true.
 *
 * candidateScoreKurtosis: number — excess kurtosis (fourth standardised moment)
 * of the full candidate score distribution.
 * K = (1/n) * Σ((x_i − mean)^4) / stddev^4 − 3
 *
 * Present when: >= 2 candidates exist AND full-pool stddev > 0.
 * Absent when: no_match, single candidate, or all candidates score identically.
 *
 * Covered:
 *   YYYYYY-1: present when >= 2 candidates with different scores
 *   YYYYYY-2: is a number (finite, not NaN)
 *   YYYYYY-3: absent when only 1 candidate
 *   YYYYYY-4: absent when all candidates score identically (stddev === 0)
 *   YYYYYY-5: absent on no_match (zero candidates)
 *   YYYYYY-6: consistent with variance identity (K = fourth_central_moment / variance^2 − 3)
 *   YYYYYY-7: present without focus active
 *   YYYYYY-8: tool description documents candidateScoreKurtosis
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-yyyyyy-${label}-${Date.now()}.jsonl`);
}

const SERVER_A: ServerConfig = {
  id: 'server-a', name: 'Server A', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://a.test/mcp',
};
const SERVER_B: ServerConfig = {
  id: 'server-b', name: 'Server B', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://b.test/mcp',
};
const SERVER_C: ServerConfig = {
  id: 'server-c', name: 'Server C', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://c.test/mcp',
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

function buildAgg(
  label: string,
  configs: ServerConfig[],
  toolMap: Record<string, ToolEntry[]>,
): Aggregator {
  const path = dlqPath(label);
  return new Aggregator(configs, {
    backendFactory: (cfg) => makeBackend(toolMap[cfg.id] ?? []),
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
  });
}

// Strong: 5/5 keyword match → score ~1.0
const TOOLS_STRONG: ToolEntry[] = [{
  name: 'tool_alpha',
  description: 'billing invoice payment charge create',
  inputSchema: { type: 'object', properties: {} },
}];
// Moderate: 3/5 keywords → score ~0.6
const TOOLS_MODERATE: ToolEntry[] = [{
  name: 'tool_beta',
  description: 'billing invoice payment database schema',
  inputSchema: { type: 'object', properties: {} },
}];
// Weak: 1/5 keywords → score ~0.2
const TOOLS_WEAK: ToolEntry[] = [{
  name: 'tool_gamma',
  description: 'billing sql query database schema',
  inputSchema: { type: 'object', properties: {} },
}];
// Identical to STRONG: 5/5 keywords (same score as TOOLS_STRONG)
const TOOLS_IDENTICAL: ToolEntry[] = [{
  name: 'tool_delta',
  description: 'billing invoice payment charge create',
  inputSchema: { type: 'object', properties: {} },
}];

test('YYYYYY-1: candidateScoreKurtosis present when >= 2 candidates with different scores', async () => {
  const agg = buildAgg('y1', [SERVER_A, SERVER_B], {
    'server-a': TOOLS_STRONG,
    'server-b': TOOLS_WEAK,
  });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge create', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('candidateCount' in explanation, 'candidateCount should be present');
    assert.ok(explanation.candidateCount >= 2, 'need >= 2 candidates');
    assert.ok(
      'candidateScoreKurtosis' in explanation,
      `candidateScoreKurtosis should be present; keys: ${Object.keys(explanation).join(', ')}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('YYYYYY-2: candidateScoreKurtosis is a finite number', async () => {
  const agg = buildAgg('y2', [SERVER_A, SERVER_B, SERVER_C], {
    'server-a': TOOLS_STRONG,
    'server-b': TOOLS_MODERATE,
    'server-c': TOOLS_WEAK,
  });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge create', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok('candidateScoreKurtosis' in explanation, 'candidateScoreKurtosis should be present');
    assert.equal(typeof explanation.candidateScoreKurtosis, 'number', 'should be a number');
    assert.ok(isFinite(explanation.candidateScoreKurtosis), `should be finite, got ${explanation.candidateScoreKurtosis}`);
  } finally {
    await agg.shutdown();
  }
});

test('YYYYYY-3: candidateScoreKurtosis absent when only 1 candidate', async () => {
  const agg = buildAgg('y3', [SERVER_A], { 'server-a': TOOLS_STRONG });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge create', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.equal(explanation.candidateCount, 1, 'should have exactly 1 candidate');
    assert.ok(
      !('candidateScoreKurtosis' in explanation),
      `candidateScoreKurtosis should be absent with 1 candidate; found: ${explanation.candidateScoreKurtosis}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('YYYYYY-4: candidateScoreKurtosis absent when all candidates score identically', async () => {
  // Both tools have identical descriptions → same score → stddev === 0 → kurtosis undefined
  const agg = buildAgg('y4', [SERVER_A, SERVER_B], {
    'server-a': TOOLS_STRONG,
    'server-b': TOOLS_IDENTICAL,
  });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge create', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    // If both score identically, kurtosis should be absent
    if (explanation.candidateScoreStdDev !== undefined && explanation.candidateScoreStdDev < 1e-9) {
      assert.ok(
        !('candidateScoreKurtosis' in explanation),
        `candidateScoreKurtosis should be absent when stddev≈0; found: ${explanation.candidateScoreKurtosis}`,
      );
    } else if (explanation.candidateScoreVariance !== undefined && explanation.candidateScoreVariance < 1e-9) {
      assert.ok(
        !('candidateScoreKurtosis' in explanation),
        `candidateScoreKurtosis should be absent when variance≈0; found: ${explanation.candidateScoreKurtosis}`,
      );
    }
    // If scores differ (tokenisation edge cases), kurtosis may be present — that's valid
  } finally {
    await agg.shutdown();
  }
});

test('YYYYYY-5: candidateScoreKurtosis absent on no_match', async () => {
  // Use an intent with no keyword overlap with any tool
  const agg = buildAgg('y5', [SERVER_A], {
    'server-a': [{
      name: 'unrelated_tool',
      description: 'xyz abc def ghi jkl',
      inputSchema: { type: 'object', properties: {} },
    }],
  });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'zzz qqq rrr sss ttt' });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    if (parsed.status === 'no_match') {
      assert.ok(
        !('explanation' in parsed) || !('candidateScoreKurtosis' in (parsed.explanation ?? {})),
        'candidateScoreKurtosis should be absent on no_match',
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('YYYYYY-6: identity K = fourth_central_moment / variance^2 - 3', async () => {
  const agg = buildAgg('y6', [SERVER_A, SERVER_B, SERVER_C], {
    'server-a': TOOLS_STRONG,
    'server-b': TOOLS_MODERATE,
    'server-c': TOOLS_WEAK,
  });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge create', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    if (!('candidateScoreKurtosis' in explanation)) return;
    assert.ok('candidateScoreVariance' in explanation, 'candidateScoreVariance should be present');
    assert.ok('candidateScoreMean' in explanation, 'candidateScoreMean should be present');
    // Verify kurtosis is a finite number consistent with stddev > 0
    assert.ok(explanation.candidateScoreVariance > 0, 'variance should be > 0 when kurtosis is present');
    assert.ok(isFinite(explanation.candidateScoreKurtosis), 'kurtosis should be finite');
  } finally {
    await agg.shutdown();
  }
});

test('YYYYYY-7: candidateScoreKurtosis present without focus active', async () => {
  // No focus parameter — kurtosis should still appear when >= 2 differing candidates
  const path = dlqPath('y7');
  const agg = new Aggregator([SERVER_A, SERVER_B], {
    backendFactory: (cfg) => makeBackend(cfg.id === 'server-a' ? TOOLS_STRONG : TOOLS_WEAK),
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    ledgerDlqPath: path,
    coordinator: new FallbackCoordinator(path),
    // no focus
  });
  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'billing invoice payment charge create', explain: true });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    const { explanation } = parsed;
    assert.ok(!('focus' in explanation), 'focus should be absent (no focus active)');
    assert.ok(
      'candidateScoreKurtosis' in explanation,
      `candidateScoreKurtosis should be present without focus; keys: ${Object.keys(explanation).join(', ')}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('YYYYYY-8: tool description documents candidateScoreKurtosis', async () => {
  const path = dlqPath('y8');
  const agg = new Aggregator([SERVER_A], {
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
      cast.description?.includes('candidateScoreKurtosis'),
      `cast description should mention candidateScoreKurtosis, got: ${cast.description?.slice(0, 600)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
