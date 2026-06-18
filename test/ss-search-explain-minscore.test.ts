/**
 * Workstream SS: minScore surfaced in ch1tty/search explain output.
 *
 * When explain:true and minScore > 0 are both set on ch1tty/search, the
 * explanation object includes a minScore field and the rationale string
 * mentions the active threshold. This lets callers see the active filter
 * alongside ranking data without parsing the top-level minScore echo.
 *
 * Covered:
 *   1. explain:true + minScore > 0 → explanation.minScore present
 *   2. explain:true + minScore > 0 → rationale mentions the threshold
 *   3. explain:true + minScore = 0 (explicit zero) → minScore absent from explanation
 *   4. explain:true + no minScore → minScore absent from explanation
 *   5. explain:true + minScore > 0 + focus active → both minScore and focus in explanation
 *   6. explain:true + minScore > 0 + partial fallback → both partial and minScore in rationale
 *   7. explain:false + minScore > 0 → no explanation field (minScore still in top-level response)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-ss-${label}-${Date.now()}.jsonl`);
}

const FOCUS_PROFILES = {
  profiles: {
    code: { description: 'Code tools', categories: ['code' as const], servers: ['neon'], boost: 0.5 },
  },
};

// Two neon tools with different relevance for the query "sql execute":
//   run_sql       — description mentions "sql" + "execute" → higher relevance
//   list_projects — description mentions neither → lower relevance (partial fallback only)
const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite', category: 'code',
  endpoint: 'https://neon.test/mcp',
};

const NEON_TOOLS: ToolEntry[] = [
  { name: 'run_sql',       description: 'Execute raw SQL queries on the Neon database', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_projects', description: 'List all database projects',                   inputSchema: { type: 'object', properties: {} } },
];

function makeBackend(): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: NEON_TOOLS.length, toolCacheAge: 0 }),
    listTools: async () => NEON_TOOLS,
    callTool: async (): Promise<ToolCallResult> => ({ content: [{ type: 'text', text: 'ok' }] }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

function makeAgg(label: string, focusEnv?: string): { agg: Aggregator; cfg: ServerConfig } {
  const cfg = { ...NEON_CFG };
  const backend = makeBackend();
  const agg = new Aggregator([cfg], {
    backendFactory: () => backend,
    ledgerDlqPath: dlqPath(label),
    focusProfiles: FOCUS_PROFILES,
    focus: focusEnv,
    embedEnabled: false,
  });
  return { agg, cfg };
}

function parseResult(result: ToolCallResult): Record<string, unknown> {
  return JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as Record<string, unknown>;
}

// Test 1: explain:true + minScore > 0 → explanation.minScore present
test('SS test 1: explain:true + minScore > 0 → explanation.minScore present', async () => {
  const { agg } = makeAgg('t1');
  const result = await agg.callTool('ch1tty/search', { query: 'sql execute', explain: true, minScore: 0.3 });
  const body = parseResult(result);
  const explanation = body.explanation as Record<string, unknown>;
  assert.ok(explanation, 'explanation should be present');
  assert.strictEqual(explanation.minScore, 0.3, 'explanation.minScore should match the active threshold');
  await agg.shutdown();
});

// Test 2: explain:true + minScore > 0 → rationale mentions the threshold
test('SS test 2: explain:true + minScore > 0 → rationale mentions threshold', async () => {
  const { agg } = makeAgg('t2');
  const result = await agg.callTool('ch1tty/search', { query: 'sql execute', explain: true, minScore: 0.5 });
  const body = parseResult(result);
  const explanation = body.explanation as Record<string, unknown>;
  assert.ok(typeof explanation.rationale === 'string', 'rationale should be a string');
  assert.ok(
    (explanation.rationale as string).includes('minScore: 0.5'),
    `rationale should mention active minScore threshold; got: "${explanation.rationale}"`,
  );
  assert.ok(
    (explanation.rationale as string).includes('excluded'),
    `rationale should note tools below threshold were excluded; got: "${explanation.rationale}"`,
  );
  await agg.shutdown();
});

// Test 3: explain:true + minScore = 0 (explicit zero) → minScore absent from explanation
test('SS test 3: explain:true + minScore = 0 → minScore absent from explanation', async () => {
  const { agg } = makeAgg('t3');
  const result = await agg.callTool('ch1tty/search', { query: 'sql execute', explain: true, minScore: 0 });
  const body = parseResult(result);
  const explanation = body.explanation as Record<string, unknown>;
  assert.ok(explanation, 'explanation should still be present');
  assert.strictEqual(explanation.minScore, undefined, 'minScore should be absent when 0 (no-op)');
  assert.ok(!(explanation.rationale as string).includes('minScore'), 'rationale should not mention minScore when 0');
  await agg.shutdown();
});

// Test 4: explain:true + no minScore → minScore absent from explanation
test('SS test 4: explain:true + no minScore → minScore absent from explanation', async () => {
  const { agg } = makeAgg('t4');
  const result = await agg.callTool('ch1tty/search', { query: 'sql execute', explain: true });
  const body = parseResult(result);
  const explanation = body.explanation as Record<string, unknown>;
  assert.ok(explanation, 'explanation should be present');
  assert.strictEqual(explanation.minScore, undefined, 'minScore should be absent when not passed');
  await agg.shutdown();
});

// Test 5: explain:true + minScore > 0 + focus active → both minScore and focus in explanation
test('SS test 5: explain:true + minScore + focus → both in explanation', async () => {
  const { agg } = makeAgg('t5', 'code');
  const result = await agg.callTool('ch1tty/search', { query: 'sql', explain: true, minScore: 0.3 });
  const body = parseResult(result);
  const explanation = body.explanation as Record<string, unknown>;
  assert.ok(explanation, 'explanation present');
  assert.strictEqual(explanation.minScore, 0.3, 'explanation.minScore present');
  assert.strictEqual(explanation.focus, 'code', 'explanation.focus present');
  assert.ok(typeof explanation.focusBoost === 'number', 'explanation.focusBoost present');
  // rationale mentions both
  const rationale = explanation.rationale as string;
  assert.ok(rationale.includes('minScore: 0.3'), `rationale mentions minScore; got: "${rationale}"`);
  assert.ok(rationale.includes('"code" focus'), `rationale mentions focus; got: "${rationale}"`);
  await agg.shutdown();
});

// Test 6: explain:true + minScore > 0 + partial fallback → both partial mode and minScore in rationale
test('SS test 6: explain:true + minScore + partial fallback → both in rationale', async () => {
  const { agg } = makeAgg('t6');
  // 3-term query that no tool fully matches → partial fallback fires
  const result = await agg.callTool('ch1tty/search', { query: 'sql execute project list', explain: true, minScore: 0.1 });
  const body = parseResult(result);
  const explanation = body.explanation as Record<string, unknown>;
  assert.ok(explanation, 'explanation present');
  assert.strictEqual(explanation.matchMode, 'partial', 'partial fallback should be detected');
  assert.strictEqual(explanation.minScore, 0.1, 'explanation.minScore present');
  const rationale = explanation.rationale as string;
  assert.ok(rationale.includes('OR/partial fallback'), `rationale mentions partial; got: "${rationale}"`);
  assert.ok(rationale.includes('minScore: 0.1'), `rationale mentions minScore; got: "${rationale}"`);
  await agg.shutdown();
});

// Test 7: explain:false + minScore > 0 → no explanation field; minScore still in top-level response
test('SS test 7: explain:false + minScore > 0 → no explanation; minScore still in top-level', async () => {
  const { agg } = makeAgg('t7');
  const result = await agg.callTool('ch1tty/search', { query: 'sql execute', explain: false, minScore: 0.3 });
  const body = parseResult(result);
  assert.strictEqual(body.explanation, undefined, 'explanation should be absent when explain:false');
  assert.strictEqual(body.minScore, 0.3, 'minScore should still appear in top-level response');
  await agg.shutdown();
});
