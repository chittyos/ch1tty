/**
 * HHH batch — coverage gaps in child-manager.ts and http-server.ts
 *
 * child-manager.ts gaps covered:
 *   1. isOpAvailable(): op binary absent → opAvailable=false, then cache hit path
 *   2. spawn() catch/finally: doSpawn throws → children map cleaned, connecting cleared
 *   3. evict() body: called from listTools catch block when a stale conn is in children
 *
 * http-server.ts gaps covered:
 *   4. checkAuth(): no Authorization header → returns false
 *   5. checkAuth(): wrong token → returns false
 *   6. checkAuth(): correct Bearer token → returns true
 *   7. checkAuth(): non-Bearer scheme → returns false
 *   8. unauthorized(): called on /api/v1/sessions with bad auth → 401 JSON body
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { ChildManager } from '../src/child-manager.js';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';
import type { LocalServerConfig } from '../src/types.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function localCfg(id: string): LocalServerConfig {
  return { id, name: id, type: 'local', access: 'readwrite', category: 'code', command: `/nonexistent/${id}`, args: [] };
}

// ── 1. isOpAvailable: op binary absent → false, then cache hit ───────────────

test('isOpAvailable: op not in PATH → returns false; cache hit on second call', async () => {
  const cm = new ChildManager();

  // Clobber PATH so 'op' cannot be found
  const origPath = process.env.PATH;
  process.env.PATH = '/nonexistent-bin-dir';
  try {
    // First call: execFileAsync('op', ['whoami']) fails → sets opAvailable=false
    const result1 = await (cm as unknown as { isOpAvailable(): Promise<boolean> }).isOpAvailable();
    assert.equal(result1, false, 'op unavailable → returns false');

    // Confirm the cache is populated
    const cached = (cm as unknown as { opAvailable: boolean | null }).opAvailable;
    assert.equal(cached, false, 'opAvailable cached after first call');

    // Second call: cache hit (no additional exec)
    const result2 = await (cm as unknown as { isOpAvailable(): Promise<boolean> }).isOpAvailable();
    assert.equal(result2, false, 'second call returns cached value');
  } finally {
    if (origPath === undefined) delete process.env.PATH;
    else process.env.PATH = origPath;
  }
});

// ── 2. spawn() catch/finally: doSpawn throws ─────────────────────────────────

test('spawn(): doSpawn failure propagates, connecting map cleared by finally block', async () => {
  const cm = new ChildManager();
  cm.registerServer(localCfg('fail-svc'));

  let spawnAttempts = 0;
  // Replace doSpawn with a function that throws immediately
  (cm as unknown as { doSpawn(c: LocalServerConfig): Promise<never> }).doSpawn = async () => {
    spawnAttempts++;
    throw new Error('doSpawn: intentional failure');
  };

  // listTools → spawnWithReconnect → spawn → doSpawn throws
  // spawn's catch: children.delete; spawn's finally: connecting.delete
  // listTools catch: breaker.recordFailure, evict (no-op—children already empty), re-throws
  await assert.rejects(
    () => cm.listTools('fail-svc'),
    (err: Error) => {
      assert.ok(err.message.includes('intentional failure'), `unexpected error: ${err.message}`);
      return true;
    },
  );

  assert.ok(spawnAttempts >= 1, `doSpawn must have been attempted, got ${spawnAttempts}`);

  // finally block in spawn must have cleared connecting
  const connecting = (cm as unknown as { connecting: Map<string, unknown> }).connecting;
  assert.equal(connecting.has('fail-svc'), false, 'connecting cleared by finally block');

  // catch block in spawn deletes from children; evict in listTools is a no-op on empty map
  const children = (cm as unknown as { children: Map<string, unknown> }).children;
  assert.equal(children.has('fail-svc'), false, 'children map empty after failed spawn');

  await cm.shutdown();
});

// ── 3. evict() body: pre-existing conn in children, listTools conn.client.listTools fails ──

test('evict(): called from listTools catch block when conn.client.listTools throws', async () => {
  const cm = new ChildManager();
  cm.registerServer(localCfg('stale-svc'));

  let closeCalled = false;
  const fakeConn = {
    client: {
      listTools: async () => { throw new Error('connection lost'); },
      close: async () => { closeCalled = true; },
    },
    transport: {},
    toolCache: null as null,
    resourceCache: null as null,
    promptCache: null as null,
  };

  // Pre-populate children with the stale connection
  // spawn() will find it and return it immediately (line 45: if (existing) return existing)
  (cm as unknown as { children: Map<string, unknown> }).children.set('stale-svc', fakeConn);

  // listTools: finds existing conn via spawnWithReconnect → spawn returns existing
  // conn.client.listTools() throws → catch block calls evict('stale-svc')
  // evict: gets conn from children, calls close(), deletes from map
  await assert.rejects(
    () => cm.listTools('stale-svc'),
    /connection lost/,
    'error from conn.client.listTools propagates',
  );

  // evict called close() on the stale connection
  assert.equal(closeCalled, true, 'evict() called conn.client.close()');

  // evict deleted the connection from children
  const children = (cm as unknown as { children: Map<string, unknown> }).children;
  assert.equal(children.has('stale-svc'), false, 'evict removed stale conn from children map');

  await cm.shutdown();
});

// ── 4–8. http-server.ts: checkAuth + unauthorized ────────────────────────────

let _counter = 0;
function makeDlq(): string {
  return join(tmpdir(), `ch1tty-hhh-${process.pid}-${++_counter}.dlq.jsonl`);
}

interface Ctx { agg: Aggregator; srv: HttpMcpServer; baseUrl: string; dlq: string }

async function startTokenServer(): Promise<Ctx> {
  const dlq = makeDlq();
  const agg = new Aggregator([], { ledgerDlqPath: dlq });
  const srv = new HttpMcpServer(agg, { port: 0, bindAddress: '127.0.0.1', mcpToken: 'tok-hhh' });
  await srv.start();
  return { agg, srv, baseUrl: `http://127.0.0.1:${srv.getPort()}`, dlq };
}

async function stopCtx(ctx: Ctx): Promise<void> {
  await ctx.srv.stop();
  await ctx.agg.shutdown();
  rmSync(ctx.dlq, { force: true });
}

test('checkAuth + unauthorized: /api/v1/sessions with no Authorization header → 401', async () => {
  const ctx = await startTokenServer();
  try {
    const res = await fetch(`${ctx.baseUrl}/api/v1/sessions`);
    assert.equal(res.status, 401, 'no auth header → 401 via unauthorized()');
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'unauthorized', 'body.error = "unauthorized"');
  } finally {
    await stopCtx(ctx);
  }
});

test('checkAuth: /api/v1/sessions with wrong Bearer token → 401', async () => {
  const ctx = await startTokenServer();
  try {
    const res = await fetch(`${ctx.baseUrl}/api/v1/sessions`, {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    assert.equal(res.status, 401, 'wrong token → 401');
  } finally {
    await stopCtx(ctx);
  }
});

test('checkAuth: /api/v1/sessions with correct Bearer token → 200 sessions list', async () => {
  const ctx = await startTokenServer();
  try {
    const res = await fetch(`${ctx.baseUrl}/api/v1/sessions`, {
      headers: { Authorization: 'Bearer tok-hhh' },
    });
    assert.equal(res.status, 200, 'correct token → 200');
    const body = await res.json() as { sessions: unknown[] };
    assert.ok(Array.isArray(body.sessions), 'sessions array present');
  } finally {
    await stopCtx(ctx);
  }
});

test('checkAuth: /api/v1/sessions with non-Bearer scheme → 401', async () => {
  const ctx = await startTokenServer();
  try {
    const res = await fetch(`${ctx.baseUrl}/api/v1/sessions`, {
      headers: { Authorization: 'Basic tok-hhh' },
    });
    assert.equal(res.status, 401, 'Basic scheme rejected → 401');
  } finally {
    await stopCtx(ctx);
  }
});
