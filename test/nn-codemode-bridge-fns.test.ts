/**
 * Workstream N: codemode-fns.ts unit tests.
 *
 * src/codemode-fns.ts extracts the pure fn-table builder (buildFnTable) and
 * result marshaler (marshalResult) from CodemodeBridge.run() so they can be
 * tested in Node.js without the @cloudflare/codemode runtime dependency.
 *
 * Coverage (14 tests):
 *  1.  buildFnTable: empty server list → exactly {ch1tty.search, ch1tty.execute}
 *  2.  buildFnTable: multi-server → per-server .execute + .search keys added
 *  3.  buildFnTable serverId.execute: non-object args coerced to {}
 *  4.  buildFnTable serverId.execute: array args coerced to {}
 *  5.  buildFnTable serverId.execute: valid object args forwarded as-is
 *  6.  buildFnTable serverId.execute: routes to host.runTool(serverId/toolName, args, sessionId)
 *  7.  buildFnTable serverId.search: null query coerced to ""
 *  8.  buildFnTable serverId.search: string query + server filter forwarded
 *  9.  buildFnTable ch1tty.execute: routes namespaced tool, no serverId prefix
 * 10.  buildFnTable ch1tty.search: calls searchTools with no server filter
 * 11.  buildFnTable: sessionId undefined → runTool receives undefined sessionId
 * 12.  marshalResult: success path — result propagated, error/logs undefined
 * 13.  marshalResult: error field propagated
 * 14.  marshalResult: logs field propagated
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFnTable, marshalResult } from '../src/codemode-fns.js';
import type { CodemodeHost } from '../src/codemode-bridge.js';

// ── Host helper ───────────────────────────────────────────────────────────────

type HostWithLog = CodemodeHost & {
  runToolCalls: Array<{ tool: string; args: Record<string, unknown>; sessionId?: string }>;
  searchToolCalls: Array<{ query: string; server?: string }>;
};

function makeHost(serverIds: string[] = []): HostWithLog {
  const runToolCalls: Array<{ tool: string; args: Record<string, unknown>; sessionId?: string }> = [];
  const searchToolCalls: Array<{ query: string; server?: string }> = [];
  return {
    remoteServerIds: () => serverIds,
    async runTool(tool, args, sessionId) {
      runToolCalls.push({ tool, args, sessionId });
      return { ok: true };
    },
    async searchTools(query, server) {
      searchToolCalls.push({ query, server });
      return [];
    },
    runToolCalls,
    searchToolCalls,
  };
}

// ── 1. Empty server list ──────────────────────────────────────────────────────

test('buildFnTable: empty server list → exactly ch1tty.search + ch1tty.execute', () => {
  const host = makeHost([]);
  const fns = buildFnTable(host);
  assert.deepEqual(Object.keys(fns).sort(), ['ch1tty.execute', 'ch1tty.search']);
});

// ── 2. Multi-server list ──────────────────────────────────────────────────────

test('buildFnTable: multi-server adds per-server .execute + .search', () => {
  const host = makeHost(['neon', 'stripe']);
  const fns = buildFnTable(host);
  assert.deepEqual(Object.keys(fns).sort(), [
    'ch1tty.execute',
    'ch1tty.search',
    'neon.execute',
    'neon.search',
    'stripe.execute',
    'stripe.search',
  ]);
});

// ── 3. serverId.execute: non-object args coerced to {} ───────────────────────

test('buildFnTable serverId.execute: non-object string arg coerced to {}', async () => {
  const host = makeHost(['neon']);
  const fns = buildFnTable(host);
  await fns['neon.execute']!('run_sql', 'not-an-object');
  assert.deepEqual(host.runToolCalls[0]!.args, {});
});

// ── 4. serverId.execute: array args coerced to {} ────────────────────────────

test('buildFnTable serverId.execute: array args coerced to {}', async () => {
  const host = makeHost(['neon']);
  const fns = buildFnTable(host);
  await fns['neon.execute']!('run_sql', [1, 2, 3]);
  assert.deepEqual(host.runToolCalls[0]!.args, {});
});

// ── 5. serverId.execute: valid object args forwarded ─────────────────────────

test('buildFnTable serverId.execute: valid object args forwarded', async () => {
  const host = makeHost(['neon']);
  const fns = buildFnTable(host);
  await fns['neon.execute']!('run_sql', { sql: 'SELECT 1', params: [] });
  assert.deepEqual(host.runToolCalls[0]!.args, { sql: 'SELECT 1', params: [] });
});

// ── 6. serverId.execute: routes to host.runTool with correct names ────────────

test('buildFnTable serverId.execute: routes to host.runTool(serverId/toolName, args, sessionId)', async () => {
  const host = makeHost(['neon']);
  const fns = buildFnTable(host, 'ses-abc');
  await fns['neon.execute']!('list_projects', { limit: 5 });
  const call = host.runToolCalls[0]!;
  assert.equal(call.tool, 'neon/list_projects');
  assert.deepEqual(call.args, { limit: 5 });
  assert.equal(call.sessionId, 'ses-abc');
});

// ── 7. serverId.search: null query coerced to '' ─────────────────────────────

test('buildFnTable serverId.search: null query coerced to ""', async () => {
  const host = makeHost(['neon']);
  const fns = buildFnTable(host);
  await fns['neon.search']!(null);
  assert.equal(host.searchToolCalls[0]!.query, '');
  assert.equal(host.searchToolCalls[0]!.server, 'neon');
});

// ── 8. serverId.search: string query + server filter forwarded ────────────────

test('buildFnTable serverId.search: string query + server filter forwarded', async () => {
  const host = makeHost(['stripe']);
  const fns = buildFnTable(host);
  await fns['stripe.search']!('payment intent');
  assert.equal(host.searchToolCalls[0]!.query, 'payment intent');
  assert.equal(host.searchToolCalls[0]!.server, 'stripe');
});

// ── 9. ch1tty.execute: routes namespaced tool ────────────────────────────────

test('buildFnTable ch1tty.execute: routes namespaced tool to host.runTool', async () => {
  const host = makeHost([]);
  const fns = buildFnTable(host, 'ses-xyz');
  await fns['ch1tty.execute']!('neon/run_sql', { sql: 'SELECT 2' });
  const call = host.runToolCalls[0]!;
  assert.equal(call.tool, 'neon/run_sql');
  assert.deepEqual(call.args, { sql: 'SELECT 2' });
  assert.equal(call.sessionId, 'ses-xyz');
});

// ── 10. ch1tty.search: no server filter ──────────────────────────────────────

test('buildFnTable ch1tty.search: calls searchTools with no server filter', async () => {
  const host = makeHost([]);
  const fns = buildFnTable(host);
  await fns['ch1tty.search']!('database query');
  const call = host.searchToolCalls[0]!;
  assert.equal(call.query, 'database query');
  assert.equal(call.server, undefined);
});

// ── 11. sessionId undefined → runTool receives undefined ─────────────────────

test('buildFnTable: no sessionId → runTool and ch1tty.execute receive undefined', async () => {
  const host = makeHost(['neon']);
  const fns = buildFnTable(host);  // no sessionId
  await fns['neon.execute']!('list', {});
  await fns['ch1tty.execute']!('neon/list', {});
  assert.equal(host.runToolCalls[0]!.sessionId, undefined);
  assert.equal(host.runToolCalls[1]!.sessionId, undefined);
});

// ── 12. marshalResult: success path ──────────────────────────────────────────

test('marshalResult: success path — result propagated, error + logs undefined', () => {
  const result = marshalResult({ result: { items: [1, 2, 3] } });
  assert.deepEqual(result.result, { items: [1, 2, 3] });
  assert.equal(result.error, undefined);
  assert.equal(result.logs, undefined);
});

// ── 13. marshalResult: error field ───────────────────────────────────────────

test('marshalResult: error field propagated', () => {
  const result = marshalResult({ result: null, error: 'syntax error at line 3' });
  assert.equal(result.error, 'syntax error at line 3');
  assert.equal(result.result, null);
});

// ── 14. marshalResult: logs field ────────────────────────────────────────────

test('marshalResult: logs field propagated', () => {
  const result = marshalResult({ result: 42, logs: ['step 1', 'step 2'] });
  assert.deepEqual(result.logs, ['step 1', 'step 2']);
  assert.equal(result.result, 42);
});
