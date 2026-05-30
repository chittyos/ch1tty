/**
 * Session coordinator affinity boost tests.
 *
 * Validates that the SessionCoordinator correctly records server affinity on
 * tool execution and that the affinity boosts search/cast results toward
 * recently-used backends.  Tested paths:
 *   - coordinator.onToolCall → serverAffinity map updated
 *   - coordinator.getToolPatterns → sorted by call count
 *   - coordinator.onSessionEnd → context cleared
 *   - coordinator.getEntityContext → undefined when no ecosystem backend
 *   - ch1tty/search → recentlyUsed flag set for recently-used server
 *   - ch1tty/search → recently-used server sorts before non-recent
 *   - ch1tty/search without sessionId → no recentlyUsed flags
 *   - ch1tty/cast (confirm) → affinity elevates recently-used server's tool
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

const LEDGER_DLQ = join(tmpdir(), `ch1tty-affinity-test-${Date.now()}.jsonl`);

function makeAggregator(): { aggregator: Aggregator; backend: FixtureBackend } {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('github', FIXTURE_SERVERS.github);
  backend.defineServer('tasks', FIXTURE_SERVERS.tasks);

  const configs: ServerConfig[] = [
    {
      id: 'neon',
      name: 'Neon',
      type: 'remote',
      access: 'readwrite',
      category: 'code',
      endpoint: 'https://neon.tech/mcp',
      lazy: true,
    },
    {
      id: 'github',
      name: 'GitHub',
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
      endpoint: 'https://tasks.chitty.cc/mcp',
      lazy: true,
    },
  ];

  const aggregator = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: LEDGER_DLQ,
    suggestionsCatalog: {},
  });
  return { aggregator, backend };
}

// ── Unit: coordinator internals ───────────────────────────────────────────────

test('coordinator.onToolCall records serverAffinity for the session', async () => {
  const { aggregator } = makeAggregator();
  const sessionId = 'aff-unit-1';

  await aggregator.coordinator.onSessionStart(sessionId, 'stdio');

  assert.equal(aggregator.coordinator.getServerAffinity(sessionId).size, 0, 'no affinity before any call');

  aggregator.coordinator.onToolCall(sessionId, 'neon/run_sql');

  const affinity = aggregator.coordinator.getServerAffinity(sessionId);
  assert.equal(affinity.size, 1, 'one server recorded');
  assert.ok(affinity.has('neon'), 'neon affinity present');

  const ts = affinity.get('neon')!;
  assert.ok(ts > 0 && ts <= Date.now(), 'timestamp is a valid epoch ms');
  assert.ok(Date.now() - ts < 2000, 'timestamp is recent (< 2s ago)');
});

test('coordinator.onToolCall without onSessionStart is a no-op (no crash)', () => {
  const { aggregator } = makeAggregator();
  // Calling onToolCall without a prior onSessionStart must not throw
  assert.doesNotThrow(() => {
    aggregator.coordinator.onToolCall('orphan-session', 'neon/run_sql');
  });
  // And affinity map is empty (default)
  assert.equal(aggregator.coordinator.getServerAffinity('orphan-session').size, 0);
});

test('coordinator.getToolPatterns returns tools sorted by call count', async () => {
  const { aggregator } = makeAggregator();
  const sessionId = 'aff-unit-2';

  await aggregator.coordinator.onSessionStart(sessionId, 'stdio');

  aggregator.coordinator.onToolCall(sessionId, 'neon/run_sql');
  aggregator.coordinator.onToolCall(sessionId, 'neon/run_sql');
  aggregator.coordinator.onToolCall(sessionId, 'neon/run_sql');
  aggregator.coordinator.onToolCall(sessionId, 'github/create_issue');
  aggregator.coordinator.onToolCall(sessionId, 'github/create_issue');
  aggregator.coordinator.onToolCall(sessionId, 'tasks/list_tasks');

  const patterns = aggregator.coordinator.getToolPatterns(sessionId);
  assert.ok(patterns.length >= 3, 'at least 3 patterns recorded');
  assert.equal(patterns[0].tool, 'neon/run_sql', 'most-called tool is first');
  assert.equal(patterns[0].count, 3);
  assert.equal(patterns[1].tool, 'github/create_issue', 'second-most-called is second');
  assert.equal(patterns[1].count, 2);
  assert.equal(patterns[2].tool, 'tasks/list_tasks', 'least-called is last');
  assert.equal(patterns[2].count, 1);
});

test('coordinator.onSessionEnd clears session context (affinity, patterns, entity)', async () => {
  const { aggregator } = makeAggregator();
  const sessionId = 'aff-unit-3';

  await aggregator.coordinator.onSessionStart(sessionId, 'stdio');
  aggregator.coordinator.onToolCall(sessionId, 'tasks/list_tasks');
  aggregator.coordinator.onToolCall(sessionId, 'neon/run_sql');

  assert.equal(aggregator.coordinator.getServerAffinity(sessionId).size, 2, 'affinity present before end');
  assert.equal(aggregator.coordinator.getToolPatterns(sessionId).length, 2, 'patterns present before end');

  await aggregator.coordinator.onSessionEnd(sessionId);

  assert.equal(aggregator.coordinator.getServerAffinity(sessionId).size, 0, 'affinity cleared after end');
  assert.equal(aggregator.coordinator.getToolPatterns(sessionId).length, 0, 'patterns cleared after end');
  assert.equal(aggregator.coordinator.getEntityContext(sessionId), undefined, 'entity undefined after end');
});

test('coordinator.getEntityContext returns undefined when no ecosystem backend provides identity', async () => {
  const { aggregator } = makeAggregator();
  const sessionId = 'aff-unit-4';

  await aggregator.coordinator.onSessionStart(sessionId, 'stdio');

  // Give background staging a moment to attempt + fail context_resolve via FixtureBackend
  await new Promise((r) => setTimeout(r, 50));

  // With no ecosystem identity tools in the fixture, entity stays undefined
  const entity = aggregator.coordinator.getEntityContext(sessionId);
  assert.equal(entity, undefined, 'entity undefined — no identity tools in fixture backend');
  assert.ok(aggregator.coordinator.isStagingComplete(sessionId), 'staging marked complete despite no backend');
});

// ── Integration: search recentlyUsed flag ────────────────────────────────────

test('search marks recently-used server tools with recentlyUsed:true', async () => {
  const { aggregator } = makeAggregator();
  const sessionId = 'aff-search-1';

  await aggregator.coordinator.onSessionStart(sessionId, 'stdio');

  // Execute a neon tool
  const execResult = await aggregator.callTool(
    'ch1tty/execute',
    { tool: 'neon/run_sql', args: { project_id: 'proj-abc', sql: 'SELECT 1' } },
    sessionId,
  );
  assert.equal(execResult.isError, undefined, 'execute succeeded');

  // Search for sql-related tools with the same sessionId
  const searchResult = await aggregator.callTool('ch1tty/search', { query: 'sql database' }, sessionId);
  assert.equal(searchResult.isError, undefined);

  const data = JSON.parse(searchResult.content[0].text as string);
  assert.ok(Array.isArray(data.tools), 'tools array present');
  assert.ok(data.tools.length > 0, 'at least one tool returned');

  const neonTools = data.tools.filter((t: { server: string }) => t.server === 'neon');
  assert.ok(neonTools.length > 0, 'neon tools are in results');
  assert.ok(
    neonTools.every((t: { recentlyUsed?: boolean }) => t.recentlyUsed === true),
    'all neon tools carry recentlyUsed:true after executing a neon tool',
  );
});

test('search without sessionId has no recentlyUsed flags', async () => {
  const { aggregator } = makeAggregator();

  const result = await aggregator.callTool('ch1tty/search', { query: 'sql database' });
  assert.equal(result.isError, undefined);

  const data = JSON.parse(result.content[0].text as string);
  const hasRecent = data.tools?.some((t: { recentlyUsed?: boolean }) => t.recentlyUsed === true);
  assert.ok(!hasRecent, 'no recentlyUsed flags without sessionId');
});

// ── Integration: search sort order ───────────────────────────────────────────

test('search sorts recently-used server tools before non-recent for the same query', async () => {
  const { aggregator } = makeAggregator();
  const sessionId = 'aff-search-2';

  await aggregator.coordinator.onSessionStart(sessionId, 'stdio');

  // Execute a github tool — both github and neon have "create" in their tool names
  await aggregator.callTool(
    'ch1tty/execute',
    { tool: 'github/create_issue', args: { owner: 'org', repo: 'repo', title: 'test' } },
    sessionId,
  );

  // Search "create" — matches neon/create_project AND github/create_issue, github/create_pull_request
  const result = await aggregator.callTool('ch1tty/search', { query: 'create' }, sessionId);
  assert.equal(result.isError, undefined);

  const data = JSON.parse(result.content[0].text as string);
  assert.ok(data.tools.length >= 2, 'at least 2 tools matched "create"');

  const servers = data.tools.map((t: { server: string }) => t.server) as string[];
  const firstGithub = servers.indexOf('github');
  const firstNeon = servers.indexOf('neon');

  assert.ok(firstGithub >= 0, 'github tools present');
  assert.ok(firstNeon >= 0, 'neon tools present');
  assert.ok(
    firstGithub < firstNeon,
    `github (pos ${firstGithub}) should precede neon (pos ${firstNeon}) — github was recently used`,
  );
});

// ── Integration: cast affinity boost ─────────────────────────────────────────

test('cast (confirm:true) resolves to recently-used server tool over ambiguous alternatives', async () => {
  const { aggregator } = makeAggregator();
  const sessionId = 'aff-cast-1';

  await aggregator.coordinator.onSessionStart(sessionId, 'stdio');

  // Execute neon/list_projects first — both neon and tasks have "list" tools
  await aggregator.callTool('ch1tty/execute', { tool: 'neon/list_projects', args: {} }, sessionId);

  // "list projects" → keyword-scores neon/list_projects at 1.0 + affinity ~0.2
  // tasks/list_tasks only scores on "list" (0.5); no affinity
  const castResult = await aggregator.callTool(
    'ch1tty/cast',
    { intent: 'list projects', confirm: true },
    sessionId,
  );
  assert.equal(castResult.isError, undefined);

  const data = JSON.parse(castResult.content[0].text as string);
  assert.equal(data.cast, 'plan', 'confirm:true returns a plan');
  assert.ok(data.resolved, 'resolved tool present');
  assert.equal(
    data.resolved.server,
    'neon',
    'neon tool resolved — affinity boost elevates neon over tasks for "list projects"',
  );
  assert.match(data.resolved.tool, /neon\/list_projects/);
});
