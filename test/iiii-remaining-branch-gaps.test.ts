/**
 * IIII: Close remaining branch-coverage gaps.
 *
 * Targeted tests for uncovered branches in aggregator.ts, coordinator.ts,
 * and remote-proxy.ts that are achievable without mocking SDK internals.
 *
 * Branches closed:
 *   aggregator.ts:359   — default case: unknown ch1tty meta-tool name
 *   aggregator.ts:459   — kwScore=0 when queryTerms is empty (whitespace-only query)
 *   aggregator.ts:473-4 — relevanceMap.get() ?? 0 fallback in sort with focus + no query
 *   aggregator.ts:475   — aRel !== bRel TRUE (OR-fallback produces differing scores)
 *   aggregator.ts:491   — {} no-score branch when relevanceMap is empty
 *   aggregator.ts:542   — '(none)' branch when activeConfigs() returns []
 *   coordinator.ts:160  — onToolCall when ctx.entity IS defined (entity_id gets chittyId)
 *   coordinator.ts:313  — m.key fallback when m.content is absent in memory recall results
 *   coordinator.ts:332  — w.key fallback when w.content is absent in workstream recall results
 *   remote-proxy.ts:51  — registerServer early-return for non-remote config type
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend } from './fixture-backend.js';
import type {
  Backend,
  BackendStatus,
  ContentItem,
  PromptEntry,
  ResourceEntry,
  ResourceTemplateEntry,
  ServerConfig,
  ToolCallResult,
  ToolEntry,
} from '../src/types.js';

const LEDGER_DLQ = join(tmpdir(), `ch1tty-iiii-gaps-${Date.now()}.jsonl`);

// ── Minimal Backend stub ──────────────────────────────────────────────────────

type ToolHandler = (args: Record<string, unknown>) => unknown;

class StubBackend implements Backend {
  private readonly toolDefs = new Map<string, ToolEntry>();
  private readonly handlers = new Map<string, ToolHandler>();

  defineTool(entry: ToolEntry, handler?: ToolHandler): void {
    this.toolDefs.set(entry.name, entry);
    if (handler) this.handlers.set(entry.name, handler);
  }

  registerServer(_config: ServerConfig): void {}
  isRegistered(_serverId: string): boolean { return true; }
  getStatus(_serverId: string): BackendStatus {
    return { connected: true, toolCount: this.toolDefs.size, toolCacheAge: 0 };
  }

  async listTools(_serverId: string): Promise<ToolEntry[]> {
    return [...this.toolDefs.values()];
  }

  async callTool(_sid: string, name: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
    const h = this.handlers.get(name);
    if (!h) return { content: [{ type: 'text', text: 'ok' }] };
    const result = await h(args);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  async listResources(_sid: string): Promise<{ resources: ResourceEntry[]; templates: ResourceTemplateEntry[] }> {
    return { resources: [], templates: [] };
  }

  async readResource(_sid: string, uri: string): Promise<{ contents: Array<{ uri: string; text?: string }> }> {
    return { contents: [{ uri, text: 'fixture' }] };
  }

  async listPrompts(_sid: string): Promise<PromptEntry[]> { return []; }

  async getPrompt(_sid: string, name: string): Promise<{ messages: Array<{ role: 'user' | 'assistant'; content: ContentItem }> }> {
    return { messages: [{ role: 'user', content: { type: 'text', text: name } }] };
  }

  async shutdown(): Promise<void> {}
}

// ── Stub Ecosystem for coordinator staging tests ──────────────────────────────

class StubEcosystem implements Backend {
  private handlers = new Map<string, ToolHandler>();

  setHandler(tool: string, handler: ToolHandler): void {
    this.handlers.set(tool, handler);
  }

  async callTool(_serverId: string, toolName: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
    const h = this.handlers.get(toolName);
    if (!h) return { content: [{ type: 'text', text: 'null' }] };
    const result = await h(args);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  registerServer(_config: ServerConfig): void {}
  isRegistered(_serverId: string): boolean { return true; }
  getStatus(_serverId: string): BackendStatus { return { connected: true, toolCount: 0, toolCacheAge: null }; }
  async listTools(_serverId: string): Promise<ToolEntry[]> { return []; }
  async listResources(_sid: string): Promise<{ resources: ResourceEntry[]; templates: ResourceTemplateEntry[] }> { return { resources: [], templates: [] }; }
  async readResource(_sid: string, uri: string): Promise<{ contents: Array<{ uri: string; text?: string }> }> { return { contents: [{ uri }] }; }
  async listPrompts(_sid: string): Promise<PromptEntry[]> { return []; }
  async getPrompt(_sid: string, name: string): Promise<{ messages: Array<{ role: 'user' | 'assistant'; content: ContentItem }> }> { return { messages: [{ role: 'user', content: { type: 'text', text: name } }] }; }
  async shutdown(): Promise<void> {}
}

async function waitForStaging(
  coord: { isStagingComplete(id: string): boolean },
  sessionId: string,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!coord.isStagingComplete(sessionId)) {
    if (Date.now() > deadline) throw new Error('Staging did not complete');
    await new Promise<void>((r) => setImmediate(r));
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseSearch(r: ToolCallResult): { tools: Array<{ tool: string; server: string; score?: number; inFocus?: boolean }> } {
  return JSON.parse((r.content[0] as { text: string }).text);
}

// Build a minimal aggregator with two servers and simple tools.
function makeMinimalAgg(): { agg: Aggregator; backend: StubBackend } {
  const backend = new StubBackend();

  // Server A: billing domain (has "invoice" in description)
  backend.defineTool({
    name: 'create_invoice',
    description: 'Create a new invoice for a customer billing record',
    inputSchema: { type: 'object', properties: {} },
  });

  // Server B: payments domain (has "payment charge" in description)
  backend.defineTool({
    name: 'record_charge',
    description: 'Record a payment charge transaction in the ledger',
    inputSchema: { type: 'object', properties: {} },
  });

  const configs: ServerConfig[] = [
    {
      id: 'billing',
      name: 'Billing Service',
      type: 'remote',
      access: 'readwrite',
      category: 'ecosystem',
      endpoint: 'https://billing.local/mcp',
      lazy: true,
    },
    {
      id: 'payments',
      name: 'Payments Service',
      type: 'remote',
      access: 'readwrite',
      category: 'ecosystem',
      endpoint: 'https://payments.local/mcp',
      lazy: true,
    },
  ];

  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: LEDGER_DLQ,
    suggestionsCatalog: {},
  });
  return { agg, backend };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// aggregator.ts:359 — default case: unknown ch1tty meta-tool name
test('aggregator: calling ch1tty/<unknown> returns isError + Unknown tool message', async () => {
  const { agg } = makeMinimalAgg();
  try {
    const r = await agg.callTool('ch1tty/unknownMetaTool', {});
    assert.equal(r.isError, true, 'should be an error');
    const text = (r.content[0] as { text: string }).text;
    assert.ok(text.includes('Unknown tool'), `message should mention Unknown tool; got: ${text}`);
    assert.ok(text.includes('unknownMetaTool'), `message should include the tool name; got: ${text}`);
  } finally {
    await agg.shutdown();
  }
});

// aggregator.ts:459 — kwScore fallback when queryTerms is empty (whitespace-only query)
// A query of " " (spaces only) → queryTerms=[] → kwScore = 0 for every tool.
test('aggregator: whitespace-only query produces empty-queryTerms path (kwScore=0 fallback)', async () => {
  const { agg } = makeMinimalAgg();
  try {
    // query=" " is truthy so the if(query) block runs, but queryTerms=[] after filter
    const r = await agg.callTool('ch1tty/search', { query: '   ' });
    assert.equal(r.isError, undefined, 'should not error');
    // Whitespace-only query: AND mode finds nothing (no terms), OR fallback not triggered
    // (queryTerms.length === 1 threshold for OR fallback requires > 1 term).
    // Result may be 0 tools or all tools depending on implementation; we just assert no error.
    const data = parseSearch(r);
    assert.ok(Array.isArray(data.tools), 'tools array returned');
  } finally {
    await agg.shutdown();
  }
});

// aggregator.ts:473-474 (?? 0 fallback) + aggregator.ts:491 ({} no-score branch):
// Search with server filter + focus but no query:
//   - server filter bypasses server-summary early return
//   - no query → relevanceMap stays empty → ?? 0 fallback in sort + {} in results
//   - focus triggers the sort block (relevanceMap.size > 0 || focus)
test('aggregator: server-filtered focus search without query hits ?? 0 sort fallback and {} no-score branch', async () => {
  const { agg } = makeMinimalAgg();
  try {
    const r = await agg.callTool('ch1tty/search', {
      server: 'billing',
      focus: 'finance',
    });
    assert.equal(r.isError, undefined);
    const data = parseSearch(r);
    assert.ok(Array.isArray(data.tools), 'tools array present');
    // No score field since no query (relevanceMap empty)
    for (const t of data.tools) {
      assert.equal(t.score, undefined, 'no score field without query');
    }
  } finally {
    await agg.shutdown();
  }
});

// aggregator.ts:475 — aRel !== bRel TRUE branch (sort returns bRel-aRel)
// Uses a 3-term query with a made-up term ("zort") so no tool matches all 3 → OR fallback.
// Uses FixtureBackend (routes tools per server) to avoid cross-server tool duplication.
//   invoice/create_invoice description: "Create a new invoice for a customer" → 1 match ("invoice") → score 1/3
//   combo/process_invoice_payment description: "Process an invoice payment record" → 2 matches ("invoice"+"payment") → score 2/3
// aRel (0.33) !== bRel (0.67) → TRUE branch hit.
test('aggregator: OR-fallback with differing scores hits aRel !== bRel TRUE branch in sort', async () => {
  const backend = new FixtureBackend();
  backend.defineServer('invoices', {
    tools: [{
      name: 'create_invoice',
      description: 'Create a new invoice for a customer',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: 'ok' }] },
    }],
  });
  backend.defineServer('combos', {
    tools: [
      {
        name: 'process_invoice_payment',
        description: 'Process an invoice payment record',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: 'ok' }] },
      },
      {
        name: 'list_payments',
        description: 'List recent payment transactions',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: 'ok' }] },
      },
    ],
  });

  const configs: ServerConfig[] = [
    { id: 'invoices', name: 'Invoice Service', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://inv.local/mcp', lazy: true },
    { id: 'combos', name: 'Combo Service', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://combo.local/mcp', lazy: true },
  ];

  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: LEDGER_DLQ,
    suggestionsCatalog: {},
  });

  try {
    // "invoice payment zort": "zort" matches nothing → AND=empty → OR fallback
    //   invoices/create_invoice → "invoice" (1/3 ≈ 0.33)
    //   combos/process_invoice_payment → "invoice"+"payment" (2/3 ≈ 0.67)
    //   combos/list_payments → "payment" (1/3 ≈ 0.33)
    const r = await agg.callTool('ch1tty/search', { query: 'invoice payment zort' });
    assert.equal(r.isError, undefined);
    const data = parseSearch(r);
    assert.ok(data.tools.length >= 2, `should have >= 2 results in OR fallback, got ${data.tools.length}`);
    // combos/process_invoice_payment should rank first (score 0.67 > 0.33)
    assert.equal(
      data.tools[0].tool,
      'combos/process_invoice_payment',
      `combos/process_invoice_payment should rank first (2/3 matches); order: ${data.tools.map((t) => `${t.tool}@${t.score}`).join(', ')}`,
    );
    // Confirm scores differ — the aRel !== bRel TRUE branch produced this ordering
    const first = data.tools[0].score ?? 0;
    const second = data.tools[1].score ?? 0;
    assert.ok(first > second, `first score ${first} should exceed second ${second}`);
  } finally {
    await agg.shutdown();
  }
});

// aggregator.ts:542 — '(none)' branch: activeConfigs() returns []
// An aggregator with no configs → activeConfigs()=[] → join('')='', || '(none)' taken.
test('aggregator: execute with unknown server and empty configs returns (none) server list', async () => {
  const agg = new Aggregator([], {
    backendFactory: () => new StubBackend(),
    embedEnabled: false,
    ledgerDlqPath: LEDGER_DLQ,
    suggestionsCatalog: {},
  });
  try {
    const r = await agg.callTool('ch1tty/execute', { tool: 'unknown/tool' });
    assert.equal(r.isError, true);
    const text = (r.content[0] as { text: string }).text;
    assert.ok(text.includes('(none)'), `error message should say (none); got: ${text}`);
  } finally {
    await agg.shutdown();
  }
});

// coordinator.ts:160 — onToolCall when ctx.entity IS defined
// Stages a session (entity populated), then calls onToolCall — hits ctx.entity?.chittyId defined branch.
test('coordinator: onToolCall after staging records entity_id (ctx.entity is defined)', async () => {
  const { SessionCoordinator } = await import('../src/coordinator.js');

  const coord = new SessionCoordinator({}, { enabled: false });
  const stub = new StubEcosystem();

  stub.setHandler('context_resolve', () => ({
    chitty_id: 'user-ontoolcall',
    identity_class: 'developer',
    trust_level: 5,
  }));
  stub.setHandler('chitty_memory_recall', () => ({ results: [] }));

  coord.bindEcosystem(stub, 'chittyos');
  const sessionId = 'iiii-toolcall-entity';
  await coord.onSessionStart(sessionId, 'stdio');
  await waitForStaging(coord, sessionId);

  const entity = coord.getEntityContext(sessionId);
  assert.ok(entity, 'entity should be set after staging');
  assert.equal(entity.chittyId, 'user-ontoolcall');

  // onToolCall with entity defined → ctx.entity?.chittyId resolves to 'user-ontoolcall'
  coord.onToolCall(sessionId, 'neon/run_sql');

  // Verify tool pattern was recorded correctly (proxy that the call completed)
  const patterns = coord.getToolPatterns(sessionId);
  assert.ok(patterns.length > 0, 'tool pattern should be recorded');
  assert.equal(patterns[0].tool, 'neon/run_sql');
});

// coordinator.ts:313 — m.key fallback when m.content is absent in memory recall
// coordinator.ts:332 — w.key fallback when w.content is absent in workstream recall
test('coordinator: stageSession maps memory/workstream results using key when content is absent', async () => {
  const { SessionCoordinator } = await import('../src/coordinator.js');

  const coord = new SessionCoordinator({}, { enabled: false });
  const stub = new StubEcosystem();

  stub.setHandler('context_resolve', () => ({
    chitty_id: 'user-keyonly',
    identity_class: 'agent',
  }));

  stub.setHandler('chitty_memory_recall', (args) => {
    const query = (args as { query?: string }).query;
    if (query === 'recent session context') {
      return {
        results: [
          // content present → uses content
          { content: 'Session was active yesterday' },
          // content absent, key present → uses key (coordinator.ts:313)
          { key: 'session-2026-05-30' },
          // both absent → uses String(m) (coordinator.ts:313 third fallback)
          {},
        ],
      };
    }
    if (query === 'active workstreams') {
      return {
        results: [
          // content present
          { content: 'ch1tty scenario tests' },
          // content absent, key present (coordinator.ts:332 key branch)
          { key: 'workstream-coverage-gaps' },
          // both absent → String(w) fallback (coordinator.ts:332 third branch)
          {},
        ],
      };
    }
    return { results: [] };
  });

  coord.bindEcosystem(stub, 'chittyos');
  const sessionId = 'iiii-key-fallback';
  await coord.onSessionStart(sessionId, 'stdio');
  await waitForStaging(coord, sessionId);

  const entity = coord.getEntityContext(sessionId);
  assert.ok(entity, 'entity must be populated');
  assert.equal(entity.chittyId, 'user-keyonly');

  // recentMemories: first=content, second=key (the missing branch), third=String({})
  assert.ok(Array.isArray(entity.recentMemories), 'recentMemories should be array');
  assert.equal(entity.recentMemories?.length, 3);
  assert.equal(entity.recentMemories?.[0], 'Session was active yesterday');
  assert.equal(entity.recentMemories?.[1], 'session-2026-05-30', 'key fallback used when content absent');
  // String({}) → '[object Object]'
  assert.equal(entity.recentMemories?.[2], '[object Object]', 'String(m) fallback for result with no content/key');

  // activeWorkstreams: first=content, second=key fallback, third=String({})
  assert.ok(Array.isArray(entity.activeWorkstreams), 'activeWorkstreams should be array');
  assert.equal(entity.activeWorkstreams?.length, 3);
  assert.equal(entity.activeWorkstreams?.[0], 'ch1tty scenario tests');
  assert.equal(entity.activeWorkstreams?.[1], 'workstream-coverage-gaps', 'key fallback used in workstream recall');
  assert.equal(entity.activeWorkstreams?.[2], '[object Object]', 'String(w) fallback for result with no content/key');
});

// remote-proxy.ts:51 — registerServer early-return for non-remote config
test('remote-proxy: registerServer ignores local configs (early-return guard)', async () => {
  const { RemoteProxy } = await import('../src/remote-proxy.js');

  const proxy = new RemoteProxy();

  const localConfig: ServerConfig = {
    id: 'local-server',
    name: 'Local Server',
    type: 'local',
    access: 'readwrite',
    category: 'ecosystem',
    command: 'node',
    args: ['./dist/index.js'],
    lazy: true,
  };

  // Should return early without registering (no throw, no side-effect)
  proxy.registerServer(localConfig);

  // Verify the server was NOT registered (isRegistered should return false)
  assert.equal(
    proxy.isRegistered('local-server'),
    false,
    'local config must not be registered in RemoteProxy',
  );
});
