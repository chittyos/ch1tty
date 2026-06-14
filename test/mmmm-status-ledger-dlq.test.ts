/**
 * MMMM — `ledgerDlq` shorthand at status snapshot top level.
 *
 * `getStatusSnapshot()` now includes `ledgerDlq: { path, entryCount }` alongside
 * `ledgerHealth`, giving operators a direct top-level handle on the DLQ state
 * without navigating into `ledgerHealth` — especially useful when
 * `systemHealth.status === 'degraded'`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Aggregator } from '../src/aggregator.js';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'ch1tty-mmmm-'));
}

function seedDlq(dir: string, name: string, count: number): string {
  const path = join(dir, `${name}.dlq.jsonl`);
  const lines =
    Array.from({ length: count }, (_, i) =>
      JSON.stringify({
        event_type: 'test',
        session_id: `s${i}`,
        metadata: {},
        timestamp: new Date().toISOString(),
        retries: 0,
        droppedAt: new Date().toISOString(),
      }),
    ).join('\n') + '\n';
  writeFileSync(path, lines, 'utf8');
  return path;
}

function isolatedAgg(dir: string, name: string, dlqPath?: string): Aggregator {
  return new Aggregator([], {
    embedEnabled: false,
    ledgerDlqPath: dlqPath ?? join(dir, `${name}.dlq.jsonl`),
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
  });
}

// MMMM-1: ledgerDlq field is present at snapshot top level
test('MMMM-1: ledgerDlq is present at status snapshot top level', async () => {
  const dir = tempDir();
  const agg = isolatedAgg(dir, 'mmmm1');
  try {
    const snap = agg.getStatusSnapshot();
    assert.ok('ledgerDlq' in snap, 'ledgerDlq must be a top-level field');
    assert.equal(typeof snap.ledgerDlq, 'object');
  } finally {
    await agg.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

// MMMM-2: ledgerDlq.path is the DLQ file path string
test('MMMM-2: ledgerDlq.path is the configured DLQ file path', async () => {
  const dir = tempDir();
  const dlqPath = join(dir, 'mmmm2.dlq.jsonl');
  const agg = isolatedAgg(dir, 'mmmm2', dlqPath);
  try {
    const snap = agg.getStatusSnapshot();
    assert.equal(snap.ledgerDlq.path, dlqPath);
  } finally {
    await agg.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

// MMMM-3: ledgerDlq.entryCount is 0 when no DLQ file exists
test('MMMM-3: ledgerDlq.entryCount is 0 when DLQ file does not exist', async () => {
  const dir = tempDir();
  const agg = isolatedAgg(dir, 'mmmm3');
  try {
    const snap = agg.getStatusSnapshot();
    assert.equal(snap.ledgerDlq.entryCount, 0);
  } finally {
    await agg.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

// MMMM-4: ledgerDlq.entryCount reflects real DLQ entry count
test('MMMM-4: ledgerDlq.entryCount equals the number of entries in the DLQ file', async () => {
  const dir = tempDir();
  const dlqPath = seedDlq(dir, 'mmmm4', 7);
  const agg = isolatedAgg(dir, 'mmmm4', dlqPath);
  try {
    const snap = agg.getStatusSnapshot();
    assert.equal(snap.ledgerDlq.entryCount, 7);
  } finally {
    await agg.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

// MMMM-5: ledgerDlq.path matches ledgerHealth.dlqPath (consistency)
test('MMMM-5: ledgerDlq.path matches ledgerHealth.dlqPath', async () => {
  const dir = tempDir();
  const dlqPath = join(dir, 'mmmm5.dlq.jsonl');
  const agg = isolatedAgg(dir, 'mmmm5', dlqPath);
  try {
    const snap = agg.getStatusSnapshot();
    assert.equal(snap.ledgerDlq.path, snap.ledgerHealth.dlqPath);
  } finally {
    await agg.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

// MMMM-6: ledgerDlq.entryCount matches ledgerHealth.dlqEntries (consistency)
test('MMMM-6: ledgerDlq.entryCount matches ledgerHealth.dlqEntries', async () => {
  const dir = tempDir();
  const dlqPath = seedDlq(dir, 'mmmm6', 3);
  const agg = isolatedAgg(dir, 'mmmm6', dlqPath);
  try {
    const snap = agg.getStatusSnapshot();
    assert.equal(snap.ledgerDlq.entryCount, snap.ledgerHealth.dlqEntries);
  } finally {
    await agg.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

// MMMM-7: ledgerDlq is present in short mode (top-level field, not omitted by short)
test('MMMM-7: ledgerDlq is present in short mode output', async () => {
  const dir = tempDir();
  const dlqPath = seedDlq(dir, 'mmmm7', 2);
  const agg = isolatedAgg(dir, 'mmmm7', dlqPath);
  try {
    // Verify the snapshot field is there — short mode omits servers[] and coordinator.sessions[]
    // but preserves all top-level health fields including ledgerDlq.
    const snap = agg.getStatusSnapshot();
    const { servers: _s, coordinator, ...rest } = snap;
    const { sessions: _sess, ...coordinatorShort } = coordinator;
    const shortSnap = { ...rest, coordinator: coordinatorShort };
    assert.ok('ledgerDlq' in shortSnap, 'ledgerDlq must survive short mode reduction');
    assert.equal(shortSnap.ledgerDlq.entryCount, 2);
    assert.equal(shortSnap.ledgerDlq.path, dlqPath);
  } finally {
    await agg.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});
