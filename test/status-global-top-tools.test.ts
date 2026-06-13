/**
 * V: ch1tty/status coordinator-level global topTools
 *
 * coordinator.getSnapshot() now includes a top-level `topTools: string[]` that
 * aggregates tool usage counts across ALL active sessions, returning the top 10
 * most-called tools globally. Complements the per-session topTools from
 * Workstream U.
 *
 * Rules:
 * - No sessions → topTools: []
 * - Single session, single tool call → topTools contains that tool
 * - Same tool called in two sessions → counts aggregate; tool appears once
 * - Two sessions with distinct tools → both appear in topTools
 * - Most-called tool (aggregate across sessions) ranks first
 * - topTools capped at 10 even with many unique tools
 * - Tools from ended sessions don't appear (context deleted on session end)
 *
 * Tests:
 *   1. No sessions → topTools: []
 *   2. Single session, single tool call → topTools contains that tool
 *   3. Same tool in two sessions → counts aggregate; tool appears once
 *   4. Different tools in two sessions → both appear in topTools
 *   5. Most-called tool (cross-session aggregate) ranks first
 *   6. topTools capped at 10 with more than 10 unique tools
 *   7. Ended session's tools absent from topTools
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-sgtt-${label}-${Date.now()}.jsonl`);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TOOLS: ToolEntry[] = [
  { name: 'list_projects', description: 'List projects', inputSchema: { type: 'object', properties: {} } },
  { name: 'run_sql', description: 'Run SQL', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_project', description: 'Create project', inputSchema: { type: 'object', properties: {} } },
  { name: 'describe_project', description: 'Describe project', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_branch', description: 'Create branch', inputSchema: { type: 'object', properties: {} } },
  { name: 'delete_branch', description: 'Delete branch', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_branch_computes', description: 'List computes', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_shared_projects', description: 'List shared', inputSchema: { type: 'object', properties: {} } },
  { name: 'describe_branch', description: 'Describe branch', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_connection_string', description: 'Get connection', inputSchema: { type: 'object', properties: {} } },
  { name: 'delete_project', description: 'Delete project', inputSchema: { type: 'object', properties: {} } },
];

const CFG: ServerConfig = {
  id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://neon.test/mcp',
};

function makeStaticBackend(tools: ToolEntry[]): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: tools.length, toolCacheAge: 0 }),
    listTools: async () => tools,
    callTool: async (_sid: string, toolName: string): Promise<ToolCallResult> => ({
      content: [{ type: 'text', text: `${toolName}: ok` }],
    }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

const backend = makeStaticBackend(TOOLS);

function makeAgg(label: string): Aggregator {
  return new Aggregator([CFG], {
    backendFactory: () => backend,
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    embedEnabled: false,
    ledgerDlqPath: dlqPath(label),
  });
}

// ── 1. No sessions → topTools: [] ────────────────────────────────────────────

test('status: no sessions → coordinator topTools: []', () => {
  const agg = makeAgg('1');
  const snap = agg.getStatusSnapshot();
  assert.ok(Array.isArray(snap.coordinator.topTools), 'topTools is an array');
  assert.deepEqual(snap.coordinator.topTools, []);
});

// ── 2. Single session, single tool call → topTools contains that tool ─────────

test('status: single session, single tool call → coordinator topTools contains it', async () => {
  const agg = makeAgg('2');
  const SID = 'sgtt-single';
  await agg.coordinator.onSessionStart(SID, 'http');
  await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects' }, SID);
  const snap = agg.getStatusSnapshot();
  assert.ok(Array.isArray(snap.coordinator.topTools));
  assert.equal(snap.coordinator.topTools.length, 1);
  assert.equal(snap.coordinator.topTools[0], 'neon/list_projects');
});

// ── 3. Same tool in two sessions → counts aggregate; tool appears once ────────

test('status: same tool in two sessions → aggregates to single entry', async () => {
  const agg = makeAgg('3');
  const SID_A = 'sgtt-agg-a';
  const SID_B = 'sgtt-agg-b';
  await agg.coordinator.onSessionStart(SID_A, 'http');
  await agg.coordinator.onSessionStart(SID_B, 'http');
  await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects' }, SID_A);
  await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects' }, SID_B);
  const snap = agg.getStatusSnapshot();
  const occurrences = snap.coordinator.topTools.filter((t: string) => t === 'neon/list_projects').length;
  assert.equal(occurrences, 1, 'tool appears exactly once in global topTools');
  assert.equal(snap.coordinator.topTools[0], 'neon/list_projects', 'aggregated tool ranks first');
});

// ── 4. Different tools in two sessions → both in topTools ─────────────────────

test('status: distinct tools in two sessions → both in coordinator topTools', async () => {
  const agg = makeAgg('4');
  const SID_A = 'sgtt-dist-a';
  const SID_B = 'sgtt-dist-b';
  await agg.coordinator.onSessionStart(SID_A, 'http');
  await agg.coordinator.onSessionStart(SID_B, 'http');
  await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects' }, SID_A);
  await agg.callTool('ch1tty/execute', { tool: 'neon/run_sql' }, SID_B);
  const snap = agg.getStatusSnapshot();
  assert.ok(snap.coordinator.topTools.includes('neon/list_projects'), 'session A tool present');
  assert.ok(snap.coordinator.topTools.includes('neon/run_sql'), 'session B tool present');
});

// ── 5. Most-called tool (cross-session) ranks first ───────────────────────────

test('status: most-called tool cross-session ranks first in coordinator topTools', async () => {
  const agg = makeAgg('5');
  const SID_A = 'sgtt-rank-a';
  const SID_B = 'sgtt-rank-b';
  await agg.coordinator.onSessionStart(SID_A, 'http');
  await agg.coordinator.onSessionStart(SID_B, 'http');
  // list_projects: 1 (session A) + 2 (session B) = 3 total
  await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects' }, SID_A);
  await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects' }, SID_B);
  await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects' }, SID_B);
  // run_sql: 2 total
  await agg.callTool('ch1tty/execute', { tool: 'neon/run_sql' }, SID_A);
  await agg.callTool('ch1tty/execute', { tool: 'neon/run_sql' }, SID_B);
  const snap = agg.getStatusSnapshot();
  assert.equal(snap.coordinator.topTools[0], 'neon/list_projects', 'highest aggregate count ranks first');
  assert.equal(snap.coordinator.topTools[1], 'neon/run_sql', 'second highest ranks second');
});

// ── 6. topTools capped at 10 ──────────────────────────────────────────────────

test('status: coordinator topTools capped at 10 even with more unique tools', async () => {
  const agg = makeAgg('6');
  const SID = 'sgtt-cap';
  await agg.coordinator.onSessionStart(SID, 'http');
  for (const t of TOOLS) {
    await agg.callTool('ch1tty/execute', { tool: `neon/${t.name}` }, SID);
  }
  const snap = agg.getStatusSnapshot();
  assert.ok(snap.coordinator.topTools.length <= 10, `topTools capped at 10 (got ${snap.coordinator.topTools.length})`);
});

// ── 7. Ended session's tools absent from topTools ─────────────────────────────

test('status: ended session tools absent from coordinator topTools', async () => {
  const agg = makeAgg('7');
  const SID_ENDED = 'sgtt-ended';
  const SID_ACTIVE = 'sgtt-active';
  await agg.coordinator.onSessionStart(SID_ENDED, 'http');
  await agg.coordinator.onSessionStart(SID_ACTIVE, 'http');
  await agg.callTool('ch1tty/execute', { tool: 'neon/run_sql' }, SID_ENDED);
  await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects' }, SID_ACTIVE);
  await agg.coordinator.onSessionEnd(SID_ENDED);
  const snap = agg.getStatusSnapshot();
  assert.ok(!snap.coordinator.topTools.includes('neon/run_sql'), 'ended session tool absent');
  assert.ok(snap.coordinator.topTools.includes('neon/list_projects'), 'active session tool present');
});
