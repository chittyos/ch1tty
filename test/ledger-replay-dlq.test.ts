/**
 * LedgerClient.replayDlq() — replay dead-letter WAL entries when backend reconnects.
 *
 * Covered paths:
 *   1. No-op when backend not bound.
 *   2. No-op when DLQ file does not exist.
 *   3. No-op when DLQ file is empty.
 *   4. All entries replayed successfully — DLQ file removed, returns count.
 *   5. Partial success — failed entries rewritten to DLQ, replayed entries removed.
 *   6. isError:true response treated as failure — entry kept in DLQ.
 *   7. replayDlq is idempotent: second call with no DLQ returns 0.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Backend, BackendStatus, ToolCallResult, ToolEntry } from '../src/types.js';
import { LedgerClient } from '../src/ledger.js';

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

function tempDlq(): { dlqPath: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-replay-test-'));
  return { dlqPath: join(dir, 'ledger.dlq.jsonl'), dir };
}

function seedDlq(dlqPath: string, count: number): void {
  const lines = Array.from({ length: count }, (_, i) =>
    JSON.stringify({
      event_type: 'session_start',
      session_id: `sess-${i}`,
      metadata: { seq: i },
      timestamp: new Date().toISOString(),
      retries: 3,
      droppedAt: new Date().toISOString(),
    }),
  ).join('\n') + '\n';
  writeFileSync(dlqPath, lines, 'utf8');
}

// ── 1. No-op when no backend bound ───────────────────────────────────────────

test('replayDlq: returns 0 when no backend is bound', async () => {
  const { dlqPath, dir } = tempDlq();
  try {
    const client = new LedgerClient(dlqPath);
    seedDlq(dlqPath, 3);
    const count = await client.replayDlq();
    assert.equal(count, 0, 'must return 0 when no backend bound');
    assert.equal(client.dlqEntries(), 3, 'DLQ file must not be modified without a backend');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 2. No-op when DLQ file does not exist ────────────────────────────────────

test('replayDlq: returns 0 when DLQ file does not exist', async () => {
  const { dlqPath, dir } = tempDlq();
  const client = new LedgerClient(dlqPath);
  const backend = makeBackend(async () => ({ content: [{ type: 'text', text: 'ok' }], isError: false }));
  try {
    client.bind(backend, 'ledger-svc');
    assert.equal(existsSync(dlqPath), false, 'DLQ file must not exist before replay');
    const count = await client.replayDlq();
    assert.equal(count, 0, 'must return 0 when DLQ is absent');
  } finally {
    client.unbind();
    await client.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 3. No-op when DLQ file is empty ──────────────────────────────────────────

test('replayDlq: returns 0 when DLQ file exists but has no valid lines', async () => {
  const { dlqPath, dir } = tempDlq();
  try {
    writeFileSync(dlqPath, '\n\n', 'utf8');
    const client = new LedgerClient(dlqPath);
    const backend = makeBackend(async () => ({ content: [{ type: 'text', text: 'ok' }], isError: false }));
    client.bind(backend, 'ledger-svc');
    const count = await client.replayDlq();
    assert.equal(count, 0, 'must return 0 for empty / whitespace-only DLQ');
    client.unbind();
    await client.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 4. All entries replayed — DLQ file removed ───────────────────────────────

test('replayDlq: replays all entries successfully and removes DLQ file', async () => {
  const { dlqPath, dir } = tempDlq();
  const calls: string[] = [];
  const backend = makeBackend(async (_sid, tool) => {
    calls.push(tool);
    return { content: [{ type: 'text', text: 'ok' }], isError: false };
  });
  try {
    seedDlq(dlqPath, 3);
    const client = new LedgerClient(dlqPath);
    client.bind(backend, 'ledger-svc');

    const count = await client.replayDlq();

    assert.equal(count, 3, 'must return 3 for 3 successful replays');
    assert.equal(calls.length, 3, 'backend called once per DLQ entry');
    assert.ok(calls.every((t) => t === 'chitty_ledger_record'), 'all calls to chitty_ledger_record');
    assert.equal(existsSync(dlqPath), false, 'DLQ file removed after full replay');
    assert.equal(client.dlqEntries(), 0, 'dlqEntries() returns 0 after full replay');

    client.unbind();
    await client.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 5. Partial success — failed entries rewritten to DLQ ─────────────────────

test('replayDlq: replays successes and keeps failed entries in DLQ', async () => {
  const { dlqPath, dir } = tempDlq();
  let callIndex = 0;
  const backend = makeBackend(async () => {
    callIndex++;
    // first and third succeed; second fails
    if (callIndex === 2) throw new Error('transient error');
    return { content: [{ type: 'text', text: 'ok' }], isError: false };
  });
  try {
    seedDlq(dlqPath, 3);
    const client = new LedgerClient(dlqPath);
    client.bind(backend, 'ledger-svc');

    const count = await client.replayDlq();

    assert.equal(count, 2, '2 entries replayed (first and third)');
    assert.ok(existsSync(dlqPath), 'DLQ file must still exist for the 1 failed entry');
    const remaining = client.dlqEntries();
    assert.equal(remaining, 1, 'exactly 1 entry remains in DLQ');

    // Re-read to verify structure preserved
    const lines = readFileSync(dlqPath, 'utf8').trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]) as Record<string, unknown>;
    assert.ok('event_type' in entry, 'remaining DLQ entry preserves event_type');
    assert.ok('droppedAt' in entry, 'remaining DLQ entry preserves droppedAt');

    client.unbind();
    await client.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 6. isError:true response keeps entry in DLQ ──────────────────────────────

test('replayDlq: isError:true from backend counts as failure, entry kept in DLQ', async () => {
  const { dlqPath, dir } = tempDlq();
  const backend = makeBackend(async () => ({
    content: [{ type: 'text', text: 'unauthorized' }],
    isError: true,
  }));
  try {
    seedDlq(dlqPath, 2);
    const client = new LedgerClient(dlqPath);
    client.bind(backend, 'ledger-svc');

    const count = await client.replayDlq();

    assert.equal(count, 0, 'isError:true must not count as success');
    assert.equal(client.dlqEntries(), 2, 'all entries must remain in DLQ on isError:true');

    client.unbind();
    await client.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 7. Idempotent: second replay when DLQ is gone returns 0 ──────────────────

test('replayDlq: idempotent — second call after full replay returns 0', async () => {
  const { dlqPath, dir } = tempDlq();
  const backend = makeBackend(async () => ({ content: [{ type: 'text', text: 'ok' }], isError: false }));
  try {
    seedDlq(dlqPath, 2);
    const client = new LedgerClient(dlqPath);
    client.bind(backend, 'ledger-svc');

    const first = await client.replayDlq();
    assert.equal(first, 2, 'first replay returns 2');

    const second = await client.replayDlq();
    assert.equal(second, 0, 'second replay returns 0 (DLQ already cleared)');

    client.unbind();
    await client.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
