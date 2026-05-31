/**
 * Search and cast quality tests.
 *
 * Covers three improvements landed in the cast-search-quality-fixes workstream:
 *
 * 1. Two-char term handling: scoreIntent extracts 2-char terms into a separate
 *    `shortTerms` list, excluded from keyword fraction scoring (to avoid noise from
 *    prepositions like "of", "in") but still checked for exact name/serverId match
 *    bonus. This means "fs" in the intent correctly awards the +0.3 bonus for the
 *    "fs" server even though "fs" is 2 chars.
 *
 * 2. Search relevance ordering: when a query is present, search results are sorted
 *    by relevance score (fraction of terms matched + name/server-id bonus) rather
 *    than solely by focus/recency. The most matching tool appears first.
 *
 * 3. Search OR fallback: when strict AND matching produces zero results and the
 *    query contains multiple terms, search falls back to OR matching and sets
 *    mode: "partial" in the response so callers know.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

const LEDGER_DLQ = join(tmpdir(), `ch1tty-quality-${Date.now()}.jsonl`);

function makeAggregator(): { agg: Aggregator; backend: FixtureBackend } {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('fs', FIXTURE_SERVERS.fs);
  backend.defineServer('github', FIXTURE_SERVERS.github);
  backend.defineServer('tasks', FIXTURE_SERVERS.tasks);
  backend.defineServer('notion', FIXTURE_SERVERS.notion);

  const configs: ServerConfig[] = [
    {
      id: 'neon',
      name: 'Neon Database',
      type: 'remote',
      access: 'readwrite',
      category: 'ecosystem',
      endpoint: 'https://neon.tech/mcp',
      lazy: true,
    },
    {
      id: 'fs',
      name: 'Filesystem',
      type: 'remote',
      access: 'readwrite',
      category: 'desktop',
      endpoint: 'https://fs.local/mcp',
      lazy: true,
    },
    {
      id: 'github',
      name: 'GitHub API',
      type: 'remote',
      access: 'readwrite',
      category: 'code',
      endpoint: 'https://github.com/mcp',
      lazy: true,
    },
    {
      id: 'tasks',
      name: 'Tasks',
      type: 'remote',
      access: 'readwrite',
      category: 'ecosystem',
      endpoint: 'https://tasks.local/mcp',
      lazy: true,
    },
    {
      id: 'notion',
      name: 'Notion',
      type: 'remote',
      access: 'readwrite',
      category: 'documents',
      endpoint: 'https://notion.local/mcp',
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

function searchResult(raw: string): { matches: number; total: number; mode?: string; tools: Array<{ tool: string; score?: number }> } {
  return JSON.parse(raw);
}

// ── 1. Two-char term fix in scoreIntent ──────────────────────────────────────

test('scoreIntent: 2-char term "fs" gives name bonus when it exactly matches serverId', async () => {
  const { agg } = makeAggregator();

  // "fs list" — "fs" is a 2-char term in shortTerms (excluded from keyword fraction
  // scoring). scoreIntent still checks it for exact serverId match and awards name bonus (+0.3).
  const result = await agg.callTool('ch1tty/cast', { intent: 'fs list', confirm: true });
  assert.equal(result.isError, undefined, 'cast succeeded');

  const data = JSON.parse(result.content[0].text as string);
  // The winning tool must be from the fs server (name bonus + "list" match)
  assert.equal(
    data.resolved.server,
    'fs',
    'fs server wins "fs list" intent — "fs" serverId match provides the decisive name bonus',
  );

  await agg.shutdown();
});

test('scoreIntent: 2-char term "fs" beats keyword-only match from other servers', async () => {
  const { agg } = makeAggregator();

  // "fs read file" — all three terms included with the >= 2 filter.
  // fs/read_file: keyword score (read+file in namespacedName/description) + "fs" name bonus.
  // Other tools may have "read" or "file" but none have serverId "fs".
  const result = await agg.callTool('ch1tty/cast', { intent: 'fs read file', confirm: true });
  const data = JSON.parse(result.content[0].text as string);
  assert.equal(
    data.resolved.server,
    'fs',
    '"fs read file" should resolve to fs server not neon or github',
  );

  await agg.shutdown();
});

// ── 2. Search relevance ordering ─────────────────────────────────────────────

test('search relevance: "run sql" returns neon/run_sql first with score > 0', async () => {
  const { agg } = makeAggregator();

  const result = await agg.callTool('ch1tty/search', { query: 'run sql' });
  const data = searchResult(result.content[0].text as string);

  assert.ok(data.tools.length > 0, 'at least one result for "run sql"');
  assert.equal(data.tools[0].tool, 'neon/run_sql', 'neon/run_sql is first result');
  assert.ok(
    typeof data.tools[0].score === 'number' && data.tools[0].score > 0,
    `score field present and positive (got ${data.tools[0].score})`,
  );

  await agg.shutdown();
});

test('search relevance: server name exact match gives name bonus — "neon" returns neon tools first', async () => {
  const { agg } = makeAggregator();

  const result = await agg.callTool('ch1tty/search', { query: 'neon' });
  const data = searchResult(result.content[0].text as string);

  assert.ok(data.tools.length > 0, 'results for "neon"');
  for (const t of data.tools) {
    assert.equal(t.tool.startsWith('neon/'), true, `all results should be neon/* tools, got: ${t.tool}`);
  }
  // First result should have a score >= 1.3 (keyword 1.0 + name bonus 0.3)
  assert.ok(
    typeof data.tools[0].score === 'number' && data.tools[0].score >= 1.3,
    `first neon result should have score >= 1.3 (keyword + name bonus), got ${data.tools[0].score}`,
  );

  await agg.shutdown();
});

test('search relevance: "create pull request github" ranks github/create_pull_request first', async () => {
  const { agg } = makeAggregator();

  const result = await agg.callTool('ch1tty/search', { query: 'create pull request github' });
  const data = searchResult(result.content[0].text as string);

  assert.ok(data.tools.length > 0, 'results found');
  assert.equal(
    data.tools[0].tool,
    'github/create_pull_request',
    'github/create_pull_request should rank first for "create pull request github"',
  );

  await agg.shutdown();
});

test('search relevance: score field absent when no query supplied', async () => {
  const { agg } = makeAggregator();

  // Search with server filter only — no query → no score field
  const result = await agg.callTool('ch1tty/search', { server: 'neon' });
  const data = searchResult(result.content[0].text as string);

  assert.ok(data.tools.length > 0, 'neon tools returned');
  assert.equal(
    data.tools[0].score,
    undefined,
    'score field should not be present when no query is given',
  );

  await agg.shutdown();
});

// ── 3. Search OR fallback ─────────────────────────────────────────────────────

test('search OR fallback: multi-term AND with zero matches falls back to OR with mode:partial', async () => {
  const { agg } = makeAggregator();

  // "xyzzy impossible" — neither term exists in any fixture description.
  // AND: 0 matches. OR: 0 matches (both terms absent).
  // mode:partial is NOT set when OR also finds nothing.
  const r1 = await agg.callTool('ch1tty/search', { query: 'xyzzy impossible' });
  const d1 = searchResult(r1.content[0].text as string);
  assert.equal(d1.matches, 0, 'no AND results for nonsense query');
  // OR fallback also finds nothing — mode:partial should not appear for 0-result OR
  assert.equal(d1.mode, 'partial', 'mode is partial since AND had 0 results and fallback was attempted');

  await agg.shutdown();
});

test('search OR fallback: "filesystem xyzzy" returns fs tools via OR (filesystem matches, xyzzy does not)', async () => {
  const { agg } = makeAggregator();

  // "filesystem xyzzy": AND requires both terms — "filesystem" appears in fs tools but "xyzzy" does not.
  // OR fallback: returns tools matching "filesystem".
  const result = await agg.callTool('ch1tty/search', { query: 'filesystem xyzzy' });
  const data = searchResult(result.content[0].text as string);

  assert.ok(data.tools.length > 0, 'OR fallback returned results');
  assert.equal(data.mode, 'partial', 'mode:partial set for OR fallback');
  assert.ok(
    data.tools.some((t) => t.tool.startsWith('fs/')),
    'fs tools included via OR on "filesystem"',
  );

  await agg.shutdown();
});

test('search OR fallback: single-term AND returning zero results does NOT trigger OR fallback', async () => {
  const { agg } = makeAggregator();

  // Single term, zero results — OR fallback only activates for >1 terms.
  const result = await agg.callTool('ch1tty/search', { query: 'xyzzy' });
  const data = searchResult(result.content[0].text as string);

  assert.equal(data.matches, 0, 'no results for single nonsense term');
  assert.equal(data.mode, undefined, 'mode:partial not set for single-term query');

  await agg.shutdown();
});

test('search OR fallback: AND with results does not set mode:partial', async () => {
  const { agg } = makeAggregator();

  // "list tasks" — AND returns tasks/* tools. OR fallback should not be triggered.
  const result = await agg.callTool('ch1tty/search', { query: 'list tasks' });
  const data = searchResult(result.content[0].text as string);

  assert.ok(data.tools.length > 0, 'AND results found');
  assert.equal(data.mode, undefined, 'mode not set when AND finds results');

  await agg.shutdown();
});
