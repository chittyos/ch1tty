/**
 * GCM — drift guard: freeze `search tools[]` entry `recentlyUsed` conditional key shapes.
 *
 * source: src-stdio/aggregator.ts ~820–841
 *
 * When a session is active, per-tool `recentlyUsed` takes one of three forms:
 *   - { callCount: number, lastUsedMs: number } — exact-tool-level pattern (tool was called this session)
 *   - true                                      — server-level affinity only (another tool on same server was called)
 *   - absent                                    — tool's server has no affinity in this session
 *
 * GCM-1: Tool-level affinity → recentlyUsed is an object with exactly {callCount, lastUsedMs}
 * GCM-2: Multiple calls to same tool → callCount equals the number of onToolCall invocations
 * GCM-3: Server-level only (different tool on same server was called) → recentlyUsed === true
 * GCM-4: No session affinity for a server → recentlyUsed absent from that server's tools
 * GCM-5: Mixed result — tool-level object, server-level true, and absent — all in the same search response
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-gcm-${label}-${Date.now()}.jsonl`);
}

const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem',
  endpoint: 'https://stripe.test/mcp',
};
const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite', category: 'code',
  endpoint: 'https://neon.test/mcp',
};
const FS_CFG: ServerConfig = {
  id: 'fs', name: 'Filesystem', type: 'remote', access: 'readwrite', category: 'desktop',
  endpoint: 'https://fs.test/mcp',
};

// All descriptions include "service" so GCM-5 can issue one broad query
// that returns tools from every backend in a single response.
const STRIPE_TOOLS: ToolEntry[] = [
  { name: 'create_payment', description: 'Create a new Stripe payment service intent', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_payments', description: 'List recent Stripe payment service intents', inputSchema: { type: 'object', properties: {} } },
];
const NEON_TOOLS: ToolEntry[] = [
  { name: 'run_sql', description: 'Execute SQL on Neon database service', inputSchema: { type: 'object', properties: {} } },
];
const FS_TOOLS: ToolEntry[] = [
  { name: 'read_file', description: 'Read a file from the filesystem service', inputSchema: { type: 'object', properties: {} } },
];

function makeBackend(tools: ToolEntry[]): Backend {
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

function makeAgg(label: string) {
  const backendMap: Record<string, Backend> = {
    stripe: makeBackend(STRIPE_TOOLS),
    neon: makeBackend(NEON_TOOLS),
    fs: makeBackend(FS_TOOLS),
  };
  return new Aggregator([STRIPE_CFG, NEON_CFG, FS_CFG], {
    backendFactory: (cfg) => backendMap[cfg.id] ?? makeBackend([]),
    ledgerDlqPath: dlqPath(label),
    embedEnabled: false,
  });
}

// GCM-1: Tool-level affinity → recentlyUsed is an object with exactly {callCount, lastUsedMs}
test('GCM-1: tool-level affinity → recentlyUsed is {callCount,lastUsedMs} object (not true, not absent)', async () => {
  const agg = makeAgg('gcm1');
  try {
    const sid = 'gcm-session-1';
    await agg.coordinator.onSessionStart(sid, 'stdio');
    agg.coordinator.onToolCall(sid, 'stripe/create_payment');

    const result = await agg.callTool('ch1tty/search', { query: 'payment', server: 'stripe' }, sid);
    assert.ok(!result.isError, 'search must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text);
    assert.ok(Array.isArray(body.tools), 'body.tools must be an array');

    const entry = (body.tools as Record<string, unknown>[]).find((t) => t.tool === 'stripe/create_payment');
    assert.ok(entry !== undefined, 'stripe/create_payment must appear in results');

    const ru = entry.recentlyUsed;
    assert.notEqual(ru, undefined, 'recentlyUsed must be present for a called tool');
    assert.notStrictEqual(ru, true, 'recentlyUsed must NOT be the boolean true for a tool-level pattern');
    assert.equal(typeof ru, 'object', 'recentlyUsed must be an object for tool-level affinity');
    assert.ok(ru !== null, 'recentlyUsed must not be null');

    const obj = ru as Record<string, unknown>;
    assert.ok('callCount' in obj, 'recentlyUsed must have callCount');
    assert.ok('lastUsedMs' in obj, 'recentlyUsed must have lastUsedMs');
    // No extra keys beyond the two required ones
    const keys = Object.keys(obj).sort();
    assert.deepEqual(keys, ['callCount', 'lastUsedMs'], 'recentlyUsed object must have exactly {callCount,lastUsedMs}');
  } finally {
    await agg.shutdown();
  }
});

// GCM-2: Multiple calls to same tool → callCount equals the number of onToolCall invocations
test('GCM-2: multiple onToolCall invocations → callCount increments correctly', async () => {
  const agg = makeAgg('gcm2');
  try {
    const sid = 'gcm-session-2';
    await agg.coordinator.onSessionStart(sid, 'stdio');
    agg.coordinator.onToolCall(sid, 'neon/run_sql');
    agg.coordinator.onToolCall(sid, 'neon/run_sql');
    agg.coordinator.onToolCall(sid, 'neon/run_sql');

    const result = await agg.callTool('ch1tty/search', { query: 'sql', server: 'neon' }, sid);
    assert.ok(!result.isError);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    const entry = (body.tools as Record<string, unknown>[]).find((t) => t.tool === 'neon/run_sql');
    assert.ok(entry !== undefined, 'neon/run_sql must appear');

    const ru = entry.recentlyUsed as { callCount: number; lastUsedMs: number };
    assert.ok(typeof ru === 'object' && ru !== null && ru !== true, 'recentlyUsed must be an object');
    assert.equal(ru.callCount, 3, 'callCount must equal the number of onToolCall invocations (3)');
    assert.equal(typeof ru.lastUsedMs, 'number', 'lastUsedMs must be a number');
    assert.ok(ru.lastUsedMs > 0, 'lastUsedMs must be a positive timestamp');
  } finally {
    await agg.shutdown();
  }
});

// GCM-3: Server-level only (different tool on same server was called) → recentlyUsed === true
test('GCM-3: server-level-only affinity → recentlyUsed is exactly true (not an object)', async () => {
  const agg = makeAgg('gcm3');
  try {
    const sid = 'gcm-session-3';
    await agg.coordinator.onSessionStart(sid, 'stdio');
    // Called create_payment, but we will search for list_payments (different tool, same server)
    agg.coordinator.onToolCall(sid, 'stripe/create_payment');

    const result = await agg.callTool('ch1tty/search', { query: 'payments list', server: 'stripe' }, sid);
    assert.ok(!result.isError);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    const entry = (body.tools as Record<string, unknown>[]).find((t) => t.tool === 'stripe/list_payments');
    assert.ok(entry !== undefined, 'stripe/list_payments must appear in results');

    const ru = entry.recentlyUsed;
    assert.notEqual(ru, undefined, 'recentlyUsed must be present (server affinity exists for stripe)');
    assert.strictEqual(ru, true, 'recentlyUsed must be exactly true for server-level-only affinity');
  } finally {
    await agg.shutdown();
  }
});

// GCM-4: No session affinity for a server → recentlyUsed absent from that server's tools
test('GCM-4: no session affinity for a server → recentlyUsed absent from its tools', async () => {
  const agg = makeAgg('gcm4');
  try {
    const sid = 'gcm-session-4';
    await agg.coordinator.onSessionStart(sid, 'stdio');
    // Establish affinity only for stripe — not for neon or fs
    agg.coordinator.onToolCall(sid, 'stripe/create_payment');

    const result = await agg.callTool('ch1tty/search', { server: 'neon' }, sid);
    assert.ok(!result.isError);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    assert.ok(Array.isArray(body.tools) && body.tools.length > 0, 'neon tools must be returned');

    for (const entry of body.tools as Record<string, unknown>[]) {
      assert.equal(entry.server, 'neon', 'all returned tools must be from neon');
      assert.equal(
        entry.recentlyUsed,
        undefined,
        `neon tool ${entry.tool} must NOT have recentlyUsed (no neon affinity in session)`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// GCM-5: Mixed result — tool-level object, server-level true, and absent — all in the same response
test('GCM-5: mixed recentlyUsed shapes in same search response (object + true + absent)', async () => {
  const agg = makeAgg('gcm5');
  try {
    const sid = 'gcm-session-5';
    await agg.coordinator.onSessionStart(sid, 'stdio');
    // stripe/create_payment: called → tool-level object
    agg.coordinator.onToolCall(sid, 'stripe/create_payment');
    // stripe/list_payments: same server, not called → server-level true
    // neon/run_sql: no affinity for neon at all → absent
    // (fs has no affinity either — will remain absent)

    // Single search across all servers — query 'service' matches every tool description
    // so the response contains all three recentlyUsed shapes in one tools[] array.
    // This validates the cross-server case: a bug that applies stripe's affinity to neon
    // tools would show recentlyUsed on neon/run_sql, caught here but not by separate searches.
    const result = await agg.callTool('ch1tty/search', { query: 'service' }, sid);
    assert.ok(!result.isError, 'broad service query must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text);
    assert.ok(Array.isArray(body.tools), 'tools must be an array');

    const byTool = new Map<string, Record<string, unknown>>();
    for (const entry of body.tools as Record<string, unknown>[]) {
      byTool.set(entry.tool as string, entry);
    }

    // All four tools must appear in the single response
    assert.ok(byTool.has('stripe/create_payment'), 'stripe/create_payment must appear');
    assert.ok(byTool.has('stripe/list_payments'), 'stripe/list_payments must appear');
    assert.ok(byTool.has('neon/run_sql'), 'neon/run_sql must appear');

    // stripe/create_payment: tool-level → object with {callCount, lastUsedMs}
    const calledTool = byTool.get('stripe/create_payment')!;
    const ruObj = calledTool.recentlyUsed;
    assert.ok(
      typeof ruObj === 'object' && ruObj !== null && ruObj !== true,
      'stripe/create_payment must have tool-level recentlyUsed object (not true, not absent)',
    );
    assert.ok('callCount' in (ruObj as object), 'tool-level recentlyUsed must include callCount');

    // stripe/list_payments: server-level only → exactly true
    const serverOnlyTool = byTool.get('stripe/list_payments')!;
    assert.strictEqual(
      serverOnlyTool.recentlyUsed,
      true,
      'stripe/list_payments must have recentlyUsed===true (server-level, not tool-level)',
    );

    // neon/run_sql: no affinity → absent (verifies affinity does NOT cross server boundaries)
    const noAffinityTool = byTool.get('neon/run_sql')!;
    assert.equal(
      noAffinityTool.recentlyUsed,
      undefined,
      'neon/run_sql must NOT have recentlyUsed — stripe affinity must not leak to neon tools',
    );
  } finally {
    await agg.shutdown();
  }
});
