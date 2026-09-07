/**
 * Workstream T — market focus profile scenarios.
 *
 * Validates the market focus profile:
 *  - market/ tools are boosted in search ranking (lens, not gate)
 *  - cast resolves pricing/listing intents to market/ tools
 *  - out-of-focus tools remain reachable when market focus is active
 *  - multi-step market workflows (price research, listing comparison) execute via fixture backend
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

const MARKET_FOCUS_PROFILES = {
  profiles: {
    market: {
      description: 'Market research and pricing intelligence — search listings, track price history, compare offers, and summarise market conditions',
      categories: ['ecosystem' as const],
      servers: ['market', 'neon', 'notion'],
      boost: 0.5,
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
  { id: 'market', name: 'ChittyMarket', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://fixture.market' },
  { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.neon' },
  { id: 'notion', name: 'Notion', type: 'remote', access: 'readwrite', category: 'documents', endpoint: 'https://fixture.notion' },
  { id: 'github', name: 'GitHub', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.github' },
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
    focusProfiles: MARKET_FOCUS_PROFILES,
    focus,
    embedEnabled: false,
    backendFactory: (config) => {
      fixture.registerServer(config);
      return fixture;
    },
  });
  return { aggregator, fixture };
}

test('market focus: search "search listings" ranks market/ tools first', async () => {
  const { aggregator } = buildAggregator('market');

  const result = await aggregator.callTool('ch1tty/search', { query: 'search listings', limit: 10 });
  assert.equal(result.isError, undefined, 'search should not error');

  const parsed = parseSearch(result);
  const tools = parsed.tools ?? [];
  assert.ok(tools.length > 0, 'should return results');

  const marketIdx = tools.findIndex((r) => r.tool.startsWith('market/'));
  const otherIdx = tools.findIndex((r) => !r.tool.startsWith('market/'));

  assert.ok(marketIdx !== -1, 'market/ tools should appear in results');
  if (otherIdx !== -1) {
    assert.ok(marketIdx < otherIdx, 'market/ tools should rank above out-of-focus tools for market query');
  }
  assert.equal(parsed.focus, 'market', 'search response should report active focus');
});

test('market focus: search "price history" includes market/get_price_history', async () => {
  const { aggregator } = buildAggregator('market');

  const result = await aggregator.callTool('ch1tty/search', { query: 'price history', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t === 'market/get_price_history'), 'market/get_price_history must appear in results');
});

test('market focus: out-of-focus tools (neon) remain reachable via search', async () => {
  const { aggregator } = buildAggregator('market');

  const result = await aggregator.callTool('ch1tty/search', { query: 'database query', limit: 20 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('neon/')), 'neon/ tools must remain reachable with market focus active');
});

test('market focus: no focus — market tools still accessible (lens not gate)', async () => {
  const { aggregator } = buildAggregator(); // no focus

  const result = await aggregator.callTool('ch1tty/search', { query: 'search listings', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('market/')), 'market/ tools must be reachable without any focus');
});

test('market focus: execute search_listings returns fixture listing array', async () => {
  const { aggregator, fixture } = buildAggregator('market');
  fixture.clearCallLog();

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'market/search_listings',
    args: { query: 'Widget Pro X' },
  });
  assert.equal(result.isError, undefined, 'execute should succeed');

  const listings = JSON.parse(result.content[0].text as string) as Array<{ listing_id: string; price: number }>;
  assert.ok(Array.isArray(listings), 'should return an array of listings');
  assert.ok(listings.length > 0, 'fixture should return at least one listing');
  assert.ok(typeof listings[0].listing_id === 'string', 'listing_id should be a string');

  const calls = fixture.getCallLog();
  assert.ok(calls.some((c) => c.serverId === 'market' && c.tool === 'search_listings'), 'market/search_listings must be in call log');
});

test('market focus: execute get_market_summary returns category summary', async () => {
  const { aggregator } = buildAggregator('market');

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'market/get_market_summary',
    args: { category: 'hardware' },
  });
  assert.equal(result.isError, undefined, 'execute should succeed');

  const summary = JSON.parse(result.content[0].text as string) as { category: string; listing_count: number; avg_price: number };
  assert.equal(summary.category, 'hardware', 'summary category should match');
  assert.ok(typeof summary.listing_count === 'number', 'listing_count should be a number');
  assert.ok(typeof summary.avg_price === 'number', 'avg_price should be a number');
});

test('market focus: multi-step — search listings then get price history for first result', async () => {
  const { aggregator, fixture } = buildAggregator('market');
  const sessionId = 'market-scenario-001';
  fixture.clearCallLog();

  // Step 1: search listings
  const searchResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'market/search_listings',
    args: { query: 'Widget Pro X' },
  }, sessionId);
  assert.equal(searchResult.isError, undefined, 'search_listings should succeed');
  const listings = JSON.parse(searchResult.content[0].text as string) as Array<{ listing_id: string }>;
  assert.ok(listings.length > 0, 'fixture should return listings');
  const firstListingId = listings[0].listing_id;

  // Step 2: get price history for the first listing
  const historyResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'market/get_price_history',
    args: { listing_id: firstListingId },
  }, sessionId);
  assert.equal(historyResult.isError, undefined, 'get_price_history should succeed');
  const history = JSON.parse(historyResult.content[0].text as string) as { listing_id: string; history: unknown[] };
  assert.equal(history.listing_id, firstListingId, 'history listing_id should match search result');
  assert.ok(Array.isArray(history.history), 'history should be an array');

  const calls = fixture.getCallLog();
  const toolNames = calls.map((c) => `${c.serverId}/${c.tool}`);
  assert.ok(toolNames.includes('market/search_listings'), 'search_listings must be in call log');
  assert.ok(toolNames.includes('market/get_price_history'), 'get_price_history must be in call log');
});

test('market focus: multi-step — search then compare prices', async () => {
  const { aggregator, fixture } = buildAggregator('market');
  fixture.clearCallLog();

  // Step 1: search listings
  const searchResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'market/search_listings',
    args: { query: 'Widget Pro X' },
  });
  assert.equal(searchResult.isError, undefined, 'search_listings should succeed');

  // Step 2: compare prices across sources
  const compareResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'market/compare_prices',
    args: { query: 'Widget Pro X' },
  });
  assert.equal(compareResult.isError, undefined, 'compare_prices should succeed');
  const comparison = JSON.parse(compareResult.content[0].text as string) as { results: unknown[]; lowest: { listing_id: string; price: number } };
  assert.ok(Array.isArray(comparison.results), 'results should be an array');
  assert.ok(typeof comparison.lowest.price === 'number', 'lowest price should be a number');

  const calls = fixture.getCallLog();
  const toolNames = calls.map((c) => `${c.serverId}/${c.tool}`);
  assert.ok(toolNames.includes('market/search_listings'), 'search_listings must be in call log');
  assert.ok(toolNames.includes('market/compare_prices'), 'compare_prices must be in call log');
});

test('market focus: status reports active focus as market', async () => {
  const { aggregator } = buildAggregator('market');

  const result = await aggregator.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined);

  const status = JSON.parse(result.content[0].text as string) as { focus?: { active?: string } };
  assert.equal(status.focus?.active, 'market', 'status must report market as active focus');
});

test('market focus: cast "search for product listings" resolves to market/ tool', async () => {
  const { aggregator } = buildAggregator('market');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'search market listings for a product',
    confirm: true,
  });
  assert.equal(result.isError, undefined, 'cast should not error');

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string; score: number } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.ok(resolved.tool.startsWith('market/'), `cast should resolve to market/, got: ${resolved.tool}`);
  assert.equal(cast.focus, 'market', 'cast response should report active focus');
});

test('market focus: cast "get market summary for hardware" resolves to market/get_market_summary', async () => {
  const { aggregator } = buildAggregator('market');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'get a market summary for the hardware category',
    confirm: true,
  });
  assert.equal(result.isError, undefined);

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string; score: number } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.equal(
    resolved.tool,
    'market/get_market_summary',
    `should resolve to market/get_market_summary, got: ${resolved.tool}`,
  );
});
