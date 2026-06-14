/**
 * OOOO — `ledgerDlq.entries[]` in `ch1tty/status` snapshot.
 *
 * Extends `ledgerDlq: { path, entryCount }` (MMMM) with `entries: object[]` —
 * the parsed contents of the dead-letter WAL, capped at 50, so operators can
 * inspect DLQ content via a single status call without filesystem access.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Aggregator } from '../src/aggregator.js';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'ch1tty-oooo-'));
}

function seedDlq(dir: string, name: string, count: number): string {
  const path = join(dir, `${name}.dlq.jsonl`);
  const lines =
    Array.from({ length: count }, (_, i) =>
      JSON.stringify({
        event_type: 'tool_call',
        session_id: `s${i}`,
        metadata: { tool: `srv/tool_${i}` },
        timestamp: new Date().toISOString(),
        retries: 3,
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

// OOOO-1: ledgerDlq.entries is an array
test('OOOO-1: ledgerDlq.entries is an array', async () => {
  const dir = tempDir();
  const agg = isolatedAgg(dir, 'oooo1');
  try {
    const snap = agg.getStatusSnapshot();
    assert.ok(Array.isArray(snap.ledgerDlq.entries), 'entries must be an array');
  } finally {
    await agg.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

// OOOO-2: entries is [] when no DLQ file exists
test('OOOO-2: ledgerDlq.entries is [] when DLQ file does not exist', async () => {
  const dir = tempDir();
  const agg = isolatedAgg(dir, 'oooo2');
  try {
    const snap = agg.getStatusSnapshot();
    assert.deepEqual(snap.ledgerDlq.entries, []);
  } finally {
    await agg.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

// OOOO-3: entries contains parsed objects when DLQ file has entries
test('OOOO-3: ledgerDlq.entries contains parsed objects from the DLQ file', async () => {
  const dir = tempDir();
  const dlqPath = seedDlq(dir, 'oooo3', 5);
  const agg = isolatedAgg(dir, 'oooo3', dlqPath);
  try {
    const snap = agg.getStatusSnapshot();
    assert.equal(snap.ledgerDlq.entries.length, 5);
    const first = snap.ledgerDlq.entries[0] as Record<string, unknown>;
    assert.equal(first['event_type'], 'tool_call');
    assert.equal(first['session_id'], 's0');
  } finally {
    await agg.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

// OOOO-4: entries.length matches entryCount
test('OOOO-4: ledgerDlq.entries.length matches ledgerDlq.entryCount', async () => {
  const dir = tempDir();
  const dlqPath = seedDlq(dir, 'oooo4', 8);
  const agg = isolatedAgg(dir, 'oooo4', dlqPath);
  try {
    const snap = agg.getStatusSnapshot();
    assert.equal(snap.ledgerDlq.entries.length, snap.ledgerDlq.entryCount);
  } finally {
    await agg.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

// OOOO-5: entries are capped at 50 — most-recent 50 returned when file has more
test('OOOO-5: ledgerDlq.entries is capped at 50 most-recent entries', async () => {
  const dir = tempDir();
  const dlqPath = seedDlq(dir, 'oooo5', 60);
  const agg = isolatedAgg(dir, 'oooo5', dlqPath);
  try {
    const snap = agg.getStatusSnapshot();
    assert.equal(snap.ledgerDlq.entryCount, 60);
    assert.equal(snap.ledgerDlq.entries.length, 50, 'entries capped at 50');
    // most-recent 50 = entries 10..59 → session_id 's10' is the first
    const first = snap.ledgerDlq.entries[0] as Record<string, unknown>;
    assert.equal(first['session_id'], 's10');
  } finally {
    await agg.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

// OOOO-6: malformed JSON lines are silently skipped
test('OOOO-6: malformed JSON lines in DLQ are silently skipped', async () => {
  const dir = tempDir();
  const dlqPath = join(dir, 'oooo6.dlq.jsonl');
  writeFileSync(
    dlqPath,
    [
      JSON.stringify({ event_type: 'ok', session_id: 'good1', metadata: {}, timestamp: new Date().toISOString(), retries: 0 }),
      'NOT_VALID_JSON{{{',
      JSON.stringify({ event_type: 'ok', session_id: 'good2', metadata: {}, timestamp: new Date().toISOString(), retries: 0 }),
    ].join('\n') + '\n',
    'utf8',
  );
  const agg = isolatedAgg(dir, 'oooo6', dlqPath);
  try {
    const snap = agg.getStatusSnapshot();
    // entryCount counts all non-empty lines (3), but entries skips the malformed one
    assert.equal(snap.ledgerDlq.entryCount, 3);
    assert.equal(snap.ledgerDlq.entries.length, 2);
    const ids = (snap.ledgerDlq.entries as Record<string, unknown>[]).map((e) => e['session_id']);
    assert.deepEqual(ids, ['good1', 'good2']);
  } finally {
    await agg.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

// OOOO-7: entries survive short:true mode (ledgerDlq is not stripped)
test('OOOO-7: ledgerDlq.entries survives short mode reduction', async () => {
  const dir = tempDir();
  const dlqPath = seedDlq(dir, 'oooo7', 3);
  const agg = isolatedAgg(dir, 'oooo7', dlqPath);
  try {
    const snap = agg.getStatusSnapshot();
    // Simulate short mode: strip servers[] and coordinator.sessions[]
    const { servers: _s, coordinator, ...rest } = snap;
    const { sessions: _sess, ...coordinatorShort } = coordinator;
    const shortSnap = { ...rest, coordinator: coordinatorShort };
    assert.ok('ledgerDlq' in shortSnap);
    assert.ok(Array.isArray(shortSnap.ledgerDlq.entries));
    assert.equal(shortSnap.ledgerDlq.entries.length, 3);
  } finally {
    await agg.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});
