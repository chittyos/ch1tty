/**
 * End-to-end tests for the /api/v1/health degraded path driven by a real DLQ backlog.
 *
 * The existing http-server.test.ts covers the 503 case via a monkey-patched
 * getStatusSnapshot. These tests exercise the full real path:
 *   DLQ file on disk → LedgerClient.dlqEntries() → getStatusSnapshot().systemHealth
 *   → HttpMcpServer /api/v1/health response code and body
 *
 * No mocking — every assertion reflects real runtime behaviour.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';

/** Write N fake DLQ entries to a new file inside dir, return the path. */
function seedDlq(dir: string, count: number, filename = 'ledger.dlq.jsonl'): string {
  const dlqPath = join(dir, filename);
  const lines = Array.from({ length: count }, (_, i) =>
    JSON.stringify({
      event_type: 'session_start',
      session_id: `seed-sess-${i}`,
      metadata: {},
      timestamp: new Date().toISOString(),
      retries: 0,
      droppedAt: new Date().toISOString(),
    }),
  ).join('\n') + '\n';
  writeFileSync(dlqPath, lines, 'utf8');
  return dlqPath;
}

interface Started {
  server: HttpMcpServer;
  aggregator: Aggregator;
  baseUrl: string;
  dir: string;
}

async function start(dlqPath: string): Promise<Started> {
  const dir = '';
  const aggregator = new Aggregator([], { ledgerDlqPath: dlqPath, embedEnabled: false });
  const server = new HttpMcpServer(aggregator, { port: 0, bindAddress: '127.0.0.1' });
  await server.start();
  const baseUrl = `http://127.0.0.1:${server.getPort()}`;
  return { server, aggregator, baseUrl, dir };
}

async function stop(s: Started): Promise<void> {
  await s.server.stop();
  await s.aggregator.shutdown();
}

// ─── Unit-level (no HTTP) ─────────────────────────────────────────────────────

test('getStatusSnapshot: ledgerStatus is degraded when DLQ file has entries', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-health-e2e-'));
  try {
    const dlqPath = seedDlq(dir, 3);
    const aggregator = new Aggregator([], { ledgerDlqPath: dlqPath, embedEnabled: false });
    try {
      const snap = aggregator.getStatusSnapshot();
      assert.equal(snap.systemHealth.status, 'degraded', 'systemHealth must be degraded');
      assert.equal(snap.systemHealth.ledgerStatus, 'degraded', 'ledgerStatus must be degraded');
      assert.equal(snap.ledgerHealth.status, 'degraded', 'ledgerHealth.status must be degraded');
      assert.ok(snap.ledgerHealth.dlqEntries >= 3, `dlqEntries must be >= 3, got ${snap.ledgerHealth.dlqEntries}`);
    } finally {
      await aggregator.shutdown();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getStatusSnapshot: empty DLQ file (0 bytes) does not cause degraded', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-health-e2e-'));
  try {
    const dlqPath = join(dir, 'empty.dlq.jsonl');
    writeFileSync(dlqPath, '', 'utf8');
    const aggregator = new Aggregator([], { ledgerDlqPath: dlqPath, embedEnabled: false });
    try {
      const snap = aggregator.getStatusSnapshot();
      assert.equal(snap.ledgerHealth.dlqEntries, 0, 'empty file must count as 0 DLQ entries');
      assert.notEqual(snap.systemHealth.status, 'degraded', 'empty DLQ must not degrade health');
    } finally {
      await aggregator.shutdown();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getStatusSnapshot: dlqEntries reflects exact line count', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-health-e2e-'));
  try {
    const dlqPath = seedDlq(dir, 7);
    const aggregator = new Aggregator([], { ledgerDlqPath: dlqPath, embedEnabled: false });
    try {
      const snap = aggregator.getStatusSnapshot();
      assert.equal(snap.ledgerHealth.dlqEntries, 7, 'dlqEntries must match seeded line count');
    } finally {
      await aggregator.shutdown();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── HTTP end-to-end ──────────────────────────────────────────────────────────

test('GET /api/v1/health: returns 503 for real DLQ backlog — no monkey-patch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-health-e2e-'));
  try {
    const dlqPath = seedDlq(dir, 2);
    const s = await start(dlqPath);
    try {
      const res = await fetch(`${s.baseUrl}/api/v1/health`);
      assert.equal(res.status, 503, '/api/v1/health must return 503 when DLQ is non-empty');
      const body = await res.json() as {
        status: string;
        service: string;
        systemHealth: { status: string; ledgerStatus: string };
      };
      assert.equal(body.status, 'degraded', 'response body status must be degraded');
      assert.equal(body.service, 'ch1tty');
      assert.equal(body.systemHealth.ledgerStatus, 'degraded', 'ledgerStatus in systemHealth must be degraded');
    } finally {
      await stop(s);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /api/v1/status: ledgerHealth.dlqEntries matches actual DLQ file size', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-health-e2e-'));
  try {
    const dlqPath = seedDlq(dir, 5);
    const s = await start(dlqPath);
    try {
      const res = await fetch(`${s.baseUrl}/api/v1/status`);
      assert.equal(res.status, 200);
      const body = await res.json() as { ledgerHealth: { dlqEntries: number; status: string; dlqPath: string } };
      assert.equal(body.ledgerHealth.dlqEntries, 5, 'ledgerHealth.dlqEntries must match 5 seeded entries');
      assert.equal(body.ledgerHealth.status, 'degraded');
      assert.equal(body.ledgerHealth.dlqPath, dlqPath);
    } finally {
      await stop(s);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /api/v1/health: reverts to ok after DLQ file is removed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-health-e2e-'));
  try {
    const dlqPath = seedDlq(dir, 4);
    const s = await start(dlqPath);
    try {
      const before = await fetch(`${s.baseUrl}/api/v1/health`);
      assert.equal(before.status, 503, 'must be 503 before clearing DLQ');

      unlinkSync(dlqPath);

      const after = await fetch(`${s.baseUrl}/api/v1/health`);
      assert.equal(after.status, 200, 'must revert to 200 after DLQ file removed');
      const body = await after.json() as { status: string };
      assert.ok(
        body.status === 'ok' || body.status === 'warn',
        `status must be ok or warn after DLQ cleared, got: ${body.status}`,
      );
    } finally {
      await stop(s);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /api/v1/health: 503 body includes systemHealth with brainDegraded field', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-health-e2e-'));
  try {
    const dlqPath = seedDlq(dir, 1);
    const s = await start(dlqPath);
    try {
      const res = await fetch(`${s.baseUrl}/api/v1/health`);
      assert.equal(res.status, 503);
      const body = await res.json() as {
        systemHealth: { status: string; brainDegraded: boolean; ledgerStatus: string };
      };
      assert.equal(typeof body.systemHealth.brainDegraded, 'boolean', 'brainDegraded must be boolean');
      assert.equal(body.systemHealth.status, 'degraded');
    } finally {
      await stop(s);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
