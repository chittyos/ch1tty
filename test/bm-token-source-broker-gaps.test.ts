/**
 * Workstream BM: branch-coverage gaps in src/token-source.ts not reached by
 * jjjjj-worker-token-source.test.ts.
 *
 * Targets:
 *   • empty CHITTYCONNECT_URL → default broker fallback
 *   • CHITTYCONNECT_URL without trailing slash (replace no-op)
 *   • non-string CHITTYCONNECT_SERVICE_TOKEN → POLICY_BLOCKED
 *   • non-string bound env var → falls through to broker
 *   • broker JSON value is non-string (number) → POLICY_BLOCKED
 *   • value: null with credential fallback → credential returned
 *   • X-Canonical-URI and Content-Type headers sent to broker
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.removeAllListeners('warning');
import { DatabaseSync } from 'node:sqlite';

import { WorkerTokenSource } from '../src/token-source.js';
import type { Env } from '../src/types.js';

// ── SqlStorage shim ───────────────────────────────────────────────────────────

type SqlCursor<T> = { toArray(): T[] };
type SqlValue = string | number | null | boolean | bigint | ArrayBuffer;

function makeSqlStorage() {
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

function serviceEnv(extra: Record<string, unknown> = {}): Env {
  return { CHITTYCONNECT_SERVICE_TOKEN: 'svc-token', ...extra } as unknown as Env;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. CHITTYCONNECT_URL empty string → default broker URL
//    Exercises the `typeof x === 'string' && x` branch where x is truthy-false
// ═══════════════════════════════════════════════════════════════════════════════

test('WorkerTokenSource(BM): empty CHITTYCONNECT_URL string falls back to default broker URL', async () => {
  const sql = makeSqlStorage();
  const env = serviceEnv({ CHITTYCONNECT_URL: '' });
  const ts = new WorkerTokenSource(env, sql as unknown as SqlStorage);
  const orig = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = stubFetch(async (url) => {
    capturedUrl = typeof url === 'string' ? url : String(url);
    return jsonResponse({ value: 'tok' });
  });
  try {
    await ts.getToken('mykey');
    assert.ok(
      capturedUrl.startsWith('https://connect.chitty.cc/v1/credentials/services/'),
      `Expected default broker URL, got: ${capturedUrl}`,
    );
  } finally {
    globalThis.fetch = orig;
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. CHITTYCONNECT_URL without trailing slash → replace() no-op, no double-slash
// ═══════════════════════════════════════════════════════════════════════════════

test('WorkerTokenSource(BM): CHITTYCONNECT_URL without trailing slash — no double-slash in path', async () => {
  const sql = makeSqlStorage();
  const env = serviceEnv({ CHITTYCONNECT_URL: 'https://custom.example.com' });
  const ts = new WorkerTokenSource(env, sql as unknown as SqlStorage);
  const orig = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = stubFetch(async (url) => {
    capturedUrl = typeof url === 'string' ? url : String(url);
    return jsonResponse({ value: 'tok' });
  });
  try {
    await ts.getToken('mykey');
    assert.ok(
      capturedUrl.startsWith('https://custom.example.com/v1/credentials/services/'),
      `Expected clean path, got: ${capturedUrl}`,
    );
    assert.ok(!capturedUrl.includes('//v1'), `Should not contain double-slash before /v1, got: ${capturedUrl}`);
  } finally {
    globalThis.fetch = orig;
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. CHITTYCONNECT_SERVICE_TOKEN is a non-string → POLICY_BLOCKED
//    Exercises `typeof serviceToken !== 'string'` true branch
// ═══════════════════════════════════════════════════════════════════════════════

test('WorkerTokenSource(BM): non-string CHITTYCONNECT_SERVICE_TOKEN → POLICY_BLOCKED', async () => {
  const sql = makeSqlStorage();
  // Number value — typeof !== 'string' → fail closed
  const env = { CHITTYCONNECT_SERVICE_TOKEN: 42 } as unknown as Env;
  const ts = new WorkerTokenSource(env, sql as unknown as SqlStorage);
  await assert.rejects(
    () => ts.getToken('mykey'),
    /POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE.*service token unbound/,
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Bound env var is non-string → typeof check fails → falls through to broker
//    Exercises `typeof bound === 'string'` false branch in getToken()
// ═══════════════════════════════════════════════════════════════════════════════

test('WorkerTokenSource(BM): non-string bound env var falls through to broker path', async () => {
  const sql = makeSqlStorage();
  // Set the bound-secret key to a number (not a string) — should NOT be returned
  const env = {
    CHITTY_MCP_TOKEN_MYKEY: 9999,
    CHITTYCONNECT_SERVICE_TOKEN: 'svc-token',
  } as unknown as Env;
  const ts = new WorkerTokenSource(env, sql as unknown as SqlStorage);
  const orig = globalThis.fetch;
  globalThis.fetch = stubFetch(async () => jsonResponse({ value: 'brokered' }));
  try {
    // Must reach broker and return the brokered value, not the numeric env value
    assert.equal(await ts.getToken('mykey'), 'brokered');
  } finally {
    globalThis.fetch = orig;
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Broker JSON value field is non-string (e.g. number) → POLICY_BLOCKED
//    Exercises `typeof value !== 'string'` with a truthy non-string
// ═══════════════════════════════════════════════════════════════════════════════

test('WorkerTokenSource(BM): broker JSON with numeric value field → POLICY_BLOCKED', async () => {
  const sql = makeSqlStorage();
  const ts = new WorkerTokenSource(serviceEnv(), sql as unknown as SqlStorage);
  const orig = globalThis.fetch;
  globalThis.fetch = stubFetch(async () => jsonResponse({ value: 12345 }));
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
// 6. value: null falls through to credential field via ?? operator
// ═══════════════════════════════════════════════════════════════════════════════

test('WorkerTokenSource(BM): value=null in broker JSON falls through to credential field', async () => {
  const sql = makeSqlStorage();
  const ts = new WorkerTokenSource(serviceEnv(), sql as unknown as SqlStorage);
  const orig = globalThis.fetch;
  globalThis.fetch = stubFetch(async () => jsonResponse({ value: null, credential: 'cred-token' }));
  try {
    assert.equal(await ts.getToken('mykey'), 'cred-token');
  } finally {
    globalThis.fetch = orig;
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. X-Canonical-URI header is sent to the broker
// ═══════════════════════════════════════════════════════════════════════════════

test('WorkerTokenSource(BM): sends X-Canonical-URI header to broker', async () => {
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
    assert.equal(capturedHeaders['X-Canonical-URI'], 'chittycanon://core/services/ch1tty');
  } finally {
    globalThis.fetch = orig;
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Content-Type: application/json header is sent to the broker
// ═══════════════════════════════════════════════════════════════════════════════

test('WorkerTokenSource(BM): sends Content-Type: application/json header to broker', async () => {
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
    assert.equal(capturedHeaders['Content-Type'], 'application/json');
  } finally {
    globalThis.fetch = orig;
  }
});
