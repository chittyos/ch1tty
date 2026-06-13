import test from 'node:test';
import assert from 'node:assert/strict';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend } from './fixture-backend.js';

function makeAgg(toolCount = 30) {
  const fixture = new FixtureBackend();
  const tools = Array.from({ length: toolCount }, (_, i) => ({
    name: `tool_${String(i).padStart(3, '0')}`,
    description: `tool number ${i}`,
    inputSchema: {},
    response: { content: [{ type: 'text', text: `result ${i}` }] },
  }));
  fixture.defineServer('widgets', { tools });

  const configs = [
    { id: 'widgets', name: 'Widgets', type: 'remote' as const, access: 'read' as const, category: 'code' as const, endpoint: 'https://unused.invalid/mcp', lazy: false },
  ];
  const agg = new Aggregator(configs, { backendFactory: () => fixture, embedEnabled: false });
  return agg;
}

async function search(agg: Aggregator, args: Record<string, unknown>) {
  const r = await agg.callTool('ch1tty/search', args, 'test-session');
  return JSON.parse((r.content[0] as { type: string; text: string }).text);
}

test('offset: 0 returns the first page (same as default)', async () => {
  const agg = makeAgg(30);
  try {
    const noOffset = await search(agg, { server: 'widgets', limit: 5 });
    const withZero = await search(agg, { server: 'widgets', limit: 5, offset: 0 });
    assert.deepEqual(noOffset.tools, withZero.tools);
  } finally { await agg.shutdown(); }
});

test('offset skips leading results', async () => {
  const agg = makeAgg(30);
  try {
    const page1 = await search(agg, { server: 'widgets', limit: 5 });
    const page2 = await search(agg, { server: 'widgets', limit: 5, offset: 5 });
    // page2 first tool should not appear in page1
    assert.ok(page2.tools.length > 0, 'page2 should have results');
    const page1Names = page1.tools.map((t: { tool: string }) => t.tool);
    assert.ok(!page1Names.includes(page2.tools[0].tool), 'page2[0] should not be in page1');
  } finally { await agg.shutdown(); }
});

test('two pages concatenated equal an equivalent single larger query', async () => {
  const agg = makeAgg(20);
  try {
    const combined = await search(agg, { server: 'widgets', limit: 20 });
    const page1 = await search(agg, { server: 'widgets', limit: 10 });
    const page2 = await search(agg, { server: 'widgets', limit: 10, offset: 10 });
    const paged = [...page1.tools, ...page2.tools];
    assert.equal(paged.length, combined.tools.length);
    assert.deepEqual(paged.map((t: { tool: string }) => t.tool), combined.tools.map((t: { tool: string }) => t.tool));
  } finally { await agg.shutdown(); }
});

test('offset beyond total returns empty tools with correct total', async () => {
  const agg = makeAgg(10);
  try {
    const r = await search(agg, { server: 'widgets', limit: 5, offset: 50 });
    assert.equal(r.tools.length, 0, 'no tools beyond total');
    assert.equal(r.total, 10, 'total still reflects full match count');
    assert.equal(r.matches, 0);
  } finally { await agg.shutdown(); }
});

test('offset field appears in response JSON when non-zero', async () => {
  const agg = makeAgg(10);
  try {
    const withOffset = await search(agg, { server: 'widgets', limit: 5, offset: 3 });
    assert.equal(withOffset.offset, 3, 'response includes offset field');

    const noOffset = await search(agg, { server: 'widgets', limit: 5 });
    assert.equal(noOffset.offset, undefined, 'offset field absent when 0/omitted');
  } finally { await agg.shutdown(); }
});

test('total reflects full result count regardless of offset', async () => {
  const agg = makeAgg(15);
  try {
    const r1 = await search(agg, { server: 'widgets', limit: 5 });
    const r2 = await search(agg, { server: 'widgets', limit: 5, offset: 10 });
    assert.equal(r1.total, 15, 'page 1 total = full count');
    assert.equal(r2.total, 15, 'page 2 total = full count');
  } finally { await agg.shutdown(); }
});

test('offset works together with keyword query', async () => {
  const fixture = new FixtureBackend();
  const tools = Array.from({ length: 10 }, (_, i) => ({
    name: `search_tool_${i}`,
    description: `searchable item ${i}`,
    inputSchema: {},
    response: { content: [{ type: 'text', text: 'ok' }] },
  }));
  fixture.defineServer('searchable', { tools });
  const configs = [
    { id: 'searchable', name: 'Searchable', type: 'remote' as const, access: 'read' as const, category: 'code' as const, endpoint: 'https://unused.invalid/mcp', lazy: false },
  ];
  const agg = new Aggregator(configs, { backendFactory: () => fixture, embedEnabled: false });
  try {
    const all = await search(agg, { query: 'searchable', limit: 10 });
    const page = await search(agg, { query: 'searchable', limit: 5, offset: 5 });
    assert.equal(page.total, all.total, 'total unchanged by offset');
    assert.ok(page.tools.length <= 5, 'page size capped at limit');
    if (page.tools.length > 0) {
      assert.ok(!all.tools.slice(0, 5).map((t: { tool: string }) => t.tool).includes(page.tools[0].tool),
        'page 2 first result not in page 1');
    }
  } finally { await agg.shutdown(); }
});
