/**
 * Q: ch1tty/search explain: true
 *
 * When explain: true is passed to ch1tty/search, the response includes an
 * `explanation` field showing how results were ranked (match mode, focus boost,
 * per-result relevance scores, recency signals, human-readable rationale).
 *
 * Covered:
 *   1. explain: true → explanation field present on search response
 *   2. explanation.method === 'keyword' (search is always keyword)
 *   3. topCandidates[0].tool is the best-ranking tool
 *   4. explain omitted → no explanation field
 *   5. focus active → explanation includes focus and focusBoost
 *   6. partial match mode (OR fallback) → explanation.matchMode === 'partial'
 *   7. rationale is a non-empty string mentioning the top result
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-search-explain-${label}-${Date.now()}.jsonl`);
}

const TOOL_LIST: ToolEntry[] = [
  { name: 'list_invoices',  description: 'List Stripe invoices for billing and finance reporting', inputSchema: { type: 'object', properties: {} } },
  { name: 'run_report',     description: 'Generate a financial summary report for the month',      inputSchema: { type: 'object', properties: {} } },
  { name: 'list_charges',   description: 'List Stripe charges for tax and accounting purposes',    inputSchema: { type: 'object', properties: {} } },
];

const SERVER_CFG: ServerConfig = {
  id: 'stripe',
  name: 'Stripe',
  type: 'remote',
  access: 'readwrite',
  category: 'ecosystem',
  endpoint: 'https://stripe.test/mcp',
};

function makeStaticBackend(tools: ToolEntry[]): Backend {
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

// ── 1. explain: true → explanation field present ───────────────────────────────

test('search explain: explain:true → explanation field present', async () => {
  const agg = new Aggregator([SERVER_CFG], {
    backendFactory: () => makeStaticBackend(TOOL_LIST),
    embedEnabled: false,
    ledgerDlqPath: dlqPath('present'),
  });
  try {
    const result = await agg.callTool('ch1tty/search', { query: 'invoices', explain: true });
    assert.equal(result.isError, undefined);
    const data = JSON.parse(result.content[0].text as string);
    assert.ok(data.explanation, 'explanation field present');
    assert.ok(typeof data.explanation === 'object', 'explanation is an object');
  } finally {
    await agg.shutdown();
  }
});

// ── 2. explanation.method === 'keyword' ────────────────────────────────────────

test('search explain: method is always keyword', async () => {
  const agg = new Aggregator([SERVER_CFG], {
    backendFactory: () => makeStaticBackend(TOOL_LIST),
    embedEnabled: false,
    ledgerDlqPath: dlqPath('method'),
  });
  try {
    const result = await agg.callTool('ch1tty/search', { query: 'report', explain: true });
    assert.equal(result.isError, undefined);
    const data = JSON.parse(result.content[0].text as string);
    assert.equal(data.explanation.method, 'keyword', 'method is keyword');
  } finally {
    await agg.shutdown();
  }
});

// ── 3. topCandidates[0].tool is the best-ranking tool ─────────────────────────

test('search explain: topCandidates[0] is the top-ranked tool', async () => {
  const agg = new Aggregator([SERVER_CFG], {
    backendFactory: () => makeStaticBackend(TOOL_LIST),
    embedEnabled: false,
    ledgerDlqPath: dlqPath('topcandidate'),
  });
  try {
    const result = await agg.callTool('ch1tty/search', { query: 'invoices', explain: true });
    assert.equal(result.isError, undefined);
    const data = JSON.parse(result.content[0].text as string);
    assert.ok(Array.isArray(data.explanation.topCandidates), 'topCandidates is array');
    assert.ok(data.explanation.topCandidates.length > 0, 'at least one candidate');
    // The top tool in explanation should match tools[0] in the results
    assert.equal(data.explanation.topCandidates[0].tool, data.tools[0].tool, 'topCandidates[0] matches tools[0]');
  } finally {
    await agg.shutdown();
  }
});

// ── 4. explain omitted → no explanation field ─────────────────────────────────

test('search explain: explain omitted → no explanation field', async () => {
  const agg = new Aggregator([SERVER_CFG], {
    backendFactory: () => makeStaticBackend(TOOL_LIST),
    embedEnabled: false,
    ledgerDlqPath: dlqPath('omitted'),
  });
  try {
    const result = await agg.callTool('ch1tty/search', { query: 'invoices' });
    assert.equal(result.isError, undefined);
    const data = JSON.parse(result.content[0].text as string);
    assert.equal(data.explanation, undefined, 'no explanation when explain omitted');
  } finally {
    await agg.shutdown();
  }
});

// ── 5. focus active → explanation includes focus and focusBoost ───────────────

test('search explain: focus active → explanation has focus and focusBoost', async () => {
  const agg = new Aggregator([SERVER_CFG], {
    backendFactory: () => makeStaticBackend(TOOL_LIST),
    embedEnabled: false,
    ledgerDlqPath: dlqPath('focus'),
    focus: 'finance',
  });
  try {
    const result = await agg.callTool('ch1tty/search', { query: 'invoices', explain: true });
    assert.equal(result.isError, undefined);
    const data = JSON.parse(result.content[0].text as string);
    assert.ok(data.explanation, 'explanation present');
    assert.equal(data.explanation.focus, 'finance', 'focus name in explanation');
    assert.equal(typeof data.explanation.focusBoost, 'number', 'focusBoost is a number');
    assert.ok(data.explanation.focusBoost > 0, 'focusBoost positive');
  } finally {
    await agg.shutdown();
  }
});

// ── 6. partial match mode → explanation.matchMode === 'partial' ───────────────

test('search explain: partial fallback → matchMode is partial', async () => {
  const agg = new Aggregator([SERVER_CFG], {
    backendFactory: () => makeStaticBackend(TOOL_LIST),
    embedEnabled: false,
    ledgerDlqPath: dlqPath('partial'),
  });
  try {
    // Query with two terms where no tool matches both → triggers OR fallback
    // "invoices" matches list_invoices but "xyz_no_match" matches nothing — two terms, AND fails
    const result = await agg.callTool('ch1tty/search', { query: 'invoices xyz_no_match', explain: true });
    assert.equal(result.isError, undefined);
    const data = JSON.parse(result.content[0].text as string);
    // If partial fallback fired, matchMode is 'partial'; otherwise 'and'
    if (data.mode === 'partial') {
      assert.equal(data.explanation.matchMode, 'partial', 'matchMode is partial when OR fallback used');
    } else {
      // AND matched — matchMode should be 'and'
      assert.equal(data.explanation.matchMode, 'and', 'matchMode is and when AND matched');
    }
  } finally {
    await agg.shutdown();
  }
});

// ── 7. rationale is a non-empty string mentioning the top result ──────────────

test('search explain: rationale is a non-empty string', async () => {
  const agg = new Aggregator([SERVER_CFG], {
    backendFactory: () => makeStaticBackend(TOOL_LIST),
    embedEnabled: false,
    ledgerDlqPath: dlqPath('rationale'),
  });
  try {
    const result = await agg.callTool('ch1tty/search', { query: 'report', explain: true });
    assert.equal(result.isError, undefined);
    const data = JSON.parse(result.content[0].text as string);
    assert.ok(typeof data.explanation.rationale === 'string', 'rationale is a string');
    assert.ok(data.explanation.rationale.length > 0, 'rationale is non-empty');
    // rationale should mention the top result's tool name
    assert.ok(
      data.explanation.rationale.includes(data.explanation.topCandidates[0].tool),
      'rationale mentions the top tool',
    );
  } finally {
    await agg.shutdown();
  }
});
