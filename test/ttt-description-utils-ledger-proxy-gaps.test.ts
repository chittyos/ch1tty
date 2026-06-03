/**
 * TTT batch — 5 tests covering previously untested branches:
 *
 * 1. aggregator.ts refreshRegistry (line ~240): `description: t.description ?? t.name`
 *    — when listTools() returns a tool with no `description` field, the registry
 *    entry uses `t.name` as the description. All prior tests supply a description
 *    on every fixture tool.
 *
 * 2. utils.ts normalizeToolResult (line 16): `'content' in result` is true but
 *    `Array.isArray(result.content)` is false — falls through to the legacy
 *    toolResult format. All prior utils tests either pass an array content or
 *    omit the content key entirely.
 *
 * 3. ledger.ts bind() (line 93): second call while flushTimer is already set
 *    — reassigns backend and serverId but the `if (!this.flushTimer)` guard
 *    prevents a duplicate setInterval from being created.
 *
 * 4. ledger.ts flush() (line 178): `!this.backend` guard fires when flush() is
 *    called on a client that has buffered entries but was never bound to a backend
 *    — returns 0 immediately; buffer is preserved.
 *
 * 5. remote-proxy.ts getStatus() (lines 386-389): connection exists in the map
 *    (connected: true) but toolCache is null (listTools has not been called yet)
 *    — returns { connected: true, toolCount: 0, toolCacheAge: null }.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { LedgerClient } from '../src/ledger.js';
import { RemoteProxy } from '../src/remote-proxy.js';
import { normalizeToolResult } from '../src/utils.js';
import type { Backend, BackendStatus, ServerConfig } from '../src/types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBackend(tools: Array<{ name: string; description?: string; inputSchema: object }>): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: tools.length, toolCacheAge: null }),
    listTools: async () => tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    callTool: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

function tempDlq(): { dlqPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-ttt-'));
  const dlqPath = join(dir, 'test.dlq.jsonl');
  return { dlqPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ── Test 1 — aggregator description ?? t.name fallback ───────────────────────

test('refreshRegistry: tool with no description falls back to tool name in registry', async () => {
  const config: ServerConfig = {
    id: 'no-desc-srv',
    name: 'No-Desc Server',
    type: 'remote',
    access: 'read',
    category: 'code',
    endpoint: 'https://example.com/mcp',
    lazy: true,
  };

  // Tool has `description: undefined` (field absent) — should fall back to `t.name`
  const backend = makeBackend([
    { name: 'my_tool', inputSchema: { type: 'object', properties: {} } },
  ]);

  const agg = new Aggregator([config], {
    backendFactory: () => backend,
    spawnTimeoutMs: 500,
    remoteTimeoutMs: 500,
  });

  // Search forces refreshRegistry
  const result = await agg.callTool('ch1tty/search', { query: 'my_tool' });
  const body = JSON.parse((result.content[0] as { text: string }).text);

  assert.equal(body.tools.length, 1, 'search must return the tool');
  assert.equal(body.tools[0].description, 'my_tool', 'description falls back to tool name when absent');
});

// ── Test 2 — normalizeToolResult: content present but non-array ───────────────

test('normalizeToolResult: content key present but not an array falls through to legacy path', () => {
  // `content` is a string, not an array → `Array.isArray` returns false →
  // the outer `if` is skipped; execution falls to the legacy toolResult format.
  const result = normalizeToolResult({ content: 'not-an-array' });

  // Legacy path: wraps result.toolResult in JSON.stringify.
  // result.toolResult is undefined → JSON.stringify(undefined) === undefined.
  assert.equal(result.isError, false, 'legacy path always returns isError: false');
  assert.equal(result.content.length, 1, 'exactly one content item produced');
  assert.equal(result.content[0]!.type, 'text', 'content item has type: text');
  // JSON.stringify(undefined) is undefined (not the string "undefined")
  assert.equal(
    (result.content[0] as { type: string; text: unknown }).text,
    undefined,
    'text is undefined when result has no toolResult key',
  );
});

// ── Test 3 — ledger bind() double-call ───────────────────────────────────────

test('LedgerClient.bind(): second call reassigns backend+serverId but does not recreate flushTimer', () => {
  const { dlqPath, cleanup } = tempDlq();
  const client = new LedgerClient(dlqPath);

  const makeBackendFake = (): Backend => ({
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: 0, toolCacheAge: null }),
    listTools: async () => [],
    callTool: async () => ({ content: [] }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  });

  const backend1 = makeBackendFake();
  const backend2 = makeBackendFake();

  type LedgerInternals = {
    backend: Backend | undefined;
    serverId: string | undefined;
    flushTimer: ReturnType<typeof setInterval> | null;
  };

  try {
    // First bind — creates flushTimer
    client.bind(backend1, 'svc-one');
    const internalsAfterFirst = client as unknown as LedgerInternals;
    const timerAfterFirst = internalsAfterFirst.flushTimer;

    assert.ok(timerAfterFirst !== null, 'flushTimer must be set after first bind');
    assert.equal(internalsAfterFirst.serverId, 'svc-one', 'serverId set to svc-one');
    assert.strictEqual(internalsAfterFirst.backend, backend1, 'backend set to backend1');

    // Second bind — guard `if (!this.flushTimer)` is false → timer not recreated
    client.bind(backend2, 'svc-two');
    const internalsAfterSecond = client as unknown as LedgerInternals;

    assert.strictEqual(
      internalsAfterSecond.flushTimer,
      timerAfterFirst,
      'flushTimer must be the same object after second bind (not recreated)',
    );
    assert.equal(internalsAfterSecond.serverId, 'svc-two', 'serverId updated to svc-two');
    assert.strictEqual(internalsAfterSecond.backend, backend2, 'backend updated to backend2');
  } finally {
    client.unbind();
    cleanup();
  }
});

// ── Test 4 — ledger flush() with no backend bound ────────────────────────────

test('LedgerClient.flush(): returns 0 immediately when no backend is bound (entries preserved)', async () => {
  const { dlqPath, cleanup } = tempDlq();
  const client = new LedgerClient(dlqPath);

  try {
    // Record an entry so buffer.length > 0, but never call bind()
    client.record('sess-x', 'tool_call', { tool: 'neon/run_sql' });

    const statsBefore = client.getStats();
    assert.equal(statsBefore.buffered, 1, 'one entry buffered before flush');

    // flush() guard: `!this.backend` fires → returns 0
    const flushed = await client.flush();
    assert.equal(flushed, 0, 'flush() must return 0 when no backend is bound');

    // Buffer is preserved — entry not lost
    const statsAfter = client.getStats();
    assert.equal(statsAfter.buffered, 1, 'entry must still be in buffer after no-op flush');
    assert.equal(statsAfter.flushed, 0, 'totalFlushed must remain 0');
  } finally {
    cleanup();
  }
});

// ── Test 5 — remote-proxy getStatus: connected but toolCache=null ─────────────

test('RemoteProxy.getStatus(): connected but toolCache=null returns { connected:true, toolCount:0, toolCacheAge:null }', () => {
  const proxy = new RemoteProxy();

  proxy.registerServer({
    id: 'no-cache-srv',
    name: 'No Cache',
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: 'https://example.com/mcp',
    lazy: true,
  });

  // Inject a fake connection with toolCache=null to simulate a connected-but-unlisted state.
  // This is the state immediately after doConnect() completes, before listTools() is called.
  type ProxyInternals = { connections: Map<string, { toolCache: null }> };
  (proxy as unknown as ProxyInternals).connections.set('no-cache-srv', { toolCache: null });

  const status = proxy.getStatus('no-cache-srv');
  assert.equal(status.connected, true, 'connected must be true when connection is in the map');
  assert.equal(status.toolCount, 0, 'toolCount must be 0 when toolCache is null');
  assert.equal(status.toolCacheAge, null, 'toolCacheAge must be null when toolCache is null');
});
