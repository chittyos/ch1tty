/**
 * AAA batch — 6 tests covering previously untested branches:
 *
 * 1. handleExecute: orphaned server (in activeConfigs but NOT in backends map)
 *    → isError:true, message says "Unknown server X", AND X appears in "Known servers".
 *    The paradox invariant: config makes the server "known" to activeConfigs but the
 *    missing backends entry still causes the execute to fail.
 *    Source: aggregator.ts:539–548 (backendFor returns undefined → knownServers list
 *    built from activeConfigs, which still contains the orphaned id).
 *
 * 2. handleExecute: orphaned server with two active configs → knownServers lists BOTH.
 *    Verifies the knownServers list concatenation covers all active configs, not just
 *    the lookup target.
 *
 * 3. getStatusSnapshot: single orphaned server → server entry uses the ?? fallback
 *    ({connected:false, toolCount:0, toolCacheAge:null}) at aggregator.ts:587.
 *    Distinct from status-snapshot.test.ts which uses empty config arrays (no loop runs).
 *
 * 4. getStatusSnapshot: two servers, one orphaned → only the orphaned entry uses the
 *    fallback; the healthy server shows real status from its backend.
 *
 * 5. ch1tty/status meta-tool with orphaned server → the returned JSON includes the
 *    orphaned server with connected:false in the servers array (end-to-end through
 *    handleStatus → getStatusSnapshot).
 *
 * 6. handleSearch: query result JSON includes the sessionId field when callTool is
 *    invoked with a sessionId (aggregator.ts:503 — ...(sessionId ? { sessionId } : {})).
 *    Previously untested: all search tests checking result content omit the sessionId
 *    assertion.
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-aaa-${label}-${Date.now()}.jsonl`);
}

function makeSimpleBackend(toolName = 'do_thing', toolDesc = 'do something'): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: 1, toolCacheAge: 0 }),
    listTools: async (): Promise<ToolEntry[]> => [
      { name: toolName, description: toolDesc, inputSchema: { type: 'object', properties: {} } },
    ],
    callTool: async (): Promise<ToolCallResult> => ({ content: [{ type: 'text', text: '{"ok":true}' }] }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async (_s, uri) => ({ contents: [{ uri, text: 'ok' }] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

function singleAgg(serverId: string, backendOverride?: Partial<Backend>): Aggregator {
  const config: ServerConfig = {
    id: serverId,
    name: `${serverId}-name`,
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: `https://${serverId}.example.com/mcp`,
    lazy: true,
  };
  return new Aggregator([config], {
    backendFactory: () => ({ ...makeSimpleBackend(), ...backendOverride }),
    embedEnabled: false,
    suggestionsCatalog: {},
    focusProfiles: { profiles: {} },
    ledgerDlqPath: dlqPath(serverId),
  });
}

function orphan(agg: Aggregator, serverId: string): void {
  (agg as unknown as { backends: Map<string, unknown> }).backends.delete(serverId);
}

// ── 1. handleExecute: orphaned server → isError + orphan in knownServers ─────

test('handleExecute: orphaned server → isError + orphaned id appears in Known servers', async () => {
  const agg = singleAgg('orphan-svc');
  try {
    orphan(agg, 'orphan-svc');

    const result = await agg.callTool('ch1tty/execute', { tool: 'orphan-svc/do_thing' });
    assert.equal(result.isError, true, 'orphaned execute must return isError:true');

    const msg = (result.content[0] as { type: 'text'; text: string }).text;
    assert.match(msg, /Unknown server "orphan-svc"/, 'error identifies the orphaned server name');
    assert.match(
      msg,
      /Known servers:.*orphan-svc/,
      'orphaned server still listed in Known servers — activeConfigs still includes it',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── 2. handleExecute: two configs, one orphaned → knownServers lists both ────

test('handleExecute: orphaned server with two active configs → knownServers includes both', async () => {
  const configA: ServerConfig = {
    id: 'alpha-svc',
    name: 'Alpha',
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: 'https://alpha.example.com/mcp',
    lazy: true,
  };
  const configB: ServerConfig = {
    id: 'beta-svc',
    name: 'Beta',
    type: 'remote',
    access: 'readwrite',
    category: 'code',
    endpoint: 'https://beta.example.com/mcp',
    lazy: true,
  };
  const agg = new Aggregator([configA, configB], {
    backendFactory: () => makeSimpleBackend(),
    embedEnabled: false,
    suggestionsCatalog: {},
    focusProfiles: { profiles: {} },
    ledgerDlqPath: dlqPath('two-configs'),
  });
  try {
    // Orphan alpha-svc while beta-svc stays connected
    orphan(agg, 'alpha-svc');

    const result = await agg.callTool('ch1tty/execute', { tool: 'alpha-svc/do_thing' });
    assert.equal(result.isError, true, 'isError:true for orphaned alpha-svc');

    const msg = (result.content[0] as { type: 'text'; text: string }).text;
    assert.match(msg, /Unknown server "alpha-svc"/, 'names the orphaned server');
    assert.match(msg, /alpha-svc/, 'alpha-svc appears in Known servers list');
    assert.match(msg, /beta-svc/, 'beta-svc also appears in Known servers list');
  } finally {
    await agg.shutdown();
  }
});

// ── 3. getStatusSnapshot: orphaned server → ?? fallback fires ────────────────

test('getStatusSnapshot: orphaned server uses ?? fallback {connected:false, toolCount:0, toolCacheAge:null}', async () => {
  const agg = singleAgg('orphan-snap');
  try {
    orphan(agg, 'orphan-snap');

    const snap = agg.getStatusSnapshot();
    assert.equal(snap.servers.length, 1, 'orphaned server still appears in servers array');

    const srv = snap.servers[0];
    assert.equal(srv.id, 'orphan-snap');
    assert.equal(srv.connected, false, 'orphaned server: connected must be false (fallback)');
    assert.equal(srv.toolCount, 0, 'orphaned server: toolCount must be 0 (fallback)');
    assert.equal(srv.toolCacheAge, null, 'orphaned server: toolCacheAge must be null (fallback)');
  } finally {
    await agg.shutdown();
  }
});

// ── 4. getStatusSnapshot: two servers, one orphaned → mixed statuses ─────────

test('getStatusSnapshot: two servers, one orphaned → only orphaned entry uses fallback', async () => {
  const configA: ServerConfig = {
    id: 'healthy-snap',
    name: 'Healthy',
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: 'https://healthy.example.com/mcp',
    lazy: true,
  };
  const configB: ServerConfig = {
    id: 'orphan-snap-b',
    name: 'Orphan B',
    type: 'remote',
    access: 'readwrite',
    category: 'code',
    endpoint: 'https://orphan-b.example.com/mcp',
    lazy: true,
  };
  const agg = new Aggregator([configA, configB], {
    backendFactory: () => makeSimpleBackend('healthy_tool', 'healthy tool'),
    embedEnabled: false,
    suggestionsCatalog: {},
    focusProfiles: { profiles: {} },
    ledgerDlqPath: dlqPath('two-snap'),
  });
  try {
    orphan(agg, 'orphan-snap-b');

    const snap = agg.getStatusSnapshot();
    assert.equal(snap.servers.length, 2, 'both servers in snapshot');

    const healthy = snap.servers.find((s) => s.id === 'healthy-snap');
    const orphanEntry = snap.servers.find((s) => s.id === 'orphan-snap-b');

    assert.ok(healthy, 'healthy server in snapshot');
    assert.ok(orphanEntry, 'orphaned server in snapshot');

    // Healthy server uses real backend status (connected:true, toolCount:1)
    assert.equal(healthy!.connected, true, 'healthy server: real backend status → connected:true');
    assert.equal(healthy!.toolCount, 1, 'healthy server: real backend status → toolCount:1');

    // Orphaned server falls back to the ?? default
    assert.equal(orphanEntry!.connected, false, 'orphaned server: fallback → connected:false');
    assert.equal(orphanEntry!.toolCount, 0, 'orphaned server: fallback → toolCount:0');
    assert.equal(orphanEntry!.toolCacheAge, null, 'orphaned server: fallback → toolCacheAge:null');
  } finally {
    await agg.shutdown();
  }
});

// ── 5. ch1tty/status meta-tool with orphaned server ─────────────────────────

test('ch1tty/status: orphaned server shows connected:false in servers JSON', async () => {
  const agg = singleAgg('orphan-meta');
  try {
    orphan(agg, 'orphan-meta');

    const result = await agg.callTool('ch1tty/status', {});
    assert.ok(!result.isError, 'ch1tty/status must not return isError');

    const status = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as {
      servers: Array<{ id: string; connected: boolean; toolCount: number }>;
    };
    const srv = status.servers.find((s) => s.id === 'orphan-meta');
    assert.ok(srv, 'orphaned server must appear in status.servers');
    assert.equal(srv!.connected, false, 'orphaned server connected:false in status JSON');
    assert.equal(srv!.toolCount, 0, 'orphaned server toolCount:0 in status JSON');
  } finally {
    await agg.shutdown();
  }
});

// ── 6. handleSearch: query result JSON includes sessionId when provided ──────

test('handleSearch: result JSON includes sessionId field when callTool is passed a sessionId', async () => {
  const agg = singleAgg('search-sess');
  try {
    const sessionId = 'aaa-search-session-1';

    const result = await agg.callTool('ch1tty/search', { query: 'do' }, sessionId);
    assert.ok(!result.isError, 'search must not error');

    const data = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as {
      sessionId?: string;
      tools: unknown[];
    };
    assert.equal(
      data.sessionId,
      sessionId,
      'search result JSON must include the sessionId when callTool is called with a sessionId (aggregator.ts:503)',
    );
  } finally {
    await agg.shutdown();
  }
});
