/**
 * Workstream BA: four small null/fallback branch gaps across four source files.
 *
 * 1. openapi-spec.ts:34 — `?? {}` when inputSchema has no `properties` key
 * 2. dlq-store.ts:80    — `?? 0` when exec returns [] (empty array)
 * 3. session-client.ts:59 — `?? 'https://session.chitty.cc'` default URL
 * 4. ledger-client.ts:39  — `?? 'https://ledger.chitty.cc'` default URL
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildOpenApiSpec } from '../src/openapi-spec.js';
import { SqliteDlqStore } from '../src/dlq-store.js';
import { SessionClient } from '../apps/session-coordinator-mcp/src/session-client.js';
import { LedgerClient } from '../apps/ledger-mcp/src/ledger-client.js';

// ── 1. openapi-spec.ts:34 ────────────────────────────────────────────────────
// The `?? {}` fires when `tool.inputSchema` has no `properties` key at all.
// requestBody is expected to be absent (Object.keys({}).length === 0).

test('openapi-spec.ts:34 — inputSchema without properties key → properties defaults to {} via ??', () => {
  const tool = {
    serverId: 'neon',
    namespacedName: 'neon/ping',
    description: 'Ping',
    inputSchema: { type: 'object' } as Record<string, unknown>,
  };
  const spec = buildOpenApiSpec([tool]);
  const post = (spec.paths['/tools/neon/ping'] as Record<string, unknown>)['post'] as Record<string, unknown>;
  assert.equal(post['requestBody'], undefined);
});

// ── 2. dlq-store.ts:80 ───────────────────────────────────────────────────────
// The `?? 0` fires when exec returns an empty array (no rows from COUNT(*)).

function makeEmptyCountSql() {
  return {
    exec<T>(_sql: string, ..._args: unknown[]): { toArray(): T[] } {
      return { toArray: () => [] as T[] };
    },
  };
}

test('dlq-store.ts:80 — count() returns 0 via ?? when exec yields empty array', () => {
  const sql = makeEmptyCountSql();
  const store = new SqliteDlqStore(sql as unknown as SqlStorage);
  assert.equal(store.count(), 0);
});

// ── 3. session-client.ts:59 ──────────────────────────────────────────────────
// The `?? 'https://session.chitty.cc'` fires when no arg and no env var.

test('session-client.ts:59 — defaults to https://session.chitty.cc when no arg and CHITTY_SESSION_URL unset', () => {
  const saved = process.env['CHITTY_SESSION_URL'];
  delete process.env['CHITTY_SESSION_URL'];
  try {
    const client = new SessionClient();
    assert.equal((client as unknown as { baseUrl: string }).baseUrl, 'https://session.chitty.cc');
  } finally {
    if (saved !== undefined) process.env['CHITTY_SESSION_URL'] = saved;
  }
});

// ── 4. ledger-client.ts:39 ───────────────────────────────────────────────────
// The `?? 'https://ledger.chitty.cc'` fires when no arg and no env var.

test('ledger-client.ts:39 — defaults to https://ledger.chitty.cc when no arg and CHITTY_LEDGER_URL unset', () => {
  const saved = process.env['CHITTY_LEDGER_URL'];
  delete process.env['CHITTY_LEDGER_URL'];
  try {
    const client = new LedgerClient();
    assert.equal((client as unknown as { baseUrl: string }).baseUrl, 'https://ledger.chitty.cc');
  } finally {
    if (saved !== undefined) process.env['CHITTY_LEDGER_URL'] = saved;
  }
});
