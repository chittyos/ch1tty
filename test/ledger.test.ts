import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LedgerClient } from '../src/ledger.js';

function tempDlq(): { dlqPath: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-ledger-test-'));
  return { dlqPath: join(dir, 'ledger.dlq.jsonl'), dir };
}

test('shutdown drains buffer to DLQ when no backend was ever bound', async () => {
  const { dlqPath, dir } = tempDlq();
  try {
    const client = new LedgerClient(dlqPath);

    client.record('sess-1', 'session_start', { user: 'test' });
    client.record('sess-1', 'custom_event', { detail: 'a' });
    client.record('sess-2', 'session_end', { duration: 42 });

    await client.shutdown();

    assert.ok(existsSync(dlqPath), 'DLQ file should exist after shutdown drain');
    const lines = readFileSync(dlqPath, 'utf8').trim().split('\n');
    assert.equal(lines.length, 3);

    const parsed = lines.map((l) => JSON.parse(l));
    assert.equal(parsed[0].event_type, 'session_start');
    assert.equal(parsed[0].session_id, 'sess-1');
    assert.equal(parsed[1].event_type, 'custom_event');
    assert.equal(parsed[2].event_type, 'session_end');
    for (const entry of parsed) {
      assert.ok(entry.droppedAt, 'each DLQ entry stamped with droppedAt');
      assert.equal(typeof entry.timestamp, 'string');
    }

    const stats = client.getStats();
    assert.equal(stats.buffered, 0, 'buffer cleared after DLQ drain');
    assert.equal(stats.dropped, 3, 'all entries counted as dropped');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('shutdown without bound backend and empty buffer does not create DLQ file', async () => {
  const { dlqPath, dir } = tempDlq();
  try {
    const client = new LedgerClient(dlqPath);
    await client.shutdown();
    assert.equal(existsSync(dlqPath), false, 'no DLQ file created when nothing to drain');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('DLQ directory is created recursively if missing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-ledger-mkdir-'));
  const dlqPath = join(dir, 'nested', 'subdir', 'ledger.dlq.jsonl');
  try {
    const client = new LedgerClient(dlqPath);
    client.record('sess-x', 'evt', {});
    await client.shutdown();
    assert.ok(existsSync(dlqPath), 'nested DLQ path created via mkdirSync recursive');
    const content = readFileSync(dlqPath, 'utf8');
    assert.match(content, /sess-x/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dlqEntries returns 0 when DLQ file does not exist', async () => {
  const { dlqPath, dir } = tempDlq();
  try {
    const client = new LedgerClient(dlqPath);
    assert.equal(existsSync(dlqPath), false);
    assert.equal(client.dlqEntries(), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dlqEntries returns correct count after DLQ drain', async () => {
  const { dlqPath, dir } = tempDlq();
  try {
    const client = new LedgerClient(dlqPath);
    client.record('sess-a', 'session_start', {});
    client.record('sess-a', 'tool_call', { tool: 'x' });
    client.record('sess-b', 'session_end', {});
    await client.shutdown();
    assert.equal(client.dlqEntries(), 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getStats includes dlqPath and dlqEntries', async () => {
  const { dlqPath, dir } = tempDlq();
  try {
    const client = new LedgerClient(dlqPath);
    const statsBefore = client.getStats();
    assert.equal(statsBefore.dlqPath, dlqPath);
    assert.equal(statsBefore.dlqEntries, 0, 'no DLQ entries before any drain');

    client.record('sess-c', 'session_start', {});
    await client.shutdown();
    const statsAfter = client.getStats();
    assert.equal(statsAfter.dlqEntries, 1, 'DLQ entry count reflects drained file');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
