/**
 * Workstream W — search focus profile scenarios.
 *
 * Validates the `search` focus profile:
 *  - evidence/ and scrape/ tools are boosted in search ranking (lens, not gate)
 *  - cast resolves web-search and scraping intents to the right tools
 *  - out-of-focus tools remain reachable when search focus is active
 *  - multi-step research workflows execute correctly via the fixture backend
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

const SEARCH_FOCUS_PROFILES = {
  profiles: {
    search: {
      description: 'Web and document search — query the evidence index, scrape pages, extract content, and surface research findings',
      categories: ['search' as const],
      servers: ['evidence', 'scrape', 'contextual'],
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
  { id: 'evidence', name: 'Evidence Search', type: 'remote', access: 'read', category: 'search', endpoint: 'https://fixture.evidence' },
  { id: 'scrape', name: 'Scrape', type: 'local', access: 'read', category: 'ecosystem', command: 'node', args: ['./dist/scrape.js'] },
  { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.neon' },
  { id: 'github', name: 'GitHub', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.github' },
  { id: 'fs', name: 'Filesystem', type: 'local', access: 'readwrite', category: 'desktop', command: 'node', args: ['./dist/fs.js'] },
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
    focusProfiles: SEARCH_FOCUS_PROFILES,
    focus,
    embedEnabled: false,
    backendFactory: (config) => {
      fixture.registerServer(config);
      return fixture;
    },
  });
  return { aggregator, fixture };
}

test('search focus: search "find information web" ranks evidence/ tools first', async () => {
  const { aggregator } = buildAggregator('search');

  const result = await aggregator.callTool('ch1tty/search', { query: 'find information web', limit: 10 });
  assert.equal(result.isError, undefined, 'search should not error');

  const parsed = parseSearch(result);
  const tools = parsed.tools ?? [];
  assert.ok(tools.length > 0, 'should return results');

  const evidenceIdx = tools.findIndex((r) => r.tool.startsWith('evidence/'));
  const otherIdx = tools.findIndex((r) => !r.tool.startsWith('evidence/') && !r.tool.startsWith('scrape/'));

  assert.ok(evidenceIdx !== -1, 'evidence/ tools should appear in results');
  if (otherIdx !== -1) {
    assert.ok(evidenceIdx < otherIdx, 'evidence/ tools should rank above out-of-focus tools for web search query');
  }
  assert.equal(parsed.focus, 'search', 'search response should report active focus');
});

test('search focus: search "search web" includes evidence/search_web', async () => {
  const { aggregator } = buildAggregator('search');

  const result = await aggregator.callTool('ch1tty/search', { query: 'search web', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t === 'evidence/search_web'), 'evidence/search_web must appear in results');
});

test('search focus: search "scrape page" includes scrape/scrape_page', async () => {
  const { aggregator } = buildAggregator('search');

  const result = await aggregator.callTool('ch1tty/search', { query: 'scrape page', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t === 'scrape/scrape_page'), 'scrape/scrape_page must appear in results');
});

test('search focus: out-of-focus tools (neon) remain reachable via search', async () => {
  const { aggregator } = buildAggregator('search');

  const result = await aggregator.callTool('ch1tty/search', { query: 'database query', limit: 20 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('neon/')), 'neon/ tools must remain reachable with search focus active');
});

test('search focus: no focus — evidence/ tools still accessible (lens not gate)', async () => {
  const { aggregator } = buildAggregator();

  const result = await aggregator.callTool('ch1tty/search', { query: 'search web evidence', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('evidence/')), 'evidence/ tools must be reachable without any focus');
});

test('search focus: execute evidence/search_web returns results', async () => {
  const { aggregator, fixture } = buildAggregator('search');
  fixture.clearCallLog();

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'evidence/search_web',
    args: { query: 'MCP gateway' },
  });
  assert.equal(result.isError, undefined, 'execute should succeed');

  const parsed = JSON.parse(result.content[0].text as string) as { results: Array<{ url: string; title: string }>; total: number };
  assert.ok(Array.isArray(parsed.results), 'should return results array');
  assert.ok(parsed.results.length > 0, 'fixture should return at least one result');
  assert.ok(typeof parsed.total === 'number', 'should include a total count');

  const calls = fixture.getCallLog();
  assert.ok(calls.some((c) => c.serverId === 'evidence' && c.tool === 'search_web'), 'evidence/search_web must be in call log');
});

test('search focus: execute scrape/scrape_page returns page content', async () => {
  const { aggregator, fixture } = buildAggregator('search');
  fixture.clearCallLog();

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'scrape/scrape_page',
    args: { url: 'https://example.com/article-1' },
  });
  assert.equal(result.isError, undefined, 'execute should succeed');

  const parsed = JSON.parse(result.content[0].text as string) as { url: string; text: string; status: number };
  assert.ok(parsed.url, 'should return url');
  assert.ok(parsed.text, 'should return page text content');
  assert.equal(parsed.status, 200, 'should return HTTP 200 status');

  const calls = fixture.getCallLog();
  assert.ok(calls.some((c) => c.serverId === 'scrape' && c.tool === 'scrape_page'), 'scrape/scrape_page must be in call log');
});

test('search focus: execute scrape/extract_links returns link list', async () => {
  const { aggregator } = buildAggregator('search');

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'scrape/extract_links',
    args: { url: 'https://example.com/article-1' },
  });
  assert.equal(result.isError, undefined, 'execute should succeed');

  const parsed = JSON.parse(result.content[0].text as string) as { links: Array<{ href: string }>; total: number };
  assert.ok(Array.isArray(parsed.links), 'should return links array');
  assert.ok(parsed.links.length > 0, 'fixture should return at least one link');
  assert.ok(typeof parsed.total === 'number', 'should include a total count');
});

test('search focus: multi-step — search web then get full content', async () => {
  const { aggregator, fixture } = buildAggregator('search');
  const sessionId = 'search-scenario-001';
  fixture.clearCallLog();

  // Step 1: search the web
  const searchResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'evidence/search_web',
    args: { query: 'MCP protocol' },
  }, sessionId);
  assert.equal(searchResult.isError, undefined, 'search_web should succeed');
  const searchParsed = JSON.parse(searchResult.content[0].text as string) as { results: Array<{ url: string }> };
  assert.ok(searchParsed.results.length > 0, 'search should return results');

  // Step 2: get full content of the top result
  const topUrl = searchParsed.results[0]!.url;
  const contentResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'scrape/get_content',
    args: { url: topUrl },
  }, sessionId);
  assert.equal(contentResult.isError, undefined, 'get_content should succeed');
  const contentParsed = JSON.parse(contentResult.content[0].text as string) as { content: string; word_count: number };
  assert.ok(contentParsed.content, 'should return page content');
  assert.ok(typeof contentParsed.word_count === 'number', 'should include word count');

  const calls = fixture.getCallLog();
  const toolNames = calls.map((c) => `${c.serverId}/${c.tool}`);
  assert.ok(toolNames.includes('evidence/search_web'), 'evidence/search_web must be in call log');
  assert.ok(toolNames.includes('scrape/get_content'), 'scrape/get_content must be in call log');
});

test('search focus: status reports active focus as search', async () => {
  const { aggregator } = buildAggregator('search');

  const result = await aggregator.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined);

  const status = JSON.parse(result.content[0].text as string) as { focus?: { active?: string } };
  assert.equal(status.focus?.active, 'search', 'status must report search as active focus');
});

test('search focus: cast "search the web for information" with confirm resolves to evidence/search_web', async () => {
  const { aggregator } = buildAggregator('search');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'search the web for information',
    confirm: true,
  });
  assert.equal(result.isError, undefined, 'cast should not error');

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string; score: number } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.ok(
    resolved.tool.startsWith('evidence/'),
    `cast should resolve to an evidence/ tool, got: ${resolved.tool}`,
  );
});
