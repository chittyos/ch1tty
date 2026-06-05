/**
 * Branch-coverage targets in child-manager.ts and http-server.ts
 *
 * child-manager.ts gaps covered:
 *   1. spawn():42      — unregistered serverId throws "Unknown local server"
 *   2. readResource():298-299 — content item with no 'text' / no 'blob' property
 *   3. getStatus():360-361   — connected server with null toolCache (spawned but never listTools'd)
 *
 * http-server.ts gap covered:
 *   4. constructor():35 — bindAddress defaults to '0.0.0.0' when omitted from options
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ChildManager } from '../src/child-manager.js';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';
import type { LocalServerConfig } from '../src/types.js';

// Shared process.env.CH1TTY_SPAWN_TIMEOUT_MS is already set by child-manager.test.ts.
// If this file runs first, default 30 s timeout would slow things down; 500 ms is fine.
process.env.CH1TTY_SPAWN_TIMEOUT_MS ??= '500';

function localCfg(id: string): LocalServerConfig {
  return { id, name: id, type: 'local', access: 'readwrite', category: 'code', command: `/nonexistent/${id}`, args: [] };
}

// ── 1. spawn():42 — unregistered serverId ────────────────────────────────────

test('spawn: readResource on unregistered serverId throws "Unknown local server"', async () => {
  const cm = new ChildManager();
  // 'ghost' server is never registered — configs map has no entry for it
  await assert.rejects(
    () => cm.readResource('ghost', 'ghost://thing'),
    /Unknown local server: ghost/,
  );
  await cm.shutdown();
});

// ── 2. readResource():298-299 — no 'text' / no 'blob' in content item ────────

test('readResource: content item absent of text and blob → both map to undefined', async () => {
  const cm = new ChildManager();
  cm.registerServer(localCfg('res-svc'));

  // Inject a fake connection.  spawn() returns early via "if (existing) return existing"
  // (line 44 in child-manager.ts), so no real process is spawned.
  const fakeConn = {
    client: {
      readResource: async () => ({
        contents: [
          { uri: 'res://no-fields' },          // neither 'text' nor 'blob' in c
          { uri: 'res://text-only', text: 'hi' }, // 'blob' not in c
          { uri: 'res://blob-only', blob: 'QQ==', mimeType: 'image/png' }, // 'text' not in c
        ],
      }),
      close: async () => {},
    },
    transport: {},
    toolCache: null,
    resourceCache: null,
    promptCache: null,
  };
  (cm as unknown as { children: Map<string, unknown> }).children.set('res-svc', fakeConn);

  const result = await cm.readResource('res-svc', 'res://no-fields');
  // All three contents are returned (client mock ignores the uri arg and returns all)
  const byUri = Object.fromEntries(result.contents.map((c) => [c.uri, c]));

  // no-fields → both text and blob are undefined (false branches on lines 298 and 299)
  assert.equal(byUri['res://no-fields']?.text, undefined, 'text absent → undefined');
  assert.equal(byUri['res://no-fields']?.blob, undefined, 'blob absent → undefined');

  // text-only → text present, blob undefined
  assert.equal(byUri['res://text-only']?.text, 'hi', 'text present');
  assert.equal(byUri['res://text-only']?.blob, undefined, 'blob absent on text-only item');

  // blob-only → blob present, text undefined
  assert.equal(byUri['res://blob-only']?.blob, 'QQ==', 'blob present');
  assert.equal(byUri['res://blob-only']?.text, undefined, 'text absent on blob-only item');

  await cm.shutdown();
});

// ── 3. getStatus():360-361 — null toolCache ───────────────────────────────────

test('getStatus: connected server with null toolCache → toolCount 0, toolCacheAge null', () => {
  const cm = new ChildManager();
  cm.registerServer(localCfg('status-svc'));

  // Directly plant a connection with null toolCache (mirrors what doSpawn returns
  // before listTools is ever called for this server).
  const fakeConn = {
    client: { close: async () => {} },
    transport: {},
    toolCache: null,
    resourceCache: null,
    promptCache: null,
  };
  (cm as unknown as { children: Map<string, unknown> }).children.set('status-svc', fakeConn);

  const status = cm.getStatus('status-svc');
  assert.equal(status.connected, true, 'server shows as connected');
  assert.equal(status.toolCount, 0, 'toolCount is 0 when toolCache is null (line 360)');
  assert.equal(status.toolCacheAge, null, 'toolCacheAge is null when toolCache is null (line 361)');
});

// ── 4. HttpMcpServer constructor — default bindAddress ────────────────────────

test('HttpMcpServer: bindAddress defaults to 0.0.0.0 when not specified', async () => {
  const prevAllowUnauth = process.env.CH1TTY_ALLOW_UNAUTH;
  process.env.CH1TTY_ALLOW_UNAUTH = '1';
  const agg = new Aggregator([]);
  // Omit bindAddress — exercises the `options.bindAddress ?? '0.0.0.0'` branch at constructor line 35
  const srv = new HttpMcpServer(agg, { port: 0 });
  try {
    await srv.start();
    const port = srv.getPort();
    assert.ok(port > 0, `server should be listening on a real port, got ${port}`);
  } finally {
    await srv.stop().catch(() => {});
    await agg.shutdown();
    if (prevAllowUnauth === undefined) delete process.env.CH1TTY_ALLOW_UNAUTH;
    else process.env.CH1TTY_ALLOW_UNAUTH = prevAllowUnauth;
  }
});
