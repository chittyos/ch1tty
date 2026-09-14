/**
 * Workstream BJ: aggregator.ts:1372 — explanation field in cast: no_match response.
 *
 * When cast is called with explain: true and no tool matches the intent,
 * the no_match response includes an explanation field built via buildCastExplanation.
 * This covers the true branch of the ternary at aggregator.ts:1372.
 *
 * Covered:
 *   1. cast: no_match + explain:true → explanation field present
 *   2. cast: no_match + explain:false (default) → explanation field absent
 *   3. explanation is a non-empty object with at least a method field
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { RoutedTool, ToolCandidate } from '../src/ollama-brain.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-bj-${label}-${Date.now()}.jsonl`);
}

// Force keyword-only routing so garbage intents deterministically produce no_match.
class NullRoutingCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

// Returns a tool with confidence=0 — sets castRoute='brain' at line 1288 (routed.length>0),
// but score=0 is filtered at line 1271 → scoredTools=[] → no_match. Exercises the inner
// castRoute==='brain' ternary branch at line 1372.
class BrainZeroConfidenceCoordinator extends SessionCoordinator {
  override async routeIntent(_query: string, candidates: ToolCandidate[]): Promise<RoutedTool[] | null> {
    if (candidates.length === 0) return null;
    return [{ tool: candidates[0], confidence: 0, reason: 'test-zero-confidence' }];
  }
}

const NEON_CFG: ServerConfig = {
  id: 'neon',
  name: 'Neon Database',
  type: 'remote',
  access: 'readwrite',
  category: 'code',
  endpoint: 'https://neon.test/mcp',
};

const NEON_TOOLS: ToolEntry[] = [
  { name: 'run_sql', description: 'Run SQL on Neon', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_projects', description: 'List Neon projects', inputSchema: { type: 'object', properties: {} } },
];

function makeBackend(): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: NEON_TOOLS.length, toolCacheAge: 0 }),
    listTools: async () => NEON_TOOLS,
    callTool: async (): Promise<ToolCallResult> => ({ content: [{ type: 'text', text: 'result' }] }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

function makeAgg(label: string): Aggregator {
  const dPath = dlqPath(label);
  return new Aggregator([NEON_CFG], {
    backendFactory: () => makeBackend(),
    // Empty catalog prevents ch1tty from exposing suggestions resources that could
    // accidentally match garbage terms via substring (e.g. "the" in "authentication").
    suggestionsCatalog: {},
    embedEnabled: false,
    ledgerDlqPath: dPath,
    coordinator: new NullRoutingCoordinator({}, { enabled: false }, dPath),
  });
}

function parseCast(result: ToolCallResult): Record<string, unknown> {
  const first = result.content[0];
  assert.equal(first?.type, 'text');
  return JSON.parse((first as { text: string }).text) as Record<string, unknown>;
}

// Intent with no keyword overlap with any tool name, server name, or category.
// Uses pure nonsense words (xzqvj etc.) that can't be substrings of real English words.
const NO_MATCH_INTENT = 'xzqvj kwplm bfrnq vzptw';

// ── 1. no_match + explain:true → explanation field present ─────────────────

test('cast: no_match + explain:true → explanation field present in response', async () => {
  const agg = makeAgg('1-explain');
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: NO_MATCH_INTENT, explain: true });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'no_match', `expected no_match, got ${cast.cast}`);
    assert.ok('explanation' in cast, 'explanation field must be present when explain:true and no_match');
    assert.ok(cast.explanation !== null && typeof cast.explanation === 'object',
      'explanation must be a non-null object');
  } finally {
    await agg.shutdown();
  }
});

// ── 2. no_match + explain omitted → explanation field absent ───────────────

test('cast: no_match + explain omitted → explanation field absent', async () => {
  const agg = makeAgg('2-no-explain');
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: NO_MATCH_INTENT });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'no_match', `expected no_match, got ${cast.cast}`);
    assert.equal('explanation' in cast, false, 'explanation must be absent when explain not set');
  } finally {
    await agg.shutdown();
  }
});

// ── 3. explanation has a method field ──────────────────────────────────────

test('cast: no_match explanation object includes a method field', async () => {
  const agg = makeAgg('3-explain-method');
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: NO_MATCH_INTENT, explain: true });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'no_match');
    const explanation = cast.explanation as Record<string, unknown>;
    assert.ok('method' in explanation, 'explanation must include a method field');
    assert.ok(typeof explanation.method === 'string', 'explanation.method must be a string');
  } finally {
    await agg.shutdown();
  }
});

// ── 4. brain route + zero confidence → no_match + explanation (inner ternary) ─

test('cast: no_match (brain route, zero-confidence) + explain:true → explanation present', async () => {
  // BrainZeroConfidenceCoordinator sets castRoute='brain' (routed.length>0) but all tools
  // are filtered at score=0, so scoredTools=[] → no_match. Exercises the inner
  // castRoute==='brain' ternary at aggregator.ts:1372 (brainRouteMs branch).
  const dPath = dlqPath('4-brain-zero');
  const agg = new Aggregator([NEON_CFG], {
    backendFactory: () => makeBackend(),
    suggestionsCatalog: {},
    embedEnabled: false,
    ledgerDlqPath: dPath,
    coordinator: new BrainZeroConfidenceCoordinator({}, { enabled: false }, dPath),
  });
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: NO_MATCH_INTENT, explain: true });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'no_match', `expected no_match, got ${cast.cast}`);
    assert.ok('explanation' in cast, 'explanation field must be present when explain:true and no_match');
    assert.ok(cast.explanation !== null && typeof cast.explanation === 'object',
      'explanation must be a non-null object');
    const explanation = cast.explanation as Record<string, unknown>;
    // Verify the inner ternary's true branch actually forwarded brainRouteMs:
    // explanation.method must be 'brain' and brainMs must be a non-negative number.
    assert.equal(explanation.method, 'brain', 'explanation.method must be "brain" when brain route taken');
    assert.ok(
      typeof explanation.brainMs === 'number' && explanation.brainMs >= 0,
      `explanation.brainMs must be a non-negative number, got ${explanation.brainMs}`,
    );
  } finally {
    await agg.shutdown();
  }
});
