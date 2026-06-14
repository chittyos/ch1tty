/**
 * PP: ch1tty/status coordinator.toolsByServer breakdown
 *
 * coordinator.getSnapshot() now includes `toolsByServer: Record<string, number>` — a
 * flat map of server ID → total tool call count aggregated across all active sessions.
 * Server IDs are extracted from the namespaced `serverId/toolName` format. Only servers
 * with at least one call appear; zero-count servers are omitted.
 *
 * Rules:
 * - No sessions → toolsByServer: {}
 * - Single tool call → { serverId: 1 }
 * - Multiple calls to same server → counts aggregated
 * - Calls to two different servers → both present
 * - Multiple sessions → counts aggregated across sessions
 * - short: true preserves toolsByServer (coordinator-level field, not sessions)
 * - Ended session's tools absent (context deleted on session end)
 *
 * Tests:
 *   1. No sessions → toolsByServer: {}
 *   2. Single tool call → { neon: 1 }
 *   3. Multiple calls same server → count accumulated
 *   4. Two servers → both appear with correct counts
 *   5. Cross-session aggregation for same server
 *   6. short: true mode preserves toolsByServer in coordinator
 *   7. Ended session tools absent from toolsByServer
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-pp-tbs-${label}-${Date.now()}.jsonl`);
}

const NEON_TOOLS: ToolEntry[] = [
  { name: 'list_projects', description: 'List projects', inputSchema: { type: 'object', properties: {} } },
  { name: 'run_sql', description: 'Run SQL', inputSchema: { type: 'object', properties: {} } },
];

const EVIDENCE_TOOLS: ToolEntry[] = [
  { name: 'ai_search', description: 'AI search', inputSchema: { type: 'object', properties: {} } },
];

const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://neon.test/mcp',
};

const EVIDENCE_CFG: ServerConfig = {
  id: 'evidence', name: 'Evidence', type: 'remote', access: 'read',
  category: 'search', endpoint: 'https://evidence.test/mcp',
};

function makeBackend(tools: ToolEntry[]): Backend {
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

const neonBackend = makeBackend(NEON_TOOLS);
const evidenceBackend = makeBackend(EVIDENCE_TOOLS);

function makeAgg(label: string, configs = [NEON_CFG]): Aggregator {
  return new Aggregator(configs, {
    backendFactory: (cfg) => cfg.id === 'evidence' ? evidenceBackend : neonBackend,
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    embedEnabled: false,
    ledgerDlqPath: dlqPath(label),
  });
}

// ── 1. No sessions → toolsByServer: {} ───────────────────────────────────────

test('status toolsByServer: no sessions → empty object', () => {
  const agg = makeAgg('1');
  const snap = agg.getStatusSnapshot();
  assert.ok('toolsByServer' in snap.coordinator, 'toolsByServer field present');
  assert.deepEqual(snap.coordinator.toolsByServer, {});
});

// ── 2. Single tool call → { neon: 1 } ────────────────────────────────────────

test('status toolsByServer: single call → { neon: 1 }', async () => {
  const agg = makeAgg('2');
  const SID = 'pp-single';
  await agg.coordinator.onSessionStart(SID, 'http');
  await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects' }, SID);
  const snap = agg.getStatusSnapshot();
  assert.deepEqual(snap.coordinator.toolsByServer, { neon: 1 });
});

// ── 3. Multiple calls same server → count accumulated ────────────────────────

test('status toolsByServer: multiple calls same server accumulate', async () => {
  const agg = makeAgg('3');
  const SID = 'pp-multi';
  await agg.coordinator.onSessionStart(SID, 'http');
  await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects' }, SID);
  await agg.callTool('ch1tty/execute', { tool: 'neon/run_sql' }, SID);
  await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects' }, SID);
  const snap = agg.getStatusSnapshot();
  assert.deepEqual(snap.coordinator.toolsByServer, { neon: 3 });
});

// ── 4. Two servers → both appear with correct counts ─────────────────────────

test('status toolsByServer: two servers → both present with correct counts', async () => {
  const agg = makeAgg('4', [NEON_CFG, EVIDENCE_CFG]);
  const SID = 'pp-two-srv';
  await agg.coordinator.onSessionStart(SID, 'http');
  await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects' }, SID);
  await agg.callTool('ch1tty/execute', { tool: 'neon/run_sql' }, SID);
  await agg.callTool('ch1tty/execute', { tool: 'evidence/ai_search' }, SID);
  const snap = agg.getStatusSnapshot();
  assert.equal(snap.coordinator.toolsByServer['neon'], 2, 'neon has 2 calls');
  assert.equal(snap.coordinator.toolsByServer['evidence'], 1, 'evidence has 1 call');
  assert.equal(Object.keys(snap.coordinator.toolsByServer).length, 2, 'only 2 servers present');
});

// ── 5. Cross-session aggregation for same server ──────────────────────────────

test('status toolsByServer: cross-session aggregation', async () => {
  const agg = makeAgg('5');
  const SID_A = 'pp-cross-a';
  const SID_B = 'pp-cross-b';
  await agg.coordinator.onSessionStart(SID_A, 'http');
  await agg.coordinator.onSessionStart(SID_B, 'http');
  await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects' }, SID_A);
  await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects' }, SID_A);
  await agg.callTool('ch1tty/execute', { tool: 'neon/run_sql' }, SID_B);
  const snap = agg.getStatusSnapshot();
  assert.equal(snap.coordinator.toolsByServer['neon'], 3, 'neon counts summed across sessions');
});

// ── 6. short: true preserves toolsByServer ────────────────────────────────────

test('status toolsByServer: short: true preserves coordinator.toolsByServer', async () => {
  const agg = makeAgg('6');
  const SID = 'pp-short';
  await agg.coordinator.onSessionStart(SID, 'http');
  await agg.callTool('ch1tty/execute', { tool: 'neon/run_sql' }, SID);
  const result = await agg.callTool('ch1tty/status', { short: true }, SID);
  const text = result.content[0].type === 'text' ? result.content[0].text : '';
  const parsed = JSON.parse(text) as { coordinator: { toolsByServer: Record<string, number>; sessions?: unknown[] } };
  assert.ok('toolsByServer' in parsed.coordinator, 'toolsByServer present in short mode');
  assert.deepEqual(parsed.coordinator.toolsByServer, { neon: 1 });
  assert.ok(!('sessions' in parsed.coordinator), 'sessions omitted in short mode');
});

// ── 7. Ended session tools absent ─────────────────────────────────────────────

test('status toolsByServer: ended session tools absent', async () => {
  const agg = makeAgg('7');
  const SID_ENDED = 'pp-ended';
  const SID_ACTIVE = 'pp-active';
  await agg.coordinator.onSessionStart(SID_ENDED, 'http');
  await agg.coordinator.onSessionStart(SID_ACTIVE, 'http');
  await agg.callTool('ch1tty/execute', { tool: 'neon/run_sql' }, SID_ENDED);
  await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects' }, SID_ACTIVE);
  await agg.coordinator.onSessionEnd(SID_ENDED);
  const snap = agg.getStatusSnapshot();
  assert.equal(snap.coordinator.toolsByServer['neon'], 1, 'only active session count present');
});
