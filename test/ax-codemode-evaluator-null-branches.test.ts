/**
 * Workstream AX: codemode-fns.ts ch1tty.* null/array branches +
 *                evaluator.ts getStats() ?? 0 fallback branch.
 *
 * Covers 3 previously-uncovered branch paths:
 *
 *  codemode-fns.ts line 27 — `ch1tty.search`: `query ?? ''` right side
 *    (when query is null → String(null ?? '') → String('') → '')
 *  codemode-fns.ts line 29 — `ch1tty.execute`: ternary false branch
 *    (when args is an array → coerced to {})
 *  evaluator.ts line 92 — `getStats()`: `.toArray()[0]?.c ?? 0` right side
 *    (when exec() returns an empty array → optional chain gives undefined → ?? 0)
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFnTable } from '../src/codemode-fns.js';
import { Evaluator } from '../src/evaluator.js';
import type { CodemodeHost } from '../src/codemode-bridge.js';

// ── Minimal CodemodeHost ──────────────────────────────────────────────────────

function makeHost(serverIds: string[] = []): CodemodeHost & {
  runToolCalls: Array<{ tool: string; args: Record<string, unknown> }>;
  searchToolCalls: Array<{ query: string; server?: string }>;
} {
  const runToolCalls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const searchToolCalls: Array<{ query: string; server?: string }> = [];
  return {
    remoteServerIds: () => serverIds,
    async runTool(tool, args) { runToolCalls.push({ tool, args }); return { ok: true }; },
    async searchTools(query, server) { searchToolCalls.push({ query, server }); return []; },
    runToolCalls,
    searchToolCalls,
  };
}

// ── codemode-fns.ts line 27: ch1tty.search null query → '' ───────────────────

test('codemode-fns.ts:27 — ch1tty.search null query coerced to "" via ?? fallback', async () => {
  const host = makeHost([]);
  const fns = buildFnTable(host);
  await fns['ch1tty.search']!(null);
  assert.equal(host.searchToolCalls[0]!.query, '', 'null query should coerce to empty string via ?? ""');
  assert.equal(host.searchToolCalls[0]!.server, undefined);
});

// ── codemode-fns.ts line 29: ch1tty.execute array args → {} ─────────────────

test('codemode-fns.ts:29 — ch1tty.execute array args coerced to {} via ternary false branch', async () => {
  const host = makeHost([]);
  const fns = buildFnTable(host);
  await fns['ch1tty.execute']!('neon/run_sql', [1, 2, 3]);
  assert.deepEqual(host.runToolCalls[0]!.args, {}, 'array args should coerce to {} in ch1tty.execute');
});

// ── evaluator.ts line 92: getStats() ?? 0 branch ─────────────────────────────

function makeEmptySqlStorage() {
  return {
    exec<T>(_sql: string): { toArray(): T[] } {
      return { toArray: () => [] as T[] };
    },
  };
}

test('evaluator.ts:92 — getStats() ?? 0 fires when exec returns empty array', () => {
  const sql = makeEmptySqlStorage();
  const ev = new Evaluator(sql as unknown as SqlStorage);
  const stats = ev.getStats();
  assert.equal(stats.buffered, 0, 'buffered should be 0 via ?? 0 when COUNT(*) exec returns []');
  assert.equal(stats.flushed, 0);
});
