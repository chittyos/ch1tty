/**
 * Unit tests for getStatusSnapshot() systemHealth aggregation.
 *
 * Covers the three-level status state machine (ok / warn / degraded) and the
 * boundary conditions between them. The "degraded" path driven by a real DLQ
 * file is already tested in health-degraded-e2e.test.ts; these tests focus on
 * the untested "warn" paths (brain circuit open, ledger warn indicators) and
 * the combination where ledger degraded overrides brain warn.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Aggregator } from '../src/aggregator.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'ch1tty-snap-'));
}

function seedDlq(dir: string, name: string, count: number): string {
  const path = join(dir, `${name}.dlq.jsonl`);
  const lines = Array.from({ length: count }, (_, i) =>
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

// ── tests ─────────────────────────────────────────────────────────────────────

test('systemHealth: ok when no circuits open and no DLQ entries', async () => {
  const dir = tempDir();
  const agg = isolatedAgg(dir, 'ok');
  try {
    const snap = agg.getStatusSnapshot();
    assert.equal(snap.systemHealth.status, 'ok');
    assert.equal(snap.systemHealth.brainDegraded, false);
    assert.equal(snap.systemHealth.ledgerStatus, 'ok');
    assert.equal(snap.brainHealth.status, 'ok');
    assert.equal(snap.brainHealth.embeddingCircuitOpen, false);
    assert.equal(snap.brainHealth.ollamaCircuitOpen, false);
    assert.equal(snap.ledgerHealth.status, 'ok');
    assert.equal(snap.ledgerHealth.dropped, 0);
    assert.equal(snap.ledgerHealth.buffered, 0);
    assert.equal(snap.ledgerHealth.flushErrors, 0);
    assert.equal(snap.ledgerHealth.dlqEntries, 0);
  } finally {
    await agg.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('systemHealth: warn when embedding brain circuit is open', async () => {
  const dir = tempDir();
  const agg = isolatedAgg(dir, 'embed-warn');
  try {
    // Force embedding circuit open — circuit-open means brainDegraded=true → systemStatus='warn'
    (agg.coordinator.embeddingBrain as Record<string, unknown>).circuitOpenUntil = Date.now() + 60_000;

    const snap = agg.getStatusSnapshot();
    assert.equal(snap.systemHealth.status, 'warn', 'embedding circuit open → warn');
    assert.equal(snap.systemHealth.brainDegraded, true);
    assert.equal(snap.systemHealth.ledgerStatus, 'ok');
    assert.equal(snap.brainHealth.status, 'degraded', 'brainHealth degrades when either circuit opens');
    assert.equal(snap.brainHealth.embeddingCircuitOpen, true);
    assert.equal(snap.brainHealth.ollamaCircuitOpen, false);
    assert.equal(snap.ledgerHealth.status, 'ok', 'ledger unaffected');
  } finally {
    await agg.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('systemHealth: warn when ollama brain circuit is open', async () => {
  const dir = tempDir();
  const agg = isolatedAgg(dir, 'ollama-warn');
  try {
    (agg.coordinator.brain as Record<string, unknown>).circuitOpenUntil = Date.now() + 60_000;

    const snap = agg.getStatusSnapshot();
    assert.equal(snap.systemHealth.status, 'warn');
    assert.equal(snap.systemHealth.brainDegraded, true);
    assert.equal(snap.brainHealth.ollamaCircuitOpen, true);
    assert.equal(snap.brainHealth.embeddingCircuitOpen, false);
    assert.equal(snap.brainHealth.status, 'degraded');
    assert.equal(snap.ledgerHealth.status, 'ok');
  } finally {
    await agg.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('systemHealth: warn when ledger has dropped entries (no DLQ)', async () => {
  const dir = tempDir();
  const agg = isolatedAgg(dir, 'dropped');
  try {
    (agg.coordinator.ledger as Record<string, unknown>).totalDropped = 3;

    const snap = agg.getStatusSnapshot();
    assert.equal(snap.systemHealth.status, 'warn');
    assert.equal(snap.systemHealth.ledgerStatus, 'warn');
    assert.equal(snap.ledgerHealth.status, 'warn');
    assert.equal(snap.ledgerHealth.dropped, 3);
    assert.equal(snap.systemHealth.brainDegraded, false, 'brain unaffected');
    assert.equal(snap.ledgerHealth.dlqEntries, 0, 'no DLQ entries — just warn, not degraded');
  } finally {
    await agg.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('systemHealth: warn when ledger buffer is non-empty', async () => {
  const dir = tempDir();
  const agg = isolatedAgg(dir, 'buffered');
  try {
    (agg.coordinator.ledger as Record<string, unknown>).buffer = [
      { event_type: 'test', session_id: 's1', metadata: {}, timestamp: '', retries: 0 },
    ];

    const snap = agg.getStatusSnapshot();
    assert.equal(snap.systemHealth.status, 'warn');
    assert.equal(snap.systemHealth.ledgerStatus, 'warn');
    assert.equal(snap.ledgerHealth.buffered, 1);
    assert.equal(snap.ledgerHealth.status, 'warn');
  } finally {
    await agg.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('systemHealth: warn when ledger has flush errors', async () => {
  const dir = tempDir();
  const agg = isolatedAgg(dir, 'flusherr');
  try {
    (agg.coordinator.ledger as Record<string, unknown>).flushErrors = 2;

    const snap = agg.getStatusSnapshot();
    assert.equal(snap.systemHealth.status, 'warn');
    assert.equal(snap.systemHealth.ledgerStatus, 'warn');
    assert.equal(snap.ledgerHealth.flushErrors, 2);
    assert.equal(snap.ledgerHealth.status, 'warn');
  } finally {
    await agg.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('systemHealth: degraded overrides brain warn when DLQ has entries', async () => {
  const dir = tempDir();
  const dlqPath = seedDlq(dir, 'override', 5);
  const agg = isolatedAgg(dir, 'override', dlqPath);
  try {
    // Brain circuit open (would be 'warn' alone) + DLQ entries (→ 'degraded').
    // Ledger degraded must win over brain warn.
    (agg.coordinator.embeddingBrain as Record<string, unknown>).circuitOpenUntil = Date.now() + 60_000;

    const snap = agg.getStatusSnapshot();
    assert.equal(snap.systemHealth.status, 'degraded', 'ledger degraded wins over brain warn');
    assert.equal(snap.systemHealth.ledgerStatus, 'degraded');
    assert.equal(snap.systemHealth.brainDegraded, true, 'brain is still degraded');
    assert.equal(snap.ledgerHealth.dlqEntries, 5);
  } finally {
    await agg.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('systemHealth: both brain circuit and ledger warn → still warn (not degraded)', async () => {
  const dir = tempDir();
  const agg = isolatedAgg(dir, 'brain-ledger-warn');
  try {
    (agg.coordinator.brain as Record<string, unknown>).circuitOpenUntil = Date.now() + 60_000;
    (agg.coordinator.ledger as Record<string, unknown>).totalDropped = 1;

    const snap = agg.getStatusSnapshot();
    // No DLQ entries → ledgerStatus='warn', brainDegraded=true → systemStatus='warn' (not degraded)
    assert.equal(snap.systemHealth.status, 'warn');
    assert.equal(snap.systemHealth.ledgerStatus, 'warn');
    assert.equal(snap.systemHealth.brainDegraded, true);
    assert.equal(snap.ledgerHealth.dlqEntries, 0, 'DLQ still empty — not degraded');
  } finally {
    await agg.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});
