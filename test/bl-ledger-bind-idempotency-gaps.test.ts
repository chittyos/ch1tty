/**
 * Workstream BL — three targeted branch gaps in src-stdio/ledger.ts
 *
 * 1. ledger.ts:181 — bind() called twice → `if (!this.flushTimer)` false branch fires on
 *    second call (timer already set, no-op). First bind creates the timer; second bind
 *    updates backend/serverId but leaves the timer unchanged.
 *
 * 2. ledger.ts:228 — record() tool_call_batch dedup: `if (tool && !tools.includes(tool))`
 *    false branch fires when the same tool is added again within the 2-second coalescing
 *    window. The duplicate is silently dropped (count stays the same, tools array unchanged).
 *
 * 3. ledger.ts:298 — flush() result.isError true branch: when the backend returns
 *    `{ isError: true, content: [...] }` instead of throwing, flush() re-routes through
 *    the catch block, increments retries, and eventually DLQ-drops the entry.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Backend, BackendStatus, ToolCallResult, ToolEntry } from '../src/types.js';
import { LedgerClient } from '../src/ledger.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-bl-'));
  const dlqPath = join(dir, 'ledger.dlq.jsonl');
  return { dlqPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ── 1. bind() idempotency: second call is a no-op for the timer ───────────────

test('ledger.ts:181 — bind() twice: second bind updates backend but does not create a second timer', async () => {
  const { dlqPath, cleanup } = tempDlq();
  try {
    const client = new LedgerClient(dlqPath);

    let callCount1 = 0;
    const backend1 = makeBackend(async () => {
      callCount1++;
      return { content: [{ type: 'text' as const, text: 'ok' }] };
    });

    let callCount2 = 0;
    const backend2 = makeBackend(async () => {
      callCount2++;
      return { content: [{ type: 'text' as const, text: 'ok' }] };
    });

    // First bind — creates the timer (flushTimer was null → true branch fires).
    client.bind(backend1, 'eco-bl-1');

    // Second bind — flushTimer is already set → false branch fires (timer not recreated).
    // Backend/serverId is updated silently.
    client.bind(backend2, 'eco-bl-2');

    // Record an entry and flush — it should go to backend2 (the latest bind).
    client.record('sess-bl-bind', 'session_start', {});
    const flushed = await client.flush();
    assert.equal(flushed, 1, 'flush must succeed through the second-bound backend');
    assert.equal(callCount2, 1, 'second backend received the flush call');
    assert.equal(callCount1, 0, 'first backend was not called after rebind');

    await client.shutdown();
  } finally {
    cleanup();
  }
});

// ── 2. tool_call_batch dedup: duplicate tool is silently dropped ───────────────

test('ledger.ts:228 — tool_call_batch: recording the same tool twice keeps count unchanged', () => {
  const { dlqPath, cleanup } = tempDlq();
  try {
    const client = new LedgerClient(dlqPath);

    // First two tool_calls within <2s: first is promoted to tool_call_batch with 2 tools.
    client.record('sess-bl-dedup', 'tool_call', { tool: 'alpha/search' });
    client.record('sess-bl-dedup', 'tool_call', { tool: 'beta/execute' });

    // Verify batch was formed.
    type WithBuffer = { buffer: Array<{ event_type: string; metadata: { tools: string[]; count: number } }> };
    const buf = (client as unknown as WithBuffer).buffer;
    assert.equal(buf.length, 1, 'two rapid tool_calls must collapse into one batch entry');
    assert.equal(buf[0]!.event_type, 'tool_call_batch');
    assert.equal(buf[0]!.metadata.count, 2);

    // Third tool_call for the same tool already in the batch — duplicate.
    // if (tool && !tools.includes(tool)) fires FALSE → no-op, count stays 2.
    client.record('sess-bl-dedup', 'tool_call', { tool: 'alpha/search' });

    assert.equal(buf.length, 1, 'duplicate tool call must not add a new buffer entry');
    assert.equal(buf[0]!.metadata.count, 2, 'count must remain 2 after duplicate tool is skipped');
    assert.deepEqual(
      buf[0]!.metadata.tools,
      ['alpha/search', 'beta/execute'],
      'tools array must not contain the duplicate',
    );
  } finally {
    cleanup();
  }
});

// ── 3. flush() result.isError true branch → retries → DLQ drop ────────────────

test('ledger.ts:298 — flush() with isError:true backend response exhausts retries and writes to DLQ', async () => {
  const { dlqPath, cleanup } = tempDlq();
  try {
    // Backend returns isError:true on every call instead of throwing.
    const client = new LedgerClient(dlqPath);
    const backend = makeBackend(async () => ({
      isError: true,
      content: [{ type: 'text' as const, text: 'ledger write rejected: forbidden' }],
    }));
    client.bind(backend, 'eco-bl-iserror');

    client.record('sess-bl-iserror', 'session_start', { detail: 'test' });

    // 3 flushes: after each, entry is re-queued with retries++.
    // On the 3rd flush (retries === MAX_RETRIES === 3), the entry is dropped to DLQ.
    for (let i = 0; i < 3; i++) {
      await client.flush();
    }

    // After MAX_RETRIES exhausted, entry must have been written to the DLQ.
    const stats = client.getStats();
    assert.equal(stats.buffered, 0, 'buffer must be empty after max retries exhausted');
    assert.equal(stats.dropped, 1, 'dropped counter must be incremented');
    assert.ok(existsSync(dlqPath), 'DLQ file must exist after max-retry drop');
    assert.equal(client.dlqEntries(), 1, 'exactly one entry must be in the DLQ');

    await client.shutdown();
  } finally {
    cleanup();
  }
});
