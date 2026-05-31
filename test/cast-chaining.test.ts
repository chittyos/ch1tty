/**
 * Multi-step cast chaining tests.
 *
 * Validates that the full `cast(executed) → affinity → cast` chaining path
 * works correctly at the Aggregator level.  Specifically:
 *
 *   - cast (no confirm) executes the tool AND records server affinity
 *   - second cast in the same session elevates the previously-used server
 *     when keyword scores tie, demonstrating real affinity compounding
 *   - mixed chain (cast → execute → cast) records affinity from both steps
 *   - without a sessionId, no affinity accumulates across calls
 *   - onSessionEnd resets affinity so a resumed session starts cold
 *
 * These cover the gap in session-affinity.test.ts, which tests coordinator
 * internals and `ch1tty/execute → cast` (confirm-only) but does NOT test
 * `ch1tty/cast (executed) → ch1tty/cast` chaining end-to-end.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

const LEDGER_DLQ = join(tmpdir(), `ch1tty-chain-${Date.now()}.jsonl`);

/**
 * Aggregator with tasks registered FIRST (wins stable-sort keyword ties),
 * followed by neon and github.  The registry order is the control baseline:
 * when two tools score identically on keyword, tasks wins.  Any test that
 * shows neon or github winning must demonstrate a non-keyword signal (affinity).
 */
function makeAggregator(): { agg: Aggregator; backend: FixtureBackend } {
  const backend = new FixtureBackend();
  backend.defineServer('tasks', FIXTURE_SERVERS.tasks);
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('github', FIXTURE_SERVERS.github);

  const configs: ServerConfig[] = [
    {
      id: 'tasks',
      name: 'Tasks',
      type: 'remote',
      access: 'readwrite',
      category: 'ecosystem',
      endpoint: 'https://tasks.chitty.cc/mcp',
      lazy: true,
    },
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
  ];

  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: LEDGER_DLQ,
    suggestionsCatalog: {},
  });
  return { agg, backend };
}

// ── 1. cast (executed) records affinity ──────────────────────────────────────

test('cast (executed, no confirm) records server affinity for the resolved tool', async () => {
  const { agg } = makeAggregator();
  const sessionId = 'chain-1';
  await agg.coordinator.onSessionStart(sessionId, 'stdio');

  assert.equal(
    agg.coordinator.getServerAffinity(sessionId).size,
    0,
    'no affinity before any cast',
  );

  // "list neon projects" → neon/list_projects wins (keyword "neon" matches serverId exactly
  // → +0.3 name bonus; "list"+"projects" both in description → 3/3 keyword=1.0; total 1.3)
  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects' }, sessionId);
  assert.equal(result.isError, undefined, 'cast succeeded');

  const data = JSON.parse(result.content[0].text as string);
  assert.equal(data.cast, 'executed', 'confirm=false → cast mode is "executed"');
  assert.ok(
    typeof data.resolved === 'string' && data.resolved.includes('neon'),
    `resolved should be a neon tool namespaced string, got: ${JSON.stringify(data.resolved)}`,
  );

  const affinity = agg.coordinator.getServerAffinity(sessionId);
  assert.ok(affinity.has('neon'), 'neon affinity recorded after cast execution');
  assert.ok(affinity.get('neon')! > 0, 'affinity timestamp is a positive epoch ms');

  await agg.shutdown();
});

// ── 2. second cast boosts previously-used server in keyword tie ───────────────

test('second cast (confirm) resolves to previously-cast server when keyword scores tie', async () => {
  const { agg } = makeAggregator();
  const sessionId = 'chain-2';
  await agg.coordinator.onSessionStart(sessionId, 'stdio');

  // Step 1: cast "list neon projects" (executed) → neon affinity set
  const r1 = await agg.callTool('ch1tty/cast', { intent: 'list neon projects' }, sessionId);
  const d1 = JSON.parse(r1.content[0].text as string);
  assert.equal(d1.cast, 'executed', 'step 1: cast executed');
  assert.ok(agg.coordinator.getServerAffinity(sessionId).has('neon'), 'neon affinity after step 1');

  // Step 2: cast "list stuff" (confirm) — "list" scores 0.5 for BOTH neon/list_projects and
  // tasks/list_tasks (and github/list_pull_requests).  Without affinity, tasks wins by registry
  // order (stable sort).  With neon affinity ~0.2: neon = 0.7 > tasks = 0.5 → neon wins.
  const r2 = await agg.callTool('ch1tty/cast', { intent: 'list stuff', confirm: true }, sessionId);
  assert.equal(r2.isError, undefined, 'second cast succeeded');

  const d2 = JSON.parse(r2.content[0].text as string);
  assert.equal(d2.cast, 'plan', 'confirm:true → plan mode');
  assert.equal(
    d2.resolved.server,
    'neon',
    'neon wins keyword tie — affinity boost lifts neon above tasks and github',
  );

  await agg.shutdown();
});

