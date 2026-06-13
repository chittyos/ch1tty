/**
 * CC: execute path, handleSearch recentlyUsed, and shutdown dedup tests.
 *
 * Covers three zero-coverage areas in aggregator.ts:
 *   1. handleExecute (aggregator.ts:478–530): invalid format, args forwarding,
 *      non-object args coercion, backend throw → isError.
 *   2. handleSearch recentlyUsed annotation + sort (aggregator.ts:437–474):
 *      session-tracker fallback populates recentServerIds when coordinator has
 *      no ctx (no prior onSessionStart); tools from recently-executed servers
 *      get recentlyUsed:true and are sorted before non-recent tools.
 *   3. shutdown() shared-backend dedup (aggregator.ts:1152–1167): the `seen`
 *      Set prevents double-shutdown when two server configs share one Backend.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAgg(
  servers: ServerConfig[],
  backend: Backend,
): Aggregator {
  return new Aggregator(servers, { backendFactory: () => backend, embedEnabled: false });
}

const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon DB', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.example.com/mcp',
};
const TASKS_CFG: ServerConfig = {
  id: 'tasks', name: 'Tasks', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://tasks.example.com/mcp',
};

function makeTrackingBackend(
  callLog: Array<{ serverId: string; toolName: string; args: Record<string, unknown> }>,
  tools: ToolEntry[],
): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: tools.length, toolCacheAge: 0 }),
    listTools: async () => tools,
    callTool: async (serverId, toolName, args = {}): Promise<ToolCallResult> => {
      callLog.push({ serverId, toolName, args });
      return { content: [{ type: 'text', text: 'ok' }] };
    },
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

function makeFiringBackend(): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: 1, toolCacheAge: 0 }),
    listTools: async (): Promise<ToolEntry[]> => [
      { name: 'kaboom', description: 'Always throws', inputSchema: { type: 'object', properties: {} } },
    ],
    callTool: async (): Promise<ToolCallResult> => { throw new Error('backend exploded'); },
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

// ── 1. handleExecute: invalid tool name (no separator) ────────────────────────

test('execute: tool name without "/" separator → isError + Expected format hint', async () => {
  const fb = new FixtureBackend();
  fb.defineServer('neon', FIXTURE_SERVERS.neon);
  const agg = makeAgg([NEON_CFG], fb);

  try {
    const result = await agg.callTool('ch1tty/execute', { tool: 'invalidnosep' });

    assert.equal(result.isError, true);
    const msg = result.content[0].text as string;
    assert.match(msg, /Invalid tool name "invalidnosep"/);
    assert.match(msg, /Expected format: serverId\/toolName/);
  } finally {
    await agg.shutdown();
  }
});

// ── 2. handleExecute: args forwarded correctly ────────────────────────────────

test('execute: correct args object forwarded to backend.callTool', async () => {
  const callLog: Array<{ serverId: string; toolName: string; args: Record<string, unknown> }> = [];
  const tools: ToolEntry[] = [
    { name: 'run_sql', description: 'Run SQL', inputSchema: { type: 'object', properties: { sql: { type: 'string' } } } },
  ];
  const agg = new Aggregator([NEON_CFG], {
    backendFactory: () => makeTrackingBackend(callLog, tools),
    embedEnabled: false,
  });

  try {
    const result = await agg.callTool('ch1tty/execute', {
      tool: 'neon/run_sql',
      args: { sql: 'SELECT 1', project_id: 'proj-abc' },
    });

    assert.equal(result.isError, undefined, `expected success, got: ${result.content[0]?.text}`);
    assert.equal(callLog.length, 1);
    assert.equal(callLog[0].serverId, 'neon');
    assert.equal(callLog[0].toolName, 'run_sql');
    assert.deepEqual(callLog[0].args, { sql: 'SELECT 1', project_id: 'proj-abc' });
  } finally {
    await agg.shutdown();
  }
});

// ── 3. handleExecute: non-object args coerced to empty object ─────────────────

test('execute: non-object args coerced to {} before forwarding', async () => {
  const callLog: Array<{ serverId: string; toolName: string; args: Record<string, unknown> }> = [];
  const tools: ToolEntry[] = [
    { name: 'ping', description: 'Ping', inputSchema: { type: 'object', properties: {} } },
  ];
  const agg = new Aggregator([NEON_CFG], {
    backendFactory: () => makeTrackingBackend(callLog, tools),
    embedEnabled: false,
  });

  try {
    // args is a string, an array, and null — all should coerce to {}
    await agg.callTool('ch1tty/execute', { tool: 'neon/ping', args: 'invalid-string' });
    await agg.callTool('ch1tty/execute', { tool: 'neon/ping', args: [1, 2, 3] });
    await agg.callTool('ch1tty/execute', { tool: 'neon/ping', args: null });

    assert.equal(callLog.length, 3, 'all three calls should reach the backend');
    for (const call of callLog) {
      assert.deepEqual(call.args, {}, `expected {}, got ${JSON.stringify(call.args)}`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── 4. handleExecute: backend throws → isError "Execute failed" ───────────────

test('execute: backend.callTool throws → isError:true with Execute failed message', async () => {
  const agg = new Aggregator([NEON_CFG], {
    backendFactory: () => makeFiringBackend(),
    embedEnabled: false,
  });

  try {
    const result = await agg.callTool('ch1tty/execute', { tool: 'neon/kaboom' });

    assert.equal(result.isError, true);
    const msg = result.content[0].text as string;
    assert.match(msg, /Execute failed for neon\/kaboom/);
    assert.match(msg, /backend exploded/);
  } finally {
    await agg.shutdown();
  }
});

// ── 5. handleSearch recentlyUsed: session tracker fallback ────────────────────
// coordinator.onToolCall is a no-op without onSessionStart (no ctx), so when
// sessions.getOrCreate + sessions.recordToolCall are called without a coordinator
// context, recentServerIds is populated via the session-tracker fallback path
// (aggregator.ts:386–391, the `if (recentServerIds.size === 0)` branch).

test('search recentlyUsed via session-tracker fallback (no coordinator context)', async () => {
  const fb = new FixtureBackend();
  fb.defineServer('neon', FIXTURE_SERVERS.neon);
  fb.defineServer('tasks', FIXTURE_SERVERS.tasks);
  const agg = makeAgg([NEON_CFG, TASKS_CFG], fb);

  const sessionId = 'cc-session-1';

  try {
    // Create the session in the tracker only (NOT in coordinator) so the
    // coordinator-affinity block is empty and the fallback fires.
    agg.sessions.getOrCreate(sessionId, 'stdio');
    agg.sessions.recordToolCall(sessionId, 'neon/list_projects');

    // Search with the same session — fallback path should annotate neon tools
    const searchResult = await agg.callTool('ch1tty/search', { query: 'neon' }, sessionId);
    const data = JSON.parse(searchResult.content[0].text as string);

    const neonTools = (data.tools as Array<{ server: string; recentlyUsed?: boolean | { callCount: number; lastUsedMs: number } }>)
      .filter((t) => t.server === 'neon');

    assert.ok(neonTools.length > 0, 'should find neon tools');
    assert.ok(
      neonTools.every((t) => !!t.recentlyUsed),
      `all neon tools should carry recentlyUsed (bool or object); got: ${JSON.stringify(neonTools)}`,
    );

    // tasks tools should NOT be marked recentlyUsed
    const tasksResult = await agg.callTool('ch1tty/search', { query: 'task' }, sessionId);
    const tasksData = JSON.parse(tasksResult.content[0].text as string);
    const taskTools = tasksData.tools as Array<{ recentlyUsed?: boolean }>;
    assert.ok(
      taskTools.every((t) => t.recentlyUsed === undefined),
      'tasks tools must NOT have recentlyUsed (only neon was recorded)',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── 6. handleSearch: recently-used tools sorted before non-recent (coordinator path) ─────

test('search: coordinator-affinity recently-used server tools sort before non-recent', async () => {
  const fb = new FixtureBackend();
  fb.defineServer('neon', FIXTURE_SERVERS.neon);
  fb.defineServer('tasks', FIXTURE_SERVERS.tasks);

  // tasks first in config so it wins stable-sort without any affinity
  const agg = makeAgg([TASKS_CFG, NEON_CFG], fb);
  const sessionId = 'cc-session-2';

  try {
    // onSessionStart creates the coordinator context so onToolCall records affinity
    await agg.coordinator.onSessionStart(sessionId, 'stdio');

    // Execute a neon tool → coordinator records neon affinity
    const execResult = await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects' }, sessionId);
    assert.equal(execResult.isError, undefined, `execute failed: ${execResult.content[0]?.text}`);

    // "list" matches list_projects (neon) and list_tasks (tasks) — both appear
    const result = await agg.callTool('ch1tty/search', { query: 'list' }, sessionId);
    const data = JSON.parse(result.content[0].text as string);
    const tools: Array<{ server: string; recentlyUsed?: boolean }> = data.tools;

    const firstNeonIdx = tools.findIndex((t) => t.server === 'neon');
    const firstTasksIdx = tools.findIndex((t) => t.server === 'tasks');

    assert.ok(firstNeonIdx !== -1, 'neon tools must appear in results');
    assert.ok(firstTasksIdx !== -1, 'tasks tools must appear in results');
    assert.ok(
      firstNeonIdx < firstTasksIdx,
      `neon (recently used via coordinator) should precede tasks; firstNeonIdx=${firstNeonIdx}, firstTasksIdx=${firstTasksIdx}`,
    );

    assert.ok(!!tools[firstNeonIdx].recentlyUsed, 'first neon tool: recentlyUsed must be truthy (bool or object)');
    assert.equal(tools[firstTasksIdx].recentlyUsed, undefined, 'first tasks tool: no recentlyUsed flag');
  } finally {
    await agg.shutdown();
  }
});

// ── 7. handleSearch: no sessionId → no recentlyUsed ──────────────────────────

test('search without sessionId: no recentlyUsed annotations on any tool', async () => {
  const fb = new FixtureBackend();
  fb.defineServer('neon', FIXTURE_SERVERS.neon);
  const agg = makeAgg([NEON_CFG], fb);

  try {
    // No sessionId passed
    const result = await agg.callTool('ch1tty/search', { query: 'neon' });
    const data = JSON.parse(result.content[0].text as string);

    assert.ok(
      (data.tools as Array<{ recentlyUsed?: boolean }>).every((t) => t.recentlyUsed === undefined),
      'no recentlyUsed annotations without sessionId',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── 8. shutdown(): shared backend called exactly once ─────────────────────────

test('shutdown: shared Backend instance is shut down exactly once even across two server configs', async () => {
  let shutdownCount = 0;
  const sharedBackend: Backend = {
    registerServer: () => {},
    isRegistered: () => false,
    getStatus: (): BackendStatus => ({ connected: false, toolCount: 0, toolCacheAge: null }),
    listTools: async () => [],
    callTool: async () => ({ content: [] }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => { shutdownCount++; },
  };

  const configs: ServerConfig[] = [
    { id: 'alpha', name: 'Alpha', type: 'remote', access: 'read', category: 'code', endpoint: 'https://alpha.example.com/mcp' },
    { id: 'beta',  name: 'Beta',  type: 'remote', access: 'read', category: 'ecosystem', endpoint: 'https://beta.example.com/mcp' },
  ];

  // Both configs map to the same Backend object via backendFactory
  const agg = new Aggregator(configs, {
    backendFactory: () => sharedBackend,
    embedEnabled: false,
  });

  assert.equal(shutdownCount, 0, 'no shutdown before explicit call');
  await agg.shutdown();
  assert.equal(shutdownCount, 1, 'shared backend must be shut down exactly once (seen Set dedup)');
});
