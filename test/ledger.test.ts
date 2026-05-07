import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function withTempDlq<T>(fn: (dlqPath: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-ledger-test-'));
  const dlqPath = join(dir, 'ledger.dlq.jsonl');
  const original = process.env.CH1TTY_LEDGER_DLQ;
  process.env.CH1TTY_LEDGER_DLQ = dlqPath;
  try {
    return await fn(dlqPath);
  } finally {
    if (original === undefined) delete process.env.CH1TTY_LEDGER_DLQ;
    else process.env.CH1TTY_LEDGER_DLQ = original;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('shutdown drains buffer to DLQ when no backend was ever bound', async () => {
  await withTempDlq(async (dlqPath) => {
    // Module reads CH1TTY_LEDGER_DLQ at import time, so re-import after env mutation.
    const { LedgerClient } = await import(`../src/ledger.js?t=${Date.now()}`);
    const client = new LedgerClient();

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
  });
});

test('shutdown without bound backend and empty buffer does not create DLQ file', async () => {
  await withTempDlq(async (dlqPath) => {
    const { LedgerClient } = await import(`../src/ledger.js?t=${Date.now()}`);
    const client = new LedgerClient();
    await client.shutdown();
    assert.equal(existsSync(dlqPath), false, 'no DLQ file created when nothing to drain');
  });
});

test('DLQ directory is created recursively if missing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-ledger-mkdir-'));
  const dlqPath = join(dir, 'nested', 'subdir', 'ledger.dlq.jsonl');
  const original = process.env.CH1TTY_LEDGER_DLQ;
  process.env.CH1TTY_LEDGER_DLQ = dlqPath;
  try {
    const { LedgerClient } = await import(`../src/ledger.js?t=${Date.now()}`);
    const client = new LedgerClient();
    client.record('sess-x', 'evt', {});
    await client.shutdown();
    assert.ok(existsSync(dlqPath), 'nested DLQ path created via mkdirSync recursive');
    const content = readFileSync(dlqPath, 'utf8');
    assert.match(content, /sess-x/);
  } finally {
    if (original === undefined) delete process.env.CH1TTY_LEDGER_DLQ;
    else process.env.CH1TTY_LEDGER_DLQ = original;
    rmSync(dir, { recursive: true, force: true });
  }
});
