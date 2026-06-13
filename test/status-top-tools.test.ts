/**
 * U: ch1tty/status per-session topTools reporting
 *
 * When tools are executed in a session, coordinator.getSnapshot() surfaces the
 * top 5 most-called tools (by count, descending) as `topTools: string[]` on
 * each session entry under `coordinator.sessions`.
 *
 * Rules:
 * - Session with no tool calls → topTools: []
 * - Single tool call → topTools contains that tool
 * - Multiple tools → sorted by call count descending
 * - More than 5 unique tools called → topTools capped at 5
 * - topTools entries are namespaced tool names (serverId/toolName)
 * - Session with no tool calls (zero) → topTools: []
 * - Two sessions → independent topTools per session
 *
 * Tests:
 *   1. Session with no tool calls → topTools: []
 *   2. Single tool call → topTools contains that tool
 *   3. Most-called tool ranks first in topTools
 *   4. topTools capped at 5 even with more unique tools called
 *   5. topTools entries are namespaced tool names (serverId/toolName)
 *   6. topTools absent or empty when session has 0 tool calls after start
 *   7. Two sessions → independent topTools per session
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-stt-${label}-${Date.now()}.jsonl`);
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const NEON_TOOLS: ToolEntry[] = [
  { name: 'list_projects', description: 'List Neon projects', inputSchema: { type: 'object', properties: {} } },
  { name: 'run_sql', description: 'Run SQL on Neon', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_project', description: 'Create a Neon project', inputSchema: { type: 'object', properties: {} } },
  { name: 'describe_project', description: 'Describe a Neon project', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_branch', description: 'Create a Neon branch', inputSchema: { type: 'object', properties: {} } },
  { name: 'delete_branch', description: 'Delete a Neon branch', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_branch_computes', description: 'List branch computes', inputSchema: { type: 'object', properties: {} } },
];

const NEON_CFG: ServerConfig = {
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

const neonBackend = makeStaticBackend(NEON_TOOLS);

function makeAgg(label: string): Aggregator {
  return new Aggregator([NEON_CFG], {
    backendFactory: () => neonBackend,
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    embedEnabled: false,
    ledgerDlqPath: dlqPath(label),
  });
}

type SessionEntry = { sessionId: string; topTools: string[] };

// ── 1. Session with no tool calls → topTools: [] ─────────────────────────────

test('status: session with no tool calls → topTools: []', async () => {
  const agg = makeAgg('1');
  const SID = 'stt-empty';
  await agg.coordinator.onSessionStart(SID, 'http');
  const snap = agg.getStatusSnapshot();
  const entry = snap.coordinator.sessions.find((s: SessionEntry) => s.sessionId === SID);
  assert.ok(entry, 'session entry present');
  assert.deepEqual(entry.topTools, []);
});

// ── 2. Single tool call → topTools contains that tool ────────────────────────

test('status: single tool call → topTools contains that tool', async () => {
  const agg = makeAgg('2');
  const SID = 'stt-single';
  await agg.coordinator.onSessionStart(SID, 'http');
  await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects' }, SID);
  const snap = agg.getStatusSnapshot();
  const entry = snap.coordinator.sessions.find((s: SessionEntry) => s.sessionId === SID);
  assert.ok(Array.isArray(entry.topTools));
  assert.equal(entry.topTools.length, 1);
  assert.equal(entry.topTools[0], 'neon/list_projects');
});

// ── 3. Most-called tool ranks first in topTools ───────────────────────────────

test('status: most-called tool ranks first in topTools', async () => {
  const agg = makeAgg('3');
  const SID = 'stt-rank';
  await agg.coordinator.onSessionStart(SID, 'http');
  // call list_projects 3x, run_sql 1x
  for (let i = 0; i < 3; i++) {
    await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects' }, SID);
  }
  await agg.callTool('ch1tty/execute', { tool: 'neon/run_sql' }, SID);
  const snap = agg.getStatusSnapshot();
  const entry = snap.coordinator.sessions.find((s: SessionEntry) => s.sessionId === SID);
  assert.equal(entry.topTools[0], 'neon/list_projects', 'most-called tool first');
  assert.equal(entry.topTools[1], 'neon/run_sql', 'second-most-called tool second');
});

// ── 4. topTools capped at 5 even with more unique tools called ────────────────

test('status: topTools capped at 5 even with more unique tools called', async () => {
  const agg = makeAgg('4');
  const SID = 'stt-cap';
  await agg.coordinator.onSessionStart(SID, 'http');
  const tools = [
    'neon/list_projects', 'neon/run_sql', 'neon/create_project',
    'neon/describe_project', 'neon/create_branch', 'neon/delete_branch',
    'neon/list_branch_computes',
  ];
  for (const t of tools) {
    await agg.callTool('ch1tty/execute', { tool: t }, SID);
  }
  const snap = agg.getStatusSnapshot();
  const entry = snap.coordinator.sessions.find((s: SessionEntry) => s.sessionId === SID);
  assert.equal(entry.topTools.length, 5, 'topTools capped at 5');
});

// ── 5. topTools entries are namespaced tool names (serverId/toolName) ─────────

test('status: topTools entries are namespaced tool names', async () => {
  const agg = makeAgg('5');
  const SID = 'stt-ns';
  await agg.coordinator.onSessionStart(SID, 'http');
  await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects' }, SID);
  const snap = agg.getStatusSnapshot();
  const entry = snap.coordinator.sessions.find((s: SessionEntry) => s.sessionId === SID);
  assert.match(entry.topTools[0], /^\w[\w-]+\/\w/, 'tool name is namespaced');
});

// ── 6. topTools is empty array when no tool calls made after session start ────

test('status: topTools is [] immediately after session start', async () => {
  const agg = makeAgg('6');
  const SID = 'stt-zero';
  await agg.coordinator.onSessionStart(SID, 'http');
  // no execute calls
  const snap = agg.getStatusSnapshot();
  const entry = snap.coordinator.sessions.find((s: SessionEntry) => s.sessionId === SID);
  assert.ok(Array.isArray(entry.topTools), 'topTools is an array');
  assert.deepEqual(entry.topTools, []);
});

// ── 7. Two sessions → independent topTools per session ───────────────────────

test('status: two sessions → independent topTools per session', async () => {
  const agg = makeAgg('7');
  const SID_A = 'stt-indep-a';
  const SID_B = 'stt-indep-b';
  await agg.coordinator.onSessionStart(SID_A, 'http');
  await agg.coordinator.onSessionStart(SID_B, 'http');
  await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects' }, SID_A);
  await agg.callTool('ch1tty/execute', { tool: 'neon/run_sql' }, SID_B);
  const snap = agg.getStatusSnapshot();
  const entryA = snap.coordinator.sessions.find((s: SessionEntry) => s.sessionId === SID_A);
  const entryB = snap.coordinator.sessions.find((s: SessionEntry) => s.sessionId === SID_B);
  assert.equal(entryA.topTools[0], 'neon/list_projects', 'session A top tool');
  assert.equal(entryB.topTools[0], 'neon/run_sql', 'session B top tool');
});
