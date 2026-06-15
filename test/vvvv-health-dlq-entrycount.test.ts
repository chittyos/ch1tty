/**
 * VVVV: /api/v1/health 503 body now includes ledgerDlq: { entryCount }
 *
 * When systemHealth.status === 'degraded', the health endpoint response body
 * carries ledgerDlq.entryCount so callers can see the backlog depth without a
 * separate /api/v1/status call. 200 responses (ok/warn) do not include it.
 * The internal-failure path (snapshot throws) also does not include it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';

function seedDlq(dir: string, count: number): string {
  const dlqPath = join(dir, 'test.dlq.jsonl');
  const lines = Array.from({ length: count }, (_, i) =>
    JSON.stringify({ event_type: 'session_start', session_id: `s${i}` }),
  ).join('\n') + '\n';
  writeFileSync(dlqPath, lines, 'utf8');
  return dlqPath;
}

interface Started {
  server: HttpMcpServer;
  aggregator: Aggregator;
  baseUrl: string;
}

async function start(dlqPath?: string): Promise<Started> {
  const aggregator = new Aggregator([], { ledgerDlqPath: dlqPath, embedEnabled: false });
  const server = new HttpMcpServer(aggregator, { port: 0, bindAddress: '127.0.0.1' });
  await server.start();
  return { server, aggregator, baseUrl: `http://127.0.0.1:${server.getPort()}` };
}

async function stop(s: Started): Promise<void> {
  await s.server.stop();
  await s.aggregator.shutdown();
}

// VVVV-1: 503 body includes ledgerDlq field
test('VVVV-1: /api/v1/health 503 body includes ledgerDlq', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-vvvv-'));
  try {
    const dlqPath = seedDlq(dir, 3);
    const s = await start(dlqPath);
    try {
      const res = await fetch(`${s.baseUrl}/api/v1/health`);
      assert.equal(res.status, 503);
      const body = await res.json() as Record<string, unknown>;
      assert.ok('ledgerDlq' in body, 'ledgerDlq must be present in 503 body');
    } finally {
      await stop(s);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// VVVV-2: ledgerDlq.entryCount matches actual DLQ size
test('VVVV-2: /api/v1/health 503 ledgerDlq.entryCount matches DLQ line count', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-vvvv-'));
  try {
    const dlqPath = seedDlq(dir, 7);
    const s = await start(dlqPath);
    try {
      const res = await fetch(`${s.baseUrl}/api/v1/health`);
      assert.equal(res.status, 503);
      const body = await res.json() as { ledgerDlq: { entryCount: number } };
      assert.equal(body.ledgerDlq.entryCount, 7, 'entryCount must equal 7 seeded DLQ entries');
    } finally {
      await stop(s);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// VVVV-3: 200 body does NOT include ledgerDlq
test('VVVV-3: /api/v1/health 200 body does not include ledgerDlq', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-vvvv-'));
  try {
    const emptyDlq = join(dir, 'empty.dlq.jsonl');
    writeFileSync(emptyDlq, '', 'utf8');
    const s = await start(emptyDlq);
    try {
      const res = await fetch(`${s.baseUrl}/api/v1/health`);
      assert.equal(res.status, 200);
      const body = await res.json() as Record<string, unknown>;
      assert.ok(!('ledgerDlq' in body), 'ledgerDlq must NOT be present in 200 body');
    } finally {
      await stop(s);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// VVVV-4: ledgerDlq.entryCount is consistent with getStatusSnapshot().ledgerDlq.entryCount
test('VVVV-4: health 503 ledgerDlq.entryCount consistent with status snapshot', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-vvvv-'));
  try {
    const dlqPath = seedDlq(dir, 5);
    const s = await start(dlqPath);
    try {
      const snap = s.aggregator.getStatusSnapshot();
      const res = await fetch(`${s.baseUrl}/api/v1/health`);
      const body = await res.json() as { ledgerDlq: { entryCount: number } };
      assert.equal(body.ledgerDlq.entryCount, snap.ledgerDlq.entryCount, 'health and status snapshot must agree on entryCount');
    } finally {
      await stop(s);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// VVVV-5: ledgerDlq in health body has only entryCount (no path/entries exposure)
test('VVVV-5: health 503 ledgerDlq has only entryCount (minimal surface)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-vvvv-'));
  try {
    const dlqPath = seedDlq(dir, 2);
    const s = await start(dlqPath);
    try {
      const res = await fetch(`${s.baseUrl}/api/v1/health`);
      assert.equal(res.status, 503);
      const body = await res.json() as { ledgerDlq: Record<string, unknown> };
      const keys = Object.keys(body.ledgerDlq);
      assert.deepEqual(keys, ['entryCount'], `ledgerDlq must have only entryCount, got: ${keys.join(',')}`);
    } finally {
      await stop(s);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// VVVV-6: existing 503 body fields still present alongside ledgerDlq
test('VVVV-6: health 503 body retains status, service, systemHealth alongside ledgerDlq', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-vvvv-'));
  try {
    const dlqPath = seedDlq(dir, 1);
    const s = await start(dlqPath);
    try {
      const res = await fetch(`${s.baseUrl}/api/v1/health`);
      assert.equal(res.status, 503);
      const body = await res.json() as Record<string, unknown>;
      assert.equal(body.status, 'degraded', 'status must be degraded');
      assert.equal(body.service, 'ch1tty', 'service must be ch1tty');
      assert.ok(body.systemHealth && typeof body.systemHealth === 'object', 'systemHealth must be present');
      assert.ok('ledgerDlq' in body, 'ledgerDlq must be present');
    } finally {
      await stop(s);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// VVVV-7: internal snapshot failure path has no ledgerDlq field
test('VVVV-7: internal error path 503 body has no ledgerDlq field', async () => {
  const aggregator = new Aggregator([], { embedEnabled: false });
  const origSnapshot = aggregator.getStatusSnapshot.bind(aggregator);
  (aggregator as unknown as Record<string, unknown>).getStatusSnapshot = () => { throw new Error('snapshot-fail'); };
  const server = new HttpMcpServer(aggregator, { port: 0, bindAddress: '127.0.0.1' });
  await server.start();
  try {
    const res = await fetch(`http://127.0.0.1:${server.getPort()}/api/v1/health`);
    assert.equal(res.status, 503);
    const body = await res.json() as Record<string, unknown>;
    assert.ok(!('ledgerDlq' in body), 'internal-error 503 must NOT include ledgerDlq');
    assert.equal(body.error, 'internal');
  } finally {
    await server.stop();
    (aggregator as unknown as Record<string, unknown>).getStatusSnapshot = origSnapshot;
    await aggregator.shutdown();
  }
});
