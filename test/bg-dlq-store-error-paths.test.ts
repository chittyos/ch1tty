/**
 * Workstream BG: error-path coverage for src/dlq-store.ts (SqliteDlqStore).
 *
 * The existing Workstream J tests (jjjjj-sqlite-dlq-store.test.ts) cover all
 * happy paths.  The four catch blocks — append(), readEntries(), rewrite(),
 * count() — remain uncovered (lines 37-40, 57-59, 74-75, 82-83).
 *
 * These tests inject a throwing SqlStorage shim to exercise each catch branch,
 * confirming the method swallows the error rather than propagating it (as
 * required by the DlqStore contract).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SqliteDlqStore } from '../src/dlq-store.js';
import type { LedgerEntry } from '../src/ledger.js';

// ── Minimal throwing SqlStorage shim ─────────────────────────────────────────

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    event_type: 'tool_call',
    session_id: 'sess-err',
    metadata: { tool: 'srv/tool' },
    timestamp: new Date().toISOString(),
    retries: 0,
    ...overrides,
  };
}

type SqlCursor<T> = { toArray(): T[] };
type SqlValue = string | number | null | boolean | bigint | ArrayBuffer;

function makeConstructorOnlySql(): SqlStorage {
  let callCount = 0;
  return {
    exec<T>(sql: string, ..._v: SqlValue[]): SqlCursor<T> {
      const lower = sql.trim().toLowerCase();
      if (lower.startsWith('create table')) {
        callCount++;
        return { toArray: () => [] as T[] };
      }
      throw new Error('sql error');
    },
  } as unknown as SqlStorage;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('BG-1: SqliteDlqStore.append() catches sql.exec throw — must not propagate', () => {
  const store = new SqliteDlqStore(makeConstructorOnlySql());
  // append() must not throw even when the underlying sql.exec fails
  assert.doesNotThrow(() => store.append([entry(), entry()]));
});

test('BG-2: SqliteDlqStore.readEntries() catches sql.exec throw — returns empty array', () => {
  const store = new SqliteDlqStore(makeConstructorOnlySql());
  let result: object[];
  assert.doesNotThrow(() => {
    result = store.readEntries();
  });
  assert.deepEqual(result!, [], 'readEntries() error path must return []');
});

test('BG-3: SqliteDlqStore.rewrite() catches sql.exec throw — must not propagate', () => {
  const store = new SqliteDlqStore(makeConstructorOnlySql());
  assert.doesNotThrow(() => store.rewrite([{ session_id: 'x' }]));
});

test('BG-4: SqliteDlqStore.count() catches sql.exec throw — returns 0', () => {
  const store = new SqliteDlqStore(makeConstructorOnlySql());
  let result: number;
  assert.doesNotThrow(() => {
    result = store.count();
  });
  assert.equal(result!, 0, 'count() error path must return 0');
});
