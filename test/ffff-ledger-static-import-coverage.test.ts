/**
 * FFFF batch: ledger.ts coverage via STATIC import.
 *
 * All existing ledger.test.ts tests use dynamic import(`../src/ledger.js?t=…`)
 * so V8 tracks coverage under a different URL and src/ledger.ts shows ~70%
 * line coverage. These tests use a plain static import so every executed line
 * is attributed to src/ledger.ts correctly.
 *
 * Covered paths:
 *   bind() / unbind() — timer lifecycle + backend wiring
 *   flush() — success, empty-buffer no-op, no-backend no-op, retry, max-retries→DLQ
 *   flushAll() — multi-batch drain
 *   record() — coalescing upgrade (tool_call→tool_call_batch), append to batch, overflow
 *   shutdown() — with backend (flush+timer clear), with backend+remaining→DLQ
 *   writeDeadLetter error path — mkdirSync fails → log.error, no crash
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LedgerClient } from '../src/ledger.js';
import type { Backend, BackendStatus, ToolCallResult } from '../src/types.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function tempDlq(): { dlqPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-led-'));
  const dlqPath = join(dir, 'ledger.dlq.jsonl');
  return { dlqPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

type CallFn = (serverId: string, toolName: string, args?: Record<string, unknown>) => Promise<ToolCallResult>;

function fakeBackend(callFn: CallFn): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: 0, toolCacheAge: null }),
    listTools: async () => [],
    callTool: callFn,
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

const okCallTool: CallFn = async () => ({ content: [{ type: 'text', text: 'ok' }] });
const failCallTool: CallFn = async () => { throw new Error('backend unavailable'); };

// ── bind / unbind ─────────────────────────────────────────────────────────────

test('ffff: bind() wires backend and starts flush timer without throwing', async () => {
  const { dlqPath, cleanup } = tempDlq();
  const client = new LedgerClient(dlqPath);
  const backend = fakeBackend(okCallTool);
  client.bind(backend, 'ledger-svc');
  const stats = client.getStats();
  assert.equal(stats.flushIntervalMs, 10_000, 'interval constant exposed in stats');
  await client.shutdown();
  cleanup();
});

test('ffff: bind() called twice only creates one timer (idempotent)', async () => {
  const { dlqPath, cleanup } = tempDlq();
  const client = new LedgerClient(dlqPath);
  const backend = fakeBackend(okCallTool);
  client.bind(backend, 'ledger-svc');
  client.bind(backend, 'ledger-svc'); // second call — timer already set, skip
  const stats = client.getStats();
  assert.equal(stats.buffered, 0);
  await client.shutdown();
  cleanup();
});

test('ffff: unbind() clears timer and backend — subsequent flush() is no-op', async () => {
  const { dlqPath, cleanup } = tempDlq();
  const client = new LedgerClient(dlqPath);
  const backend = fakeBackend(okCallTool);
  client.bind(backend, 'ledger-svc');
  client.record('sess', 'evt', {});
  client.unbind();
  const flushed = await client.flush();
  assert.equal(flushed, 0, 'flush returns 0 after unbind (no backend)');
  assert.equal(client.getStats().buffered, 1, 'entry still in buffer after unbind');
  cleanup();
});

// ── flush() ───────────────────────────────────────────────────────────────────

test('ffff: flush() success — callTool called once, flushedCount incremented', async () => {
  const { dlqPath, cleanup } = tempDlq();
  const calls: Array<{ serverId: string; toolName: string; args: Record<string, unknown> | undefined }> = [];
  const backend = fakeBackend(async (sid, tn, args) => {
    calls.push({ serverId: sid, toolName: tn, args });
    return { content: [{ type: 'text', text: 'ok' }] };
  });

  const client = new LedgerClient(dlqPath);
  client.bind(backend, 'ledger-svc');
  client.record('sess-1', 'session_start', { user: 'alice' });
  const flushed = await client.flush();

  assert.equal(flushed, 1, 'one entry flushed');
  assert.equal(calls.length, 1, 'callTool called once');
  assert.equal(calls[0]!.serverId, 'ledger-svc');
  assert.equal(calls[0]!.toolName, 'chitty_ledger_record');
  assert.equal((calls[0]!.args as Record<string, unknown>)['event_type'], 'session_start');
  assert.equal(client.getStats().flushed, 1, 'stats reflect flushed count');
  assert.notEqual(client.getStats().lastFlushAt, null, 'lastFlushAt set after flush');

  await client.shutdown();
  cleanup();
});

test('ffff: flush() returns 0 when buffer is empty', async () => {
  const { dlqPath, cleanup } = tempDlq();
  const client = new LedgerClient(dlqPath);
  client.bind(fakeBackend(okCallTool), 'ledger-svc');
  const flushed = await client.flush();
  assert.equal(flushed, 0);
  await client.shutdown();
  cleanup();
});

test('ffff: flush() returns 0 when no backend bound', async () => {
  const { dlqPath, cleanup } = tempDlq();
  const client = new LedgerClient(dlqPath);
  client.record('sess', 'evt', {});
  const flushed = await client.flush();
  assert.equal(flushed, 0);
  assert.equal(client.getStats().buffered, 1, 'entry stays in buffer');
  cleanup();
});

test('ffff: flush() re-queues failed entries with incremented retries (retry < MAX_RETRIES)', async () => {
  const { dlqPath, cleanup } = tempDlq();
  const client = new LedgerClient(dlqPath);
  client.bind(fakeBackend(failCallTool), 'ledger-svc');
  client.record('sess', 'tool_call', { tool: 'x' });

  const flushed = await client.flush(); // entry.retries → 1, re-queued
  assert.equal(flushed, 0, 'no entries successfully flushed');
  assert.equal(client.getStats().flushErrors, 1, 'flushErrors incremented');
  assert.equal(client.getStats().buffered, 1, 'entry re-queued in buffer');
  assert.equal(existsSync(dlqPath), false, 'no DLQ write yet (retry < MAX_RETRIES)');

  await client.shutdown(); // drains remaining to DLQ
  cleanup();
});

test('ffff: flush() drops entry and writes DLQ after MAX_RETRIES (3) failures', async () => {
  const { dlqPath, cleanup } = tempDlq();
  const client = new LedgerClient(dlqPath);
  client.bind(fakeBackend(failCallTool), 'ledger-svc');
  client.record('sess', 'session_start', { user: 'bob' });

  await client.flush(); // retries = 1
  await client.flush(); // retries = 2
  await client.flush(); // retries = 3 → dropped + DLQ

  assert.equal(client.getStats().buffered, 0, 'entry removed from buffer after max retries');
  assert.equal(client.getStats().dropped, 1, 'dropped counter incremented');
  assert.ok(existsSync(dlqPath), 'DLQ file written after max retries');
  const lines = readFileSync(dlqPath, 'utf8').trim().split('\n').filter(Boolean);
  assert.equal(lines.length, 1, 'one DLQ entry');
  const entry = JSON.parse(lines[0]!);
  assert.equal(entry.event_type, 'session_start');
  assert.ok(entry.droppedAt, 'droppedAt stamped');

  await client.shutdown();
  cleanup();
});

// ── flushAll() ────────────────────────────────────────────────────────────────

test('ffff: flushAll() drains multiple batches (> BATCH_SIZE=25 entries)', async () => {
  const { dlqPath, cleanup } = tempDlq();
  let calls = 0;
  const client = new LedgerClient(dlqPath);
  client.bind(fakeBackend(async () => { calls++; return { content: [] }; }), 'ledger-svc');

  for (let i = 0; i < 30; i++) {
    client.record(`sess-${i}`, 'evt', { i });
  }
  assert.equal(client.getStats().buffered, 30);

  const total = await client.flushAll();
  assert.equal(total, 30, 'all 30 entries flushed');
  assert.equal(calls, 30, 'callTool called 30 times');
  assert.equal(client.getStats().buffered, 0, 'buffer empty after flushAll');

  await client.shutdown();
  cleanup();
});

// ── record() coalescing ───────────────────────────────────────────────────────

test('ffff: record() upgrades two rapid tool_calls into tool_call_batch', async () => {
  const { dlqPath, cleanup } = tempDlq();
  const captured: Array<Record<string, unknown>> = [];
  const client = new LedgerClient(dlqPath);
  client.bind(fakeBackend(async (_, __, args) => {
    captured.push(args as Record<string, unknown>);
    return { content: [] };
  }), 'ledger-svc');

  client.record('sess', 'tool_call', { tool: 'search' });
  client.record('sess', 'tool_call', { tool: 'execute' }); // upgrades first to tool_call_batch

  assert.equal(client.getStats().buffered, 1, 'coalesced into one buffer entry');
  await client.flush();
  assert.equal(captured.length, 1, 'one callTool call for the batch');
  assert.equal(captured[0]!['event_type'], 'tool_call_batch', 'event_type upgraded to batch');
  const meta = captured[0]!['metadata'] as Record<string, unknown>;
  assert.deepEqual(meta['tools'], ['search', 'execute'], 'both tools in batch');
  assert.equal(meta['count'], 2);

  await client.shutdown();
  cleanup();
});

test('ffff: record() appends third tool_call to existing tool_call_batch', async () => {
  const { dlqPath, cleanup } = tempDlq();
  const captured: Array<Record<string, unknown>> = [];
  const client = new LedgerClient(dlqPath);
  client.bind(fakeBackend(async (_, __, args) => {
    captured.push(args as Record<string, unknown>);
    return { content: [] };
  }), 'ledger-svc');

  client.record('sess', 'tool_call', { tool: 'a' });
  client.record('sess', 'tool_call', { tool: 'b' }); // upgrade → batch {a, b}
  client.record('sess', 'tool_call', { tool: 'c' }); // append → batch {a, b, c}

  assert.equal(client.getStats().buffered, 1, 'still one buffer entry');
  await client.flush();
  const meta = (captured[0]!['metadata']) as Record<string, unknown>;
  assert.deepEqual(meta['tools'], ['a', 'b', 'c'], 'three tools in batch');
  assert.equal(meta['count'], 3);

  await client.shutdown();
  cleanup();
});

test('ffff: record() drops oldest entries when buffer exceeds MAX_BUFFER_SIZE (500)', async () => {
  const { dlqPath, cleanup } = tempDlq();
  const client = new LedgerClient(dlqPath);

  // Fill buffer to exactly MAX_BUFFER_SIZE=500 with unique sessions (no coalescing)
  for (let i = 0; i < 500; i++) {
    client.record(`sess-${i}`, 'session_start', { i });
  }
  assert.equal(client.getStats().buffered, 500);
  assert.equal(client.getStats().dropped, 0, 'no drops yet');

  // One more entry triggers overflow: drops oldest 50 (10% of 500), adds 1 → 451
  client.record('sess-overflow', 'session_start', { overflow: true });
  assert.equal(client.getStats().dropped, 50, '10% of buffer dropped on overflow');
  assert.equal(client.getStats().buffered, 451, '500 - 50 + 1');

  cleanup();
});

// ── shutdown() with backend ───────────────────────────────────────────────────

test('ffff: shutdown() with bound backend flushes entries and clears timer', async () => {
  const { dlqPath, cleanup } = tempDlq();
  let flushed = 0;
  const client = new LedgerClient(dlqPath);
  client.bind(fakeBackend(async () => { flushed++; return { content: [] }; }), 'ledger-svc');
  client.record('sess', 'session_start', {});
  client.record('sess', 'session_end', {});
  await client.shutdown();
  assert.equal(flushed, 2, 'both entries flushed during shutdown');
  assert.equal(client.getStats().buffered, 0, 'buffer empty after shutdown');
  assert.equal(existsSync(dlqPath), false, 'no DLQ needed when all flushed');
  cleanup();
});

test('ffff: shutdown() writes remaining entries to DLQ when backend always fails', async () => {
  const { dlqPath, cleanup } = tempDlq();
  const client = new LedgerClient(dlqPath);
  client.bind(fakeBackend(failCallTool), 'ledger-svc');
  client.record('sess', 'session_start', { user: 'carol' });
  await client.shutdown();
  // flushAll breaks on first 0-return, then shutdown writes buffer to DLQ
  assert.ok(existsSync(dlqPath), 'DLQ written for remaining entries');
  const lines = readFileSync(dlqPath, 'utf8').trim().split('\n').filter(Boolean);
  assert.ok(lines.length >= 1, 'at least one DLQ entry');
  cleanup();
});

// ── writeDeadLetter error path ────────────────────────────────────────────────

test('ffff: writeDeadLetter error path — mkdirSync failure logs error without crashing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-led-err-'));
  // Create a regular FILE at the directory name so mkdirSync(dir/blocker) fails with ENOTDIR
  const blockerPath = join(dir, 'blocker');
  writeFileSync(blockerPath, 'i-am-a-file');
  // dlqPath whose dirname is a file path component that can't be created as a dir
  const dlqPath = join(blockerPath, 'ledger.dlq.jsonl');

  const client = new LedgerClient(dlqPath);
  client.record('sess', 'evt', {});
  // shutdown() calls writeDeadLetter which tries mkdirSync(dirname(dlqPath)) = blockerPath
  // blockerPath is a FILE → mkdirSync throws EEXIST/ENOTDIR → caught, log.error called
  await assert.doesNotReject(
    () => client.shutdown(),
    'shutdown must not throw even when DLQ write fails',
  );
  // DLQ file should NOT have been written (the write failed)
  assert.equal(existsSync(dlqPath), false, 'DLQ file not created when directory creation fails');
  rmSync(dir, { recursive: true, force: true });
});
