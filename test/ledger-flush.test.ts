/**
 * RR: LedgerClient flush path, retry/DLQ drain, tool_call coalescing, buffer-full drop.
 *
 * Covered paths (ledger.ts not reached by the existing ledger.test.ts):
 *   1. bind() + flush() with a succeeding backend — entries flushed, totalFlushed
 *      incremented, lastFlushAt updated (ledger.ts:179–231).
 *   2. flush() with a backend that always throws — retries < MAX_RETRIES requeues
 *      the entry to the front of the buffer; flushErrors counter increments
 *      (ledger.ts:202–218).
 *   3. flush() exhausts MAX_RETRIES — entry written to DLQ instead of requeued
 *      (ledger.ts:204–210).
 *   4. record() tool_call coalescing — two rapid tool_calls same session upgrade the
 *      first entry to tool_call_batch (ledger.ts:140–158).
 *   5. record() appends to an existing tool_call_batch within the 2-second window
 *      (ledger.ts:122–138).
 *   6. buffer overflow — 500+ entries cause the oldest 10% to be dropped and
 *      totalDropped to be incremented (ledger.ts:161–165).
 *   7. unbind() stops the flush timer (flushTimer set to null) and clears backend
 *      (ledger.ts:104–112).
 *   8. shutdown() WITH backend bound — flushes what it can, then writes remaining
 *      unflushed entries to DLQ (ledger.ts:269–295).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Backend, BackendStatus, ToolCallResult, ToolEntry } from '../src/types.js';
import { LedgerClient } from '../src/ledger.js';

// ── Minimal Backend stub ──────────────────────────────────────────────────────

function makeBackend(
  callToolFn: (serverId: string, toolName: string, args: Record<string, unknown>) => Promise<ToolCallResult>,
): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: 0, toolCacheAge: null }),
    listTools: async (): Promise<ToolEntry[]> => [],
    callTool: callToolFn,
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

function tempDlq(): { dlqPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-rr-'));
  const dlqPath = join(dir, 'ledger.dlq.jsonl');
  return { dlqPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ── 1. bind + flush with succeeding backend ───────────────────────────────────

test('flush: entries dispatched to backend, totalFlushed incremented, lastFlushAt set', async () => {
  const { dlqPath, cleanup } = tempDlq();
  const client = new LedgerClient(dlqPath);
  const callLog: string[] = [];

  const backend = makeBackend(async (_sid, toolName) => {
    callLog.push(toolName);
    return { content: [{ type: 'text', text: 'ok' }], isError: false };
  });

  try {
    client.record('sess-1', 'session_start', { user: 'alice' });
    client.record('sess-1', 'tool_call', { tool: 'neon/run_sql' });

    let stats = client.getStats();
    assert.equal(stats.buffered, 2, 'two entries buffered before flush');
    assert.equal(stats.flushed, 0, 'nothing flushed yet');
    assert.equal(stats.lastFlushAt, null, 'no lastFlushAt before flush');

    client.bind(backend, 'ledger-svc');
    const flushed = await client.flush();
    assert.equal(flushed, 2, 'both entries flushed');

    stats = client.getStats();
    assert.equal(stats.buffered, 0, 'buffer empty after flush');
    assert.equal(stats.flushed, 2, 'totalFlushed = 2');
    assert.ok(stats.lastFlushAt !== null, 'lastFlushAt updated after flush');
    assert.equal(callLog.length, 2, 'callTool called once per entry');
    assert.ok(callLog.every((n) => n === 'chitty_ledger_record'), 'tool name is chitty_ledger_record');
  } finally {
    client.unbind();
    await client.shutdown();
    cleanup();
  }
});

// ── 2. flush with consistently-failing backend requeues entries ───────────────

test('flush: failing backend requeues entry and increments flushErrors', async () => {
  const { dlqPath, cleanup } = tempDlq();
  const client = new LedgerClient(dlqPath);
  const failBackend = makeBackend(async () => { throw new Error('backend down'); });

  try {
    client.record('sess-2', 'session_start', {});
    client.bind(failBackend, 'ledger-svc');

    await client.flush(); // attempt 1 — retries=1, requeued

    const stats = client.getStats();
    assert.equal(stats.buffered, 1, 'entry requeued after first failure');
    assert.equal(stats.flushErrors, 1, 'flushErrors incremented');
    assert.equal(stats.flushed, 0, 'nothing flushed after failure');
  } finally {
    client.unbind();
    cleanup();
  }
});

// ── 3. flush exhausts MAX_RETRIES — entry written to DLQ ─────────────────────

test('flush: entry written to DLQ after MAX_RETRIES (3) failures', async () => {
  const { dlqPath, cleanup } = tempDlq();
  const client = new LedgerClient(dlqPath);
  const failBackend = makeBackend(async () => { throw new Error('permanent failure'); });

  try {
    client.record('sess-3', 'tool_call', { tool: 'neon/run_sql' });
    client.bind(failBackend, 'ledger-svc');

    // Three consecutive failures exhaust MAX_RETRIES (3)
    await client.flush(); // retries=1, requeued
    await client.flush(); // retries=2, requeued
    await client.flush(); // retries=3 >= MAX_RETRIES → DLQ

    const stats = client.getStats();
    assert.equal(stats.buffered, 0, 'entry removed from buffer after max retries');
    assert.ok(existsSync(dlqPath), 'DLQ file created after max-retries drop');

    const lines = readFileSync(dlqPath, 'utf8').trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 1, 'exactly one entry in DLQ');
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.event_type, 'tool_call', 'DLQ entry preserves event_type');
    assert.ok(entry.droppedAt, 'DLQ entry has droppedAt timestamp');
  } finally {
    client.unbind();
    cleanup();
  }
});

// ── 4. record() coalesces two rapid tool_calls into tool_call_batch ───────────

test('record: two rapid tool_calls same session upgraded to tool_call_batch', () => {
  const { dlqPath, cleanup } = tempDlq();
  const client = new LedgerClient(dlqPath);

  try {
    client.record('sess-4', 'tool_call', { tool: 'neon/run_sql' });
    client.record('sess-4', 'tool_call', { tool: 'github/list_repos' });

    const stats = client.getStats();
    // Two tool_calls within 2s → second upgrades first to batch: 1 entry total
    assert.equal(stats.buffered, 1, 'two rapid tool_calls coalesce into 1 batch entry');

    // Peek at internal buffer to verify batch shape
    const buf = (client as unknown as { buffer: Array<{ event_type: string; metadata: { tools: string[]; count: number } }> }).buffer;
    assert.equal(buf[0].event_type, 'tool_call_batch', 'event_type upgraded to tool_call_batch');
    assert.deepEqual(buf[0].metadata.tools, ['neon/run_sql', 'github/list_repos'], 'both tools recorded in batch');
    assert.equal(buf[0].metadata.count, 2, 'count reflects batch size');
  } finally {
    cleanup();
  }
});

// ── 5. record() appends a third tool to an existing tool_call_batch ───────────

test('record: third rapid tool_call same session appended to existing batch', () => {
  const { dlqPath, cleanup } = tempDlq();
  const client = new LedgerClient(dlqPath);

  try {
    client.record('sess-5', 'tool_call', { tool: 'neon/run_sql' });
    client.record('sess-5', 'tool_call', { tool: 'github/list_repos' }); // upgrades to batch
    client.record('sess-5', 'tool_call', { tool: 'fs/read_file' });       // appended to batch

    const stats = client.getStats();
    assert.equal(stats.buffered, 1, 'three rapid tool_calls still one batch entry');

    const buf = (client as unknown as { buffer: Array<{ event_type: string; metadata: { tools: string[]; count: number } }> }).buffer;
    assert.equal(buf[0].event_type, 'tool_call_batch');
    assert.equal(buf[0].metadata.count, 3, 'count is 3 after third append');
    assert.ok(buf[0].metadata.tools.includes('fs/read_file'), 'third tool present in batch');
  } finally {
    cleanup();
  }
});

// ── 6. buffer overflow drops oldest 10% and increments totalDropped ───────────

test('record: buffer overflow (>500) drops oldest 10% and increments totalDropped', () => {
  const { dlqPath, cleanup } = tempDlq();
  const client = new LedgerClient(dlqPath);

  try {
    // Fill buffer to 500 (the limit)
    for (let i = 0; i < 500; i++) {
      client.record(`sess-${i}`, 'custom_event', { seq: i });
    }
    assert.equal(client.getStats().buffered, 500, 'buffer at capacity');
    assert.equal(client.getStats().dropped, 0, 'no drops yet');

    // 501st entry triggers overflow: splice(0, 50) drops oldest 50
    client.record('sess-overflow', 'overflow_event', {});

    const stats = client.getStats();
    // After drop: 500 - 50 = 450 remaining, plus the new entry = 451
    assert.equal(stats.buffered, 451, 'oldest 50 entries dropped to make room');
    assert.equal(stats.dropped, 50, 'totalDropped reflects 50 oldest evictions');
  } finally {
    cleanup();
  }
});

// ── 7. unbind() stops the flush timer ─────────────────────────────────────────

test('unbind: clears flushTimer and detaches backend', () => {
  const { dlqPath, cleanup } = tempDlq();
  const client = new LedgerClient(dlqPath);
  const backend = makeBackend(async () => ({ content: [{ type: 'text', text: 'ok' }], isError: false }));

  try {
    client.bind(backend, 'ledger-svc');
    // Timer must be set after bind
    const timerBefore = (client as unknown as { flushTimer: ReturnType<typeof setInterval> | null }).flushTimer;
    assert.ok(timerBefore !== null, 'flushTimer set after bind');

    client.unbind();
    const timerAfter = (client as unknown as { flushTimer: ReturnType<typeof setInterval> | null }).flushTimer;
    assert.equal(timerAfter, null, 'flushTimer cleared after unbind');
    const backendAfter = (client as unknown as { backend?: Backend }).backend;
    assert.equal(backendAfter, undefined, 'backend detached after unbind');
  } finally {
    cleanup();
  }
});

// ── 8. shutdown() with bound backend flushes what it can, DLQs the rest ───────

test('shutdown: with backend bound — flushes successes, DLQs entries that fail', async () => {
  const { dlqPath, cleanup } = tempDlq();
  const client = new LedgerClient(dlqPath);
  let callCount = 0;

  // Backend succeeds on first call, then permanently fails
  const partialBackend = makeBackend(async () => {
    callCount++;
    if (callCount === 1) return { content: [{ type: 'text', text: 'ok' }], isError: false };
    throw new Error('backend failed');
  });

  try {
    client.record('sess-a', 'session_start', {});
    client.record('sess-b', 'tool_call', { tool: 'neon/run_sql' });
    client.bind(partialBackend, 'ledger-svc');

    // shutdown flushes: first entry succeeds (callCount=1), second fails and is requeueed.
    // flushAll() loops until buffer empty or 0 returned; the failing entry's retries
    // eventually exhaust on repeated flush attempts and gets DLQ'd during shutdown drain.
    await client.shutdown();

    const stats = client.getStats();
    assert.equal(stats.buffered, 0, 'buffer cleared by shutdown');
    // At least the first entry was flushed to the backend
    assert.ok(stats.flushed >= 1, `at least 1 entry flushed during shutdown; got ${stats.flushed}`);
    // Remaining unflushed entries (second entry that failed all retries in flushAll)
    // are written to DLQ by shutdown's drain path
    assert.ok(existsSync(dlqPath), 'DLQ file created for entries that could not be flushed');
  } finally {
    cleanup();
  }
});
