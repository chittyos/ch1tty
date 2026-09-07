/**
 * Workstream X — documents focus profile scenarios.
 *
 * Validates the documents focus profile:
 *  - notion/ and context7/ tools are boosted in search ranking (lens, not gate)
 *  - cast resolves document-management intents to notion/ or context7/ tools
 *  - out-of-focus tools remain reachable when documents focus is active
 *  - multi-step document → library-docs workflows execute via the fixture backend
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

const DOCUMENTS_FOCUS_PROFILES = {
  profiles: {
    documents: {
      description: 'Document creation, search, and knowledge management — Notion pages/databases, library docs via Context7, PDF processing, and collaborative notes',
      categories: ['documents' as const],
      servers: ['notion', 'context7', 'pdf', 'notes'],
      boost: 0.6,
    },
    code: {
      description: 'Software development',
      categories: ['code' as const],
      servers: ['github', 'neon'],
      boost: 0.5,
    },
  },
};

const FIXTURE_CONFIGS: ServerConfig[] = [
  { id: 'notion', name: 'Notion', type: 'remote', access: 'readwrite', category: 'documents', endpoint: 'https://fixture.notion' },
  { id: 'context7', name: 'Context7', type: 'local', access: 'read', category: 'documents', command: 'node', args: ['context7'] },
  { id: 'github', name: 'GitHub', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.github' },
  { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.neon' },
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'read', category: 'ecosystem', endpoint: 'https://fixture.stripe' },
  { id: 'ledger', name: 'ChittyLedger', type: 'local', access: 'readwrite', category: 'ecosystem', command: 'node', args: ['./apps/ledger-mcp/dist/index.js'] },
];

type SearchResult = { tools?: Array<{ tool: string; score?: number; inFocus?: boolean }>; focus?: string };
type CastResult = Record<string, unknown>;

function parseSearch(result: { content: Array<{ type: string; text?: string }> }): SearchResult {
  return JSON.parse(result.content[0]?.text ?? '{}') as SearchResult;
}

function parseCast(result: { content: Array<{ type: string; text?: string }> }): CastResult {
  return JSON.parse(result.content[0]?.text ?? '{}') as CastResult;
}

function buildAggregator(focus?: string): { aggregator: Aggregator; fixture: FixtureBackend } {
  const fixture = new FixtureBackend();
  for (const [id, def] of Object.entries(FIXTURE_SERVERS)) {
    fixture.defineServer(id, def);
  }
  const aggregator = new Aggregator(FIXTURE_CONFIGS, {
    focusProfiles: DOCUMENTS_FOCUS_PROFILES,
    focus,
    embedEnabled: false,
    backendFactory: (config) => {
      fixture.registerServer(config);
      return fixture;
    },
  });
  return { aggregator, fixture };
}

test('documents focus: search "search" ranks notion/ tools above github/ (in-focus before out-of-focus)', async () => {
  const { aggregator } = buildAggregator('documents');

  // "search" matches both notion/search (in-focus, documents) and github/search_code (out-of-focus, code),
  // guaranteeing a mix that exercises the ranking assertion.
  const result = await aggregator.callTool('ch1tty/search', { query: 'search', limit: 20 });
  assert.equal(result.isError, undefined, 'search should not error');

  const parsed = parseSearch(result);
  const tools = parsed.tools ?? [];
  assert.ok(tools.length > 0, 'should return results');

  const notionIdx = tools.findIndex((r) => r.tool.startsWith('notion/'));
  // Out-of-focus tools have inFocus omitted (undefined), not set to false — use !== true.
  const outOfFocusIdx = tools.findIndex((r) => r.inFocus !== true);

  assert.ok(notionIdx !== -1, 'notion/ tools should appear in results');
  assert.ok(outOfFocusIdx !== -1, 'at least one out-of-focus tool should be present (github/search_code matches "search")');
  assert.ok(notionIdx < outOfFocusIdx, 'notion/ tools should rank above out-of-focus tools when documents focus is active');
  assert.equal(parsed.focus, 'documents', 'search response should report active focus');
});

test('documents focus: search "library documentation" includes context7/query-docs', async () => {
  const { aggregator } = buildAggregator('documents');

  const result = await aggregator.callTool('ch1tty/search', { query: 'library documentation', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t === 'context7/query-docs'), 'context7/query-docs must appear in results');
});

test('documents focus: search "create page" includes notion/create_page', async () => {
  const { aggregator } = buildAggregator('documents');

  const result = await aggregator.callTool('ch1tty/search', { query: 'create page', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t === 'notion/create_page'), 'notion/create_page must appear in results');
});

test('documents focus: search "search notes" includes notion/search', async () => {
  const { aggregator } = buildAggregator('documents');

  const result = await aggregator.callTool('ch1tty/search', { query: 'search notes', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t === 'notion/search'), 'notion/search must appear in results');
});

test('documents focus: out-of-focus tools (github) remain reachable via search', async () => {
  const { aggregator } = buildAggregator('documents');

  const result = await aggregator.callTool('ch1tty/search', { query: 'pull request', limit: 20 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('github/')), 'github/ tools must remain reachable with documents focus active');
});

test('documents focus: no focus — notion tools still accessible (lens not gate)', async () => {
  const { aggregator } = buildAggregator(); // no focus

  const result = await aggregator.callTool('ch1tty/search', { query: 'notion page document', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('notion/')), 'notion/ tools must be reachable without any focus');
});

test('documents focus: execute notion/search returns fixture page results', async () => {
  const { aggregator, fixture } = buildAggregator('documents');
  fixture.clearCallLog();

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'notion/search',
    args: { query: 'architecture' },
  });
  assert.equal(result.isError, undefined, 'execute should succeed');

  const body = JSON.parse(result.content[0].text as string) as { results: Array<{ id: string; title: string }> };
  assert.ok(Array.isArray(body.results), 'should return a results array');
  assert.ok(body.results.length > 0, 'fixture should return at least one result');
  assert.ok(body.results[0]?.id, 'each result should have an id');

  const calls = fixture.getCallLog();
  assert.ok(calls.some((c) => c.serverId === 'notion' && c.tool === 'search'), 'notion/search must be in call log');
});

test('documents focus: execute context7/query-docs returns documentation snippets', async () => {
  const { aggregator, fixture } = buildAggregator('documents');
  fixture.clearCallLog();

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'context7/query-docs',
    args: { libraryId: '/modelcontextprotocol/typescript-sdk', query: 'server setup' },
  });
  assert.equal(result.isError, undefined, 'execute should succeed');

  const body = JSON.parse(result.content[0].text as string) as { libraryId: string; snippets: unknown[] };
  assert.ok(body.libraryId, 'should return a libraryId');
  assert.ok(Array.isArray(body.snippets), 'should return a snippets array');
  assert.ok(body.snippets.length > 0, 'fixture should return at least one snippet');

  const calls = fixture.getCallLog();
  assert.ok(calls.some((c) => c.serverId === 'context7' && c.tool === 'query-docs'), 'context7/query-docs must be in call log');
});

test('documents focus: multi-step — resolve library id then query docs', async () => {
  const { aggregator, fixture } = buildAggregator('documents');
  const sessionId = 'documents-scenario-001';
  fixture.clearCallLog();

  // Step 1: resolve library ID
  const resolveResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'context7/resolve-library-id',
    args: { libraryName: '@modelcontextprotocol/sdk' },
  }, sessionId);
  assert.equal(resolveResult.isError, undefined, 'resolve-library-id should succeed');
  const { libraryId } = JSON.parse(resolveResult.content[0].text as string) as { libraryId: string; name: string };
  assert.ok(libraryId, 'should return a libraryId');

  // Step 2: query docs for the resolved library
  const docsResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'context7/query-docs',
    args: { libraryId, query: 'tool registration' },
  }, sessionId);
  assert.equal(docsResult.isError, undefined, 'query-docs should succeed');
  const docs = JSON.parse(docsResult.content[0].text as string) as { snippets: unknown[] };
  assert.ok(Array.isArray(docs.snippets), 'should return snippets array');

  const calls = fixture.getCallLog();
  const toolNames = calls.map((c) => `${c.serverId}/${c.tool}`);
  assert.ok(toolNames.includes('context7/resolve-library-id'), 'resolve-library-id must be in call log');
  assert.ok(toolNames.includes('context7/query-docs'), 'query-docs must be in call log');
});

test('documents focus: execute notion/create_page returns new page id and url', async () => {
  const { aggregator } = buildAggregator('documents');

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'notion/create_page',
    args: { title: 'Architecture Decision Record 001', content: 'We chose the slim-MCP pattern.' },
  });
  assert.equal(result.isError, undefined, 'create_page should succeed');

  const created = JSON.parse(result.content[0].text as string) as { id: string; url: string };
  assert.ok(created.id, 'created page should have an id');
  assert.ok(created.url, 'created page should have a url');
});

test('documents focus: status reports active focus as documents', async () => {
  const { aggregator } = buildAggregator('documents');

  const result = await aggregator.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined);

  const status = JSON.parse(result.content[0].text as string) as { focus?: { active?: string } };
  assert.equal(status.focus?.active, 'documents', 'status must report documents as active focus');
});

test('documents focus: cast "find docs about MCP" with confirm resolves to notion/ or context7/ tool', async () => {
  const { aggregator } = buildAggregator('documents');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'find docs about MCP server setup',
    confirm: true,
  });
  assert.equal(result.isError, undefined, 'cast should not error');

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string; score: number } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  const isDocumentsTool = resolved.tool.startsWith('notion/') || resolved.tool.startsWith('context7/');
  assert.ok(isDocumentsTool, `cast should resolve to notion/ or context7/, got: ${resolved.tool}`);
  assert.equal(cast.focus, 'documents', 'cast response should report active focus');
});
