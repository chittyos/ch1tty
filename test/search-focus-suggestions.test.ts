/**
 * G: ch1tty/search focus catalog suggestions
 *
 * When a focus is active (env or per-call) and a query is present, search
 * should include ranked catalog suggestions (combos + prompts) alongside
 * the tool results — mirroring the behaviour already present in cast.
 *
 * Covered:
 *   1. search with focus + query includes suggestions
 *   2. search without focus does NOT include suggestions
 *   3. search with focus but no query does NOT include suggestions
 *   4. suggestions are ranked by intent relevance (best-matching combo first)
 *   5. per-call focus=none suppresses suggestions even when env focus is set
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-search-focus-${label}-${Date.now()}.jsonl`);
}

const SEARCH_CATALOG = {
  finance: {
    description: 'Finance focus',
    combos: [
      {
        name: 'invoice-report',
        chain: ['stripe/list_invoices', 'notion/API-post-page'],
        accomplishes: 'pull stripe invoices and post a finance report to notion',
        verified: true,
      },
      {
        name: 'tax-summary',
        chain: ['stripe/list_charges', 'fs/write_file'],
        accomplishes: 'aggregate stripe charges into a tax summary file',
        verified: false,
      },
    ],
    prompts: [
      { text: 'List all unpaid invoices from Stripe', resolves_to: 'stripe/list_invoices' },
      { text: 'Generate a monthly finance report',    resolves_to: 'stripe/list_charges' },
    ],
  },
  ops: {
    description: 'Ops focus',
    combos: [
      {
        name: 'deploy-check',
        chain: ['cloudflare-builds/workers_builds_list', 'fs/read_file'],
        accomplishes: 'list cloudflare deployments and read a local log file',
        verified: true,
      },
    ],
    prompts: [
      { text: 'Check the latest deployment status', resolves_to: 'cloudflare-builds/workers_builds_list' },
    ],
  },
};

const TOOL_LIST: ToolEntry[] = [
  { name: 'list_invoices', description: 'List Stripe invoices for billing and finance reporting', inputSchema: { type: 'object', properties: {} } },
  { name: 'run_report',    description: 'Generate a financial summary report',                    inputSchema: { type: 'object', properties: {} } },
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

// ── 1. search with focus + query includes suggestions ─────────────────────────

test('search: focus + query includes catalog suggestions', async () => {
  const path = dlqPath('focus-query');
  const agg = new Aggregator([SERVER_CFG], {
    backendFactory: () => makeStaticBackend(TOOL_LIST),
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: SEARCH_CATALOG,
    focus: 'finance',
  });

  try {
    const result = await agg.callTool('ch1tty/search', { query: 'invoice finance report' });
    assert.equal(result.isError, undefined);

    const data = JSON.parse(result.content[0].text as string);
    assert.equal(data.focus, 'finance', 'focus name reported');
    assert.ok(data.suggestions, 'suggestions field present');
    assert.ok(Array.isArray(data.suggestions.combos) && data.suggestions.combos.length > 0, 'combos present');
    assert.ok(Array.isArray(data.suggestions.prompts) && data.suggestions.prompts.length > 0, 'prompts present');
    assert.ok(Array.isArray(data.tools) && data.tools.length > 0, 'tools still present');
  } finally {
    await agg.shutdown();
  }
});

// ── 2. search without focus does NOT include suggestions ──────────────────────

test('search: no focus means no suggestions field', async () => {
  const path = dlqPath('no-focus');
  const agg = new Aggregator([SERVER_CFG], {
    backendFactory: () => makeStaticBackend(TOOL_LIST),
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: SEARCH_CATALOG,
  });

  try {
    const result = await agg.callTool('ch1tty/search', { query: 'invoice finance report' });
    assert.equal(result.isError, undefined);

    const data = JSON.parse(result.content[0].text as string);
    assert.equal(data.focus, undefined, 'no focus field');
    assert.equal(data.suggestions, undefined, 'no suggestions field without focus');
    assert.ok(Array.isArray(data.tools), 'tools still returned');
  } finally {
    await agg.shutdown();
  }
});

// ── 3. search with focus but no query does NOT include suggestions ─────────────

test('search: focus + no query returns server summary without suggestions', async () => {
  const path = dlqPath('focus-noquery');
  const agg = new Aggregator([SERVER_CFG], {
    backendFactory: () => makeStaticBackend(TOOL_LIST),
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: SEARCH_CATALOG,
    focus: 'finance',
  });

  try {
    // No query → server summary path, not tool-match path
    const result = await agg.callTool('ch1tty/search', {});
    assert.equal(result.isError, undefined);

    const data = JSON.parse(result.content[0].text as string);
    assert.equal(data.focus, 'finance', 'focus reported');
    assert.equal(data.suggestions, undefined, 'no suggestions without a query');
    assert.ok(typeof data.hint === 'string', 'server summary hint present');
    assert.ok(Array.isArray(data.servers), 'servers list present (server summary mode)');
  } finally {
    await agg.shutdown();
  }
});

// ── 4. suggestions are ranked by intent relevance ─────────────────────────────

test('search: suggestions ranked by query relevance', async () => {
  const path = dlqPath('ranked');
  const agg = new Aggregator([SERVER_CFG], {
    backendFactory: () => makeStaticBackend(TOOL_LIST),
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: SEARCH_CATALOG,
    focus: 'finance',
  });

  try {
    // "tax" appears only in combo "tax-summary" (name + accomplishes) — should rank first
    const result = await agg.callTool('ch1tty/search', { query: 'tax charges summary' });
    assert.equal(result.isError, undefined);

    const data = JSON.parse(result.content[0].text as string);
    assert.ok(data.suggestions, 'suggestions present');
    assert.ok(data.suggestions.combos.length > 0, 'combos present');
    assert.equal(data.suggestions.combos[0].name, 'tax-summary', 'tax-summary combo ranked first');
  } finally {
    await agg.shutdown();
  }
});

// ── 5. per-call focus=none suppresses suggestions ─────────────────────────────

test('search: per-call focus=none suppresses suggestions even with env focus', async () => {
  const path = dlqPath('percall-none');
  const agg = new Aggregator([SERVER_CFG], {
    backendFactory: () => makeStaticBackend(TOOL_LIST),
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: SEARCH_CATALOG,
    focus: 'finance',
  });

  try {
    const result = await agg.callTool('ch1tty/search', { query: 'invoice report', focus: 'none' });
    assert.equal(result.isError, undefined);

    const data = JSON.parse(result.content[0].text as string);
    assert.equal(data.focus, undefined, 'focus cleared by per-call none');
    assert.equal(data.suggestions, undefined, 'no suggestions when focus overridden to none');
  } finally {
    await agg.shutdown();
  }
});
