/**
 * Workstream J: unit tests for src/dlq-store.ts (SqliteDlqStore).
 *
 * SqliteDlqStore is the Worker/DO-runtime replacement for the stdio
 * FileDlqStore. It persists failed ledger entries in DO SQLite so
 * count() never lies (unlike the stdio WAL path, which can land on
 * ephemeral storage inside a Worker).
 *
 * Tests use a node:sqlite DatabaseSync shim that satisfies the SqlStorage
 * interface without needing the Cloudflare DO runtime.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Suppress the experimental SQLite warning so it doesn't pollute TAP output.
process.removeAllListeners('warning');
import { DatabaseSync } from 'node:sqlite';

import { SqliteDlqStore } from '../src/dlq-store.js';
import type { LedgerEntry } from '../src/ledger.js';

// ── SqlStorage shim ───────────────────────────────────────────────────────────

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

// ── Minimal LedgerEntry factory ───────────────────────────────────────────────

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    event_type: 'tool_call',
    session_id: 'sess-1',
    metadata: { tool: 'srv/mytool' },
    timestamp: new Date().toISOString(),
    retries: 0,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Constructor
// ═══════════════════════════════════════════════════════════════════════════════

test('SqliteDlqStore: constructor creates ledger_dlq table', () => {
  const sql = makeSqlStorage();
  new SqliteDlqStore(sql as unknown as SqlStorage);
  const rows = sql.query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='ledger_dlq'`,
  );
  assert.equal(rows.length, 1, 'ledger_dlq table should exist');
});

test('SqliteDlqStore: constructor is idempotent (CREATE TABLE IF NOT EXISTS)', () => {
  const sql = makeSqlStorage();
  new SqliteDlqStore(sql as unknown as SqlStorage);
  assert.doesNotThrow(() => new SqliteDlqStore(sql as unknown as SqlStorage));
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. describe()
// ═══════════════════════════════════════════════════════════════════════════════

test('SqliteDlqStore: describe() returns "do-sqlite:ledger_dlq"', () => {
  const sql = makeSqlStorage();
  const store = new SqliteDlqStore(sql as unknown as SqlStorage);
  assert.equal(store.describe(), 'do-sqlite:ledger_dlq');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. append()
// ═══════════════════════════════════════════════════════════════════════════════

test('SqliteDlqStore: append([]) is a no-op', () => {
  const sql = makeSqlStorage();
  const store = new SqliteDlqStore(sql as unknown as SqlStorage);
  store.append([]);
  assert.equal(store.count(), 0);
});

test('SqliteDlqStore: append() stores a single entry', () => {
  const sql = makeSqlStorage();
  const store = new SqliteDlqStore(sql as unknown as SqlStorage);
  store.append([entry()]);
  assert.equal(store.count(), 1);
});

test('SqliteDlqStore: append() stores multiple entries in one call', () => {
  const sql = makeSqlStorage();
  const store = new SqliteDlqStore(sql as unknown as SqlStorage);
  store.append([entry({ session_id: 'a' }), entry({ session_id: 'b' }), entry({ session_id: 'c' })]);
  assert.equal(store.count(), 3);
});

test('SqliteDlqStore: multiple append() calls accumulate', () => {
  const sql = makeSqlStorage();
  const store = new SqliteDlqStore(sql as unknown as SqlStorage);
  for (let i = 0; i < 5; i++) {
    store.append([entry({ session_id: `sess-${i}` })]);
  }
  assert.equal(store.count(), 5);
});

test('SqliteDlqStore: appended entries include droppedAt field', () => {
  const sql = makeSqlStorage();
  const store = new SqliteDlqStore(sql as unknown as SqlStorage);
  store.append([entry()]);
  const rows = store.readEntries();
  assert.equal(rows.length, 1);
  const e = rows[0] as Record<string, unknown>;
  assert.ok(typeof e.droppedAt === 'string', 'droppedAt should be an ISO string');
  assert.ok(!isNaN(Date.parse(e.droppedAt as string)), 'droppedAt should be a valid date');
});

test('SqliteDlqStore: appended entry preserves original fields', () => {
  const sql = makeSqlStorage();
  const store = new SqliteDlqStore(sql as unknown as SqlStorage);
  const e = entry({ session_id: 'my-session', event_type: 'tool_error', retries: 3 });
  store.append([e]);
  const rows = store.readEntries();
  assert.equal(rows.length, 1);
  const r = rows[0] as Record<string, unknown>;
  assert.equal(r.session_id, 'my-session');
  assert.equal(r.event_type, 'tool_error');
  assert.equal(r.retries, 3);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. count()
// ═══════════════════════════════════════════════════════════════════════════════

test('SqliteDlqStore: count() returns 0 on empty store', () => {
  const sql = makeSqlStorage();
  const store = new SqliteDlqStore(sql as unknown as SqlStorage);
  assert.equal(store.count(), 0);
});

test('SqliteDlqStore: count() reflects appended entries', () => {
  const sql = makeSqlStorage();
  const store = new SqliteDlqStore(sql as unknown as SqlStorage);
  store.append([entry(), entry()]);
  assert.equal(store.count(), 2);
});

test('SqliteDlqStore: count() decrements after rewrite([]) clears', () => {
  const sql = makeSqlStorage();
  const store = new SqliteDlqStore(sql as unknown as SqlStorage);
  store.append([entry(), entry(), entry()]);
  assert.equal(store.count(), 3);
  store.rewrite([]);
  assert.equal(store.count(), 0);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. readEntries()
// ═══════════════════════════════════════════════════════════════════════════════

test('SqliteDlqStore: readEntries() returns empty array when store is empty', () => {
  const sql = makeSqlStorage();
  const store = new SqliteDlqStore(sql as unknown as SqlStorage);
  assert.deepEqual(store.readEntries(), []);
});

test('SqliteDlqStore: readEntries() returns entries in insertion order (ORDER BY id ASC)', () => {
  const sql = makeSqlStorage();
  const store = new SqliteDlqStore(sql as unknown as SqlStorage);
  store.append([entry({ session_id: 'first' })]);
  store.append([entry({ session_id: 'second' })]);
  store.append([entry({ session_id: 'third' })]);
  const rows = store.readEntries();
  assert.equal((rows[0] as Record<string, unknown>).session_id, 'first');
  assert.equal((rows[1] as Record<string, unknown>).session_id, 'second');
  assert.equal((rows[2] as Record<string, unknown>).session_id, 'third');
});

test('SqliteDlqStore: readEntries(limit) returns at most limit entries', () => {
  const sql = makeSqlStorage();
  const store = new SqliteDlqStore(sql as unknown as SqlStorage);
  for (let i = 0; i < 10; i++) store.append([entry({ session_id: `s${i}` })]);
  assert.equal(store.readEntries(3).length, 3);
  assert.equal(store.readEntries(10).length, 10);
  assert.equal(store.readEntries(50).length, 10, 'limit > count should return all');
});

test('SqliteDlqStore: readEntries() default limit is 50', () => {
  const sql = makeSqlStorage();
  const store = new SqliteDlqStore(sql as unknown as SqlStorage);
  for (let i = 0; i < 60; i++) store.append([entry({ session_id: `s${i}` })]);
  assert.equal(store.readEntries().length, 50);
});

test('SqliteDlqStore: readEntries() skips malformed JSON rows', () => {
  const sql = makeSqlStorage();
  const store = new SqliteDlqStore(sql as unknown as SqlStorage);
  store.append([entry({ session_id: 'good' })]);
  // Inject a malformed row directly
  sql.exec(
    `INSERT INTO ledger_dlq (dropped_at, payload) VALUES (?, ?)`,
    new Date().toISOString(), 'NOT VALID JSON!!!',
  );
  const rows = store.readEntries();
  assert.equal(rows.length, 1, 'malformed row should be silently skipped');
  assert.equal((rows[0] as Record<string, unknown>).session_id, 'good');
});

test('SqliteDlqStore: readEntries() skips array JSON rows (must be object)', () => {
  const sql = makeSqlStorage();
  const store = new SqliteDlqStore(sql as unknown as SqlStorage);
  sql.exec(
    `INSERT INTO ledger_dlq (dropped_at, payload) VALUES (?, ?)`,
    new Date().toISOString(), '[1,2,3]',
  );
  const rows = store.readEntries();
  assert.equal(rows.length, 0, 'array JSON should be skipped (not an object)');
});

test('SqliteDlqStore: readEntries() skips null JSON rows', () => {
  const sql = makeSqlStorage();
  const store = new SqliteDlqStore(sql as unknown as SqlStorage);
  sql.exec(
    `INSERT INTO ledger_dlq (dropped_at, payload) VALUES (?, ?)`,
    new Date().toISOString(), 'null',
  );
  const rows = store.readEntries();
  assert.equal(rows.length, 0, 'null JSON should be skipped');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. rewrite()
// ═══════════════════════════════════════════════════════════════════════════════

test('SqliteDlqStore: rewrite([]) clears all entries', () => {
  const sql = makeSqlStorage();
  const store = new SqliteDlqStore(sql as unknown as SqlStorage);
  store.append([entry(), entry()]);
  store.rewrite([]);
  assert.equal(store.count(), 0);
  assert.deepEqual(store.readEntries(), []);
});

test('SqliteDlqStore: rewrite() replaces contents with provided entries', () => {
  const sql = makeSqlStorage();
  const store = new SqliteDlqStore(sql as unknown as SqlStorage);
  store.append([entry({ session_id: 'old-1' }), entry({ session_id: 'old-2' })]);
  store.rewrite([{ session_id: 'new-1', event_type: 'retry', metadata: {}, timestamp: new Date().toISOString(), retries: 1 }]);
  const rows = store.readEntries();
  assert.equal(rows.length, 1);
  assert.equal((rows[0] as Record<string, unknown>).session_id, 'new-1');
});

test('SqliteDlqStore: rewrite() count matches new entries', () => {
  const sql = makeSqlStorage();
  const store = new SqliteDlqStore(sql as unknown as SqlStorage);
  store.append([entry(), entry(), entry()]);
  assert.equal(store.count(), 3);
  store.rewrite([{ x: 1 }, { x: 2 }]);
  assert.equal(store.count(), 2);
});

test('SqliteDlqStore: rewrite() is idempotent when called with same data twice', () => {
  const sql = makeSqlStorage();
  const store = new SqliteDlqStore(sql as unknown as SqlStorage);
  const data = [{ session_id: 'x', event_type: 'tool_call', metadata: {}, timestamp: '2026-01-01T00:00:00Z', retries: 0 }];
  store.rewrite(data);
  store.rewrite(data);
  assert.equal(store.count(), 1);
});

test('SqliteDlqStore: rewrite() assigns fresh droppedAt to re-written entries', () => {
  const sql = makeSqlStorage();
  const store = new SqliteDlqStore(sql as unknown as SqlStorage);
  const before = Date.now();
  store.rewrite([{ session_id: 'x', event_type: 'tool_call', metadata: {}, timestamp: '2026-01-01T00:00:00Z', retries: 0 }]);
  const rows = sql.query<{ dropped_at: string }>(`SELECT dropped_at FROM ledger_dlq`);
  assert.equal(rows.length, 1);
  const writtenAt = Date.parse(rows[0].dropped_at);
  assert.ok(writtenAt >= before, 'dropped_at should be >= before rewrite');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Error-path coverage — catch blocks in append/readEntries/rewrite/count
// ═══════════════════════════════════════════════════════════════════════════════

// A SqlStorage shim that succeeds on the constructor's CREATE TABLE call, then
// throws on every subsequent exec() — exercising the catch blocks in each method.
function makeFailAfterInitSql(): SqlStorage {
  let calls = 0;
  return {
    exec(..._args: unknown[]) {
      calls++;
      if (calls === 1) return { toArray: () => [] } as ReturnType<SqlStorage['exec']>;
      throw new Error('simulated SQLite I/O error');
    },
  } as unknown as SqlStorage;
}

test('SqliteDlqStore: append() SQL error is caught — must not throw', () => {
  const store = new SqliteDlqStore(makeFailAfterInitSql());
  assert.doesNotThrow(() => store.append([entry({ session_id: 'err-test' })]));
});

test('SqliteDlqStore: readEntries() SQL error is caught — returns empty array', () => {
  const store = new SqliteDlqStore(makeFailAfterInitSql());
  const result = store.readEntries();
  assert.deepEqual(result, []);
});

test('SqliteDlqStore: rewrite() SQL error is caught — must not throw', () => {
  const store = new SqliteDlqStore(makeFailAfterInitSql());
  assert.doesNotThrow(() => store.rewrite([{ session_id: 'x' }]));
});

test('SqliteDlqStore: count() SQL error is caught — returns 0', () => {
  const store = new SqliteDlqStore(makeFailAfterInitSql());
  assert.equal(store.count(), 0);
});