// ── 3. cast → execute → cast: both steps record affinity ─────────────────────

test('cast → execute → cast: both steps contribute affinity; chain resolves correctly', async () => {
  const { agg, backend } = makeAggregator();
  const sessionId = 'chain-3';
  await agg.coordinator.onSessionStart(sessionId, 'stdio');

  // Step 1: cast "list neon projects" (executed) → neon affinity
  const r1 = await agg.callTool('ch1tty/cast', { intent: 'list neon projects' }, sessionId);
  assert.equal(JSON.parse(r1.content[0].text as string).cast, 'executed', 'step 1 executed');

  // Step 2: execute github/create_issue directly → github affinity
  await agg.callTool(
    'ch1tty/execute',
    { tool: 'github/create_issue', args: { owner: 'org', repo: 'repo', title: 'bug' } },
    sessionId,
  );

  // After mixed chain: both servers have affinity
  const affinity = agg.coordinator.getServerAffinity(sessionId);
  assert.ok(affinity.has('neon'), 'neon affinity from cast step');
  assert.ok(affinity.has('github'), 'github affinity from execute step');

  // Call log confirms both backend tools were actually invoked
  const calls = backend.getCallLog();
  assert.ok(
    calls.some((c) => c.serverId === 'neon' && c.tool === 'list_projects'),
    'neon/list_projects in call log',
  );
  assert.ok(
    calls.some((c) => c.serverId === 'github' && c.tool === 'create_issue'),
    'github/create_issue in call log',
  );

  // Step 3: cast for a github-specific intent (confirm) — verifies third step resolves correctly
  // "search code github" → github/search_code wins (keyword "search"+"code"+"github" all match
  // github/search_code; "github" exactly matches serverId → +0.3 name bonus; keyword=1.0; total ~1.5)
  const r3 = await agg.callTool(
    'ch1tty/cast',
    { intent: 'search code github', confirm: true },
    sessionId,
  );
  const d3 = JSON.parse(r3.content[0].text as string);
  assert.equal(d3.cast, 'plan', 'step 3 confirm mode');
  assert.equal(d3.resolved.server, 'github', 'github resolves for github-specific intent');

  await agg.shutdown();
});

// ── 4. no sessionId → no affinity accumulation ───────────────────────────────

test('cast without sessionId does not accumulate affinity across sequential calls', async () => {
  const { agg } = makeAggregator();

  // Cast "list neon projects" without sessionId — neon executes
  const r1 = await agg.callTool('ch1tty/cast', { intent: 'list neon projects' });
  const d1 = JSON.parse(r1.content[0].text as string);
  assert.equal(d1.cast, 'executed', 'step 1 executed without sessionId');

  // Cast "list stuff" without sessionId (confirm) — no affinity, so keyword tie resolved
  // by registry order: tasks (registered first) wins.
  const r2 = await agg.callTool('ch1tty/cast', { intent: 'list stuff', confirm: true });
  const d2 = JSON.parse(r2.content[0].text as string);
  assert.equal(d2.cast, 'plan', 'step 2 confirm mode');
  assert.equal(
    d2.resolved.server,
    'tasks',
    'tasks wins keyword tie — no neon affinity accumulated without sessionId',
  );

  await agg.shutdown();
});

// ── 5. onSessionEnd resets affinity; subsequent cast is cold ─────────────────

test('onSessionEnd clears affinity: post-end cast resolves by keyword alone', async () => {
  const { agg } = makeAggregator();
  const sessionId = 'chain-5';
  await agg.coordinator.onSessionStart(sessionId, 'stdio');

  // Execute neon to set affinity
  await agg.callTool('ch1tty/cast', { intent: 'list neon projects' }, sessionId);
  assert.ok(agg.coordinator.getServerAffinity(sessionId).has('neon'), 'neon affinity before end');

  // End session → affinity cleared
  await agg.coordinator.onSessionEnd(sessionId);
  assert.equal(
    agg.coordinator.getServerAffinity(sessionId).size,
    0,
    'affinity cleared after onSessionEnd',
  );

  // Re-start same session (simulates reconnect)
  await agg.coordinator.onSessionStart(sessionId, 'stdio');

  // Cast "list stuff" (confirm) — without neon affinity, tasks wins keyword tie
  const result = await agg.callTool('ch1tty/cast', { intent: 'list stuff', confirm: true }, sessionId);
  const data = JSON.parse(result.content[0].text as string);
  assert.equal(data.cast, 'plan', 'confirm mode after session reset');
  assert.equal(
    data.resolved.server,
    'tasks',
    'tasks wins keyword tie — neon affinity was cleared by onSessionEnd',
  );

  await agg.shutdown();
});
