/**
 * Workstream J: unit tests for src/token-source.ts (WorkerTokenSource).
 *
 * WorkerTokenSource is the Worker-runtime replacement for the stdio gateway's
 * execFile('chitty-mcp-token', [key]) path. Resolution order:
 *   1. env.CHITTY_MCP_TOKEN_<KEY>  — Cloudflare secret binding
 *   2. DO SQLite cache             — brokered token within TTL
 *   3. ChittyConnect broker        — GET /v1/credentials/services/<key>/service_token
 *
 * The tests use:
 *   • makeSqlStorage() — a node:sqlite DatabaseSync shim that satisfies the
 *     SqlStorage interface without needing the Cloudflare DO runtime.
 *   • fetch stubbing — replace globalThis.fetch for broker path assertions,
 *     restore in finally blocks so tests remain isolated.
 *   • Env mock — a plain Record<string,unknown> cast to Env.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Suppress the experimental SQLite warning so it doesn't pollute TAP output.
process.removeAllListeners('warning');
import { DatabaseSync } from 'node:sqlite';

import { WorkerTokenSource } from '../src/token-source.js';
import type { Env } from '../src/types.js';

// ── SqlStorage shim ───────────────────────────────────────────────────────────
// Mirrors the interface used by the Cloudflare DO runtime so tests run in Node.

type SqlCursor<T> = { toArray(): T[] };
type SqlValue = string | number | null | boolean | bigint | ArrayBuffer;

type Shim = {
  exec<T>(sql: string, ...v: SqlValue[]): SqlCursor<T>;
  query<T>(sql: string, ...v: SqlValue[]): T[];
};

function makeSqlStorage(): Shim {
  const db = new DatabaseSync(':memory:');
  return {
    exec<T>(sql: string, ...values: SqlValue[]): SqlCursor<T> {
      const trimmed = sql.trim();
      const lower = trimmed.toLowerCase();
      const isSelect = lower.startsWith('select') || lower.startsWith('pragma');
      if (isSelect) {
        const stmt = db.prepare(trimmed);
        const rows = values.length > 0 ? stmt.all(...values) : stmt.all();
        return { toArray: () => rows as T[] };
      }
      if (values.length === 0) {
        db.exec(trimmed);
        return { toArray: () => [] as T[] };
      }
      db.prepare(trimmed).run(...values);
      return { toArray: () => [] as T[] };
    },
    query<T>(sql: string, ...values: SqlValue[]): T[] {
      const stmt = db.prepare(sql);
      return (values.length > 0 ? stmt.all(...values) : stmt.all()) as T[];
    },
  };
}

// ── Fetch stub helpers ────────────────────────────────────────────────────────

type FetchFn = typeof globalThis.fetch;

function stubFetch(fn: (url: string | URL | Request, init?: RequestInit) => Promise<Response>): FetchFn {
  return fn as unknown as FetchFn;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Helper: make a minimal env with CHITTYCONNECT_SERVICE_TOKEN set ───────────

function serviceEnv(extra: Record<string, unknown> = {}): Env {
  return { CHITTYCONNECT_SERVICE_TOKEN: 'svc-token', ...extra } as unknown as Env;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Constructor
// ═══════════════════════════════════════════════════════════════════════════════

test('WorkerTokenSource: constructor creates token_cache table', () => {
  const sql = makeSqlStorage();
  new WorkerTokenSource({} as Env, sql as unknown as SqlStorage);
  const rows = sql.query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='token_cache'`,
  );
  assert.equal(rows.length, 1, 'token_cache table should be created');
});

test('WorkerTokenSource: constructor is idempotent (CREATE TABLE IF NOT EXISTS)', () => {
  const sql = makeSqlStorage();
  new WorkerTokenSource({} as Env, sql as unknown as SqlStorage);
  // Second construction on same db should not throw
  assert.doesNotThrow(() => new WorkerTokenSource({} as Env, sql as unknown as SqlStorage));
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Path 1 — bound secret (env var)
// ═══════════════════════════════════════════════════════════════════════════════

test('WorkerTokenSource: returns bound env secret directly (path 1)', async () => {
  const sql = makeSqlStorage();
  const env = { CHITTY_MCP_TOKEN_MYKEY: 'env-secret' } as unknown as Env;
  const ts = new WorkerTokenSource(env, sql as unknown as SqlStorage);
  assert.equal(await ts.getToken('mykey'), 'env-secret');
});

test('WorkerTokenSource: envVarNameFor uppercases key', async () => {
  const sql = makeSqlStorage();
  const env = { CHITTY_MCP_TOKEN_UPPER: 'upper-secret' } as unknown as Env;
  const ts = new WorkerTokenSource(env, sql as unknown as SqlStorage);
  assert.equal(await ts.getToken('upper'), 'upper-secret');
});

test('WorkerTokenSource: envVarNameFor replaces hyphens with underscores', async () => {
  const sql = makeSqlStorage();
  const env = { CHITTY_MCP_TOKEN_MY_KEY: 'hyphen-secret' } as unknown as Env;
  const ts = new WorkerTokenSource(env, sql as unknown as SqlStorage);
  assert.equal(await ts.getToken('my-key'), 'hyphen-secret');
});

test('WorkerTokenSource: envVarNameFor replaces dots with underscores', async () => {
  const sql = makeSqlStorage();
  const env = { CHITTY_MCP_TOKEN_SVC_API: 'dotted-secret' } as unknown as Env;
  const ts = new WorkerTokenSource(env, sql as unknown as SqlStorage);
  assert.equal(await ts.getToken('svc.api'), 'dotted-secret');
});

test('WorkerTokenSource: empty bound secret falls through (not returned)', async () => {
  const sql = makeSqlStorage();
  // Empty string → should NOT return it, should fall through to broker path
  const env = { CHITTY_MCP_TOKEN_MYKEY: '' } as unknown as Env;
  const ts = new WorkerTokenSource(env, sql as unknown as SqlStorage);
  // No service token → fails at broker gate with POLICY_BLOCKED
  await assert.rejects(() => ts.getToken('mykey'), /POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE/);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Path 2 — SQLite cache
// ═══════════════════════════════════════════════════════════════════════════════

test('WorkerTokenSource: returns unexpired cached token from SQLite (path 2)', async () => {
  const sql = makeSqlStorage();
  const ts = new WorkerTokenSource({} as Env, sql as unknown as SqlStorage);
  const futureExpiry = Date.now() + 60_000;
  sql.exec(
    `INSERT INTO token_cache (key, token, expires_at) VALUES (?, ?, ?)`,
    'cached-key', 'cached-token', futureExpiry,
  );
  assert.equal(await ts.getToken('cached-key'), 'cached-token');
});

test('WorkerTokenSource: expired cache entry falls through to broker', async () => {
  const sql = makeSqlStorage();
  const ts = new WorkerTokenSource({} as Env, sql as unknown as SqlStorage);
  const pastExpiry = Date.now() - 1;
  sql.exec(
    `INSERT INTO token_cache (key, token, expires_at) VALUES (?, ?, ?)`,
    'stale-key', 'old-token', pastExpiry,
  );
  // No service token → fails at broker gate
  await assert.rejects(() => ts.getToken('stale-key'), /POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE/);
});

test('WorkerTokenSource: cache does not serve a different key', async () => {
  const sql = makeSqlStorage();
  const ts = new WorkerTokenSource({} as Env, sql as unknown as SqlStorage);
  sql.exec(
    `INSERT INTO token_cache (key, token, expires_at) VALUES (?, ?, ?)`,
    'key-a', 'token-a', Date.now() + 60_000,
  );
  // 'key-b' has no cache entry, falls to broker (POLICY_BLOCKED without service token)
  await assert.rejects(() => ts.getToken('key-b'), /POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE/);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Path 3 — broker fail-closed paths
// ═══════════════════════════════════════════════════════════════════════════════

test('WorkerTokenSource: no CHITTYCONNECT_SERVICE_TOKEN → POLICY_BLOCKED', async () => {
  const sql = makeSqlStorage();
  const ts = new WorkerTokenSource({} as Env, sql as unknown as SqlStorage);
  await assert.rejects(
    () => ts.getToken('mykey'),
    /POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE.*service token unbound/,
  );
});

test('WorkerTokenSource: empty CHITTYCONNECT_SERVICE_TOKEN → POLICY_BLOCKED', async () => {
  const sql = makeSqlStorage();
  const env = { CHITTYCONNECT_SERVICE_TOKEN: '' } as unknown as Env;
  const ts = new WorkerTokenSource(env, sql as unknown as SqlStorage);
  await assert.rejects(
    () => ts.getToken('mykey'),
    /POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE.*service token unbound/,
  );
});

test('WorkerTokenSource: broker fetch throws → POLICY_BLOCKED', async () => {
  const sql = makeSqlStorage();
  const ts = new WorkerTokenSource(serviceEnv(), sql as unknown as SqlStorage);
  const orig = globalThis.fetch;
  globalThis.fetch = stubFetch(async () => { throw new Error('network error'); });
  try {
    await assert.rejects(
      () => ts.getToken('mykey'),
      /POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE.*broker fetch failed/,
    );
  } finally {
    globalThis.fetch = orig;
  }
});

test('WorkerTokenSource: broker HTTP 401 → POLICY_BLOCKED with status', async () => {
  const sql = makeSqlStorage();
  const ts = new WorkerTokenSource(serviceEnv(), sql as unknown as SqlStorage);
  const orig = globalThis.fetch;
  globalThis.fetch = stubFetch(async () => new Response(null, { status: 401 }));
  try {
    await assert.rejects(
      () => ts.getToken('mykey'),
      /POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE.*401/,
    );
  } finally {
    globalThis.fetch = orig;
  }
});

test('WorkerTokenSource: broker HTTP 500 → POLICY_BLOCKED with status', async () => {
  const sql = makeSqlStorage();
  const ts = new WorkerTokenSource(serviceEnv(), sql as unknown as SqlStorage);
  const orig = globalThis.fetch;
  globalThis.fetch = stubFetch(async () => new Response(null, { status: 500 }));
  try {
    await assert.rejects(
      () => ts.getToken('mykey'),
      /POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE.*500/,
    );
  } finally {
    globalThis.fetch = orig;
  }
});

test('WorkerTokenSource: broker non-JSON body → POLICY_BLOCKED', async () => {
  const sql = makeSqlStorage();
  const ts = new WorkerTokenSource(serviceEnv(), sql as unknown as SqlStorage);
  const orig = globalThis.fetch;
  globalThis.fetch = stubFetch(async () => new Response('not-json!!!', { status: 200 }));
  try {
    await assert.rejects(
      () => ts.getToken('mykey'),
      /POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE.*non-JSON/,
    );
  } finally {
    globalThis.fetch = orig;
  }
});

test('WorkerTokenSource: broker JSON without value or credential → POLICY_BLOCKED', async () => {
  const sql = makeSqlStorage();
  const ts = new WorkerTokenSource(serviceEnv(), sql as unknown as SqlStorage);
  const orig = globalThis.fetch;
  globalThis.fetch = stubFetch(async () => jsonResponse({ success: true }));
  try {
    await assert.rejects(
      () => ts.getToken('mykey'),
      /POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE.*no value/,
    );
  } finally {
    globalThis.fetch = orig;
  }
});

test('WorkerTokenSource: broker returns empty string value → POLICY_BLOCKED', async () => {
  const sql = makeSqlStorage();
  const ts = new WorkerTokenSource(serviceEnv(), sql as unknown as SqlStorage);
  const orig = globalThis.fetch;
  globalThis.fetch = stubFetch(async () => jsonResponse({ value: '' }));
  try {
    await assert.rejects(
      () => ts.getToken('mykey'),
      /POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE.*no value/,
    );
  } finally {
    globalThis.fetch = orig;
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Path 3 — broker success paths
// ═══════════════════════════════════════════════════════════════════════════════

test('WorkerTokenSource: broker success via value field → returns token', async () => {
  const sql = makeSqlStorage();
  const ts = new WorkerTokenSource(serviceEnv(), sql as unknown as SqlStorage);
  const orig = globalThis.fetch;
  globalThis.fetch = stubFetch(async () => jsonResponse({ value: 'brokered-token' }));
  try {
    assert.equal(await ts.getToken('mykey'), 'brokered-token');
  } finally {
    globalThis.fetch = orig;
  }
});

test('WorkerTokenSource: broker success via credential alias → returns token', async () => {
  const sql = makeSqlStorage();
  const ts = new WorkerTokenSource(serviceEnv(), sql as unknown as SqlStorage);
  const orig = globalThis.fetch;
  globalThis.fetch = stubFetch(async () => jsonResponse({ credential: 'alias-token' }));
  try {
    assert.equal(await ts.getToken('mykey'), 'alias-token');
  } finally {
    globalThis.fetch = orig;
  }
});

test('WorkerTokenSource: value field takes precedence over credential alias', async () => {
  const sql = makeSqlStorage();
  const ts = new WorkerTokenSource(serviceEnv(), sql as unknown as SqlStorage);
  const orig = globalThis.fetch;
  globalThis.fetch = stubFetch(async () => jsonResponse({ value: 'primary', credential: 'fallback' }));
  try {
    assert.equal(await ts.getToken('mykey'), 'primary');
  } finally {
    globalThis.fetch = orig;
  }
});

test('WorkerTokenSource: broker token is cached in SQLite after fetch', async () => {
  const sql = makeSqlStorage();
  const ts = new WorkerTokenSource(serviceEnv(), sql as unknown as SqlStorage);
  const orig = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = stubFetch(async () => {
    fetchCount++;
    return jsonResponse({ value: 'brokered' });
  });
  try {
    await ts.getToken('mykey');
    assert.equal(fetchCount, 1);
    // Second call should hit the SQLite cache, not the broker
    await ts.getToken('mykey');
    assert.equal(fetchCount, 1, 'second call must use SQLite cache, not broker');
  } finally {
    globalThis.fetch = orig;
  }
});

test('WorkerTokenSource: cache upsert updates token on conflict', async () => {
  const sql = makeSqlStorage();
  const ts = new WorkerTokenSource(serviceEnv(), sql as unknown as SqlStorage);
  // Pre-populate with an expired entry to trigger upsert path
  sql.exec(
    `INSERT INTO token_cache (key, token, expires_at) VALUES (?, ?, ?)`,
    'mykey', 'old-token', Date.now() - 1,
  );
  const orig = globalThis.fetch;
  globalThis.fetch = stubFetch(async () => jsonResponse({ value: 'fresh-token' }));
  try {
    const tok = await ts.getToken('mykey');
    assert.equal(tok, 'fresh-token');
    // Verify cache row updated
    const rows = sql.query<{ token: string }>(`SELECT token FROM token_cache WHERE key = ?`, 'mykey');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].token, 'fresh-token');
  } finally {
    globalThis.fetch = orig;
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Broker URL resolution
// ═══════════════════════════════════════════════════════════════════════════════

test('WorkerTokenSource: uses default broker URL when CHITTYCONNECT_URL unset', async () => {
  const sql = makeSqlStorage();
  const ts = new WorkerTokenSource(serviceEnv(), sql as unknown as SqlStorage);
  const orig = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = stubFetch(async (url) => {
    capturedUrl = typeof url === 'string' ? url : String(url);
    return jsonResponse({ value: 'tok' });
  });
  try {
    await ts.getToken('myservice');
    assert.ok(
      capturedUrl.startsWith('https://connect.chitty.cc/v1/credentials/services/'),
      `Expected default broker URL, got: ${capturedUrl}`,
    );
  } finally {
    globalThis.fetch = orig;
  }
});

test('WorkerTokenSource: uses CHITTYCONNECT_URL if set, stripping trailing slash', async () => {
  const sql = makeSqlStorage();
  const env = serviceEnv({ CHITTYCONNECT_URL: 'https://custom.example.com/' });
  const ts = new WorkerTokenSource(env, sql as unknown as SqlStorage);
  const orig = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = stubFetch(async (url) => {
    capturedUrl = typeof url === 'string' ? url : String(url);
    return jsonResponse({ value: 'tok' });
  });
  try {
    await ts.getToken('myservice');
    assert.ok(
      capturedUrl.startsWith('https://custom.example.com/v1/credentials/services/'),
      `Expected custom URL, got: ${capturedUrl}`,
    );
    assert.ok(!capturedUrl.includes('//v1'), 'trailing slash must be stripped before appending path');
  } finally {
    globalThis.fetch = orig;
  }
});

test('WorkerTokenSource: key is URL-encoded in broker path', async () => {
  const sql = makeSqlStorage();
  const ts = new WorkerTokenSource(serviceEnv(), sql as unknown as SqlStorage);
  const orig = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = stubFetch(async (url) => {
    capturedUrl = typeof url === 'string' ? url : String(url);
    return jsonResponse({ value: 'tok' });
  });
  try {
    await ts.getToken('my service/key');
    assert.ok(capturedUrl.includes('my%20service%2Fkey'), `URL should encode key, got: ${capturedUrl}`);
  } finally {
    globalThis.fetch = orig;
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Request headers sent to broker
// ═══════════════════════════════════════════════════════════════════════════════

test('WorkerTokenSource: sends Authorization Bearer header to broker', async () => {
  const sql = makeSqlStorage();
  const ts = new WorkerTokenSource(serviceEnv({ CHITTYCONNECT_SERVICE_TOKEN: 'my-svc-token' }), sql as unknown as SqlStorage);
  const orig = globalThis.fetch;
  let capturedHeaders: Record<string, string> = {};
  globalThis.fetch = stubFetch(async (_url, init) => {
    const hdrs = (init?.headers ?? {}) as Record<string, string>;
    capturedHeaders = hdrs;
    return jsonResponse({ value: 'tok' });
  });
  try {
    await ts.getToken('mykey');
    assert.equal(capturedHeaders['Authorization'], 'Bearer my-svc-token');
  } finally {
    globalThis.fetch = orig;
  }
});

test('WorkerTokenSource: sends X-Source-Service: ch1tty header', async () => {
  const sql = makeSqlStorage();
  const ts = new WorkerTokenSource(serviceEnv(), sql as unknown as SqlStorage);
  const orig = globalThis.fetch;
  let capturedHeaders: Record<string, string> = {};
  globalThis.fetch = stubFetch(async (_url, init) => {
    capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
    return jsonResponse({ value: 'tok' });
  });
  try {
    await ts.getToken('mykey');
    assert.equal(capturedHeaders['X-Source-Service'], 'ch1tty');
  } finally {
    globalThis.fetch = orig;
  }
});

test('WorkerTokenSource: sends X-Request-ID header (UUID format)', async () => {
  const sql = makeSqlStorage();
  const ts = new WorkerTokenSource(serviceEnv(), sql as unknown as SqlStorage);
  const orig = globalThis.fetch;
  let capturedHeaders: Record<string, string> = {};
  globalThis.fetch = stubFetch(async (_url, init) => {
    capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
    return jsonResponse({ value: 'tok' });
  });
  try {
    await ts.getToken('mykey');
    const reqId = capturedHeaders['X-Request-ID'];
    assert.ok(typeof reqId === 'string' && reqId.length > 0, 'X-Request-ID should be a non-empty string');
    // UUID v4 pattern
    assert.match(reqId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  } finally {
    globalThis.fetch = orig;
  }
});
