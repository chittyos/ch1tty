/**
 * GBB: freeze /api/v1/health exact top-level key set in every state
 *
 * Existing tests freeze individual field values and presence/absence flags
 * (DDDDD: brainCircuitOpen; VVVV: ledgerDlq.entryCount). GBB freezes the
 * COMPLETE top-level key set so a future change cannot silently add an
 * undocumented field or remove a documented one.
 *
 * Key sets by state (all keys sorted alphabetically in assertions):
 *   ok                → {ledgerOk, service, status, systemHealth}
 *   warn + brain      → {brainCircuitOpen, service, status, systemHealth}
 *   warn + ledger     → {ledgerWarn, service, status, systemHealth}
 *   degraded (503)    → {ledgerDlq, service, status, systemHealth}
 *   internal err(503) → {error, service, status}  (no systemHealth)
 *
 * GBB-1: ok state → exact key set
 * GBB-2: warn + brainDegraded → exact key set
 * GBB-3: warn + ledgerWarn → exact key set
 * GBB-4: degraded (DLQ) → exact key set
 * GBB-5: internal snapshot error → exact key set
 */

import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';

interface Started {
  server: HttpMcpServer;
  aggregator: Aggregator;
  baseUrl: string;
  dlqPath: string;
}

async function startServer(): Promise<Started> {
  const dlqPath = join(tmpdir(), `ch1tty-gbb-${process.pid}-${Date.now()}.dlq.jsonl`);
  const aggregator = new Aggregator([], { ledgerDlqPath: dlqPath, embedEnabled: false });
  const server = new HttpMcpServer(aggregator, { port: 0, bindAddress: '127.0.0.1' });
  await server.start();
  return { server, aggregator, baseUrl: `http://127.0.0.1:${server.getPort()}`, dlqPath };
}

async function stop(s: Started): Promise<void> {
  await s.server.stop();
  await s.aggregator.shutdown();
  rmSync(s.dlqPath, { force: true });
}

type SystemHealthOverride = {
  status: 'ok' | 'warn' | 'degraded';
  brainDegraded: boolean;
  ledgerStatus: 'ok' | 'warn' | 'degraded';
};

function patchSnapshot(s: Started, overrides: SystemHealthOverride): void {
  const orig = s.aggregator.getStatusSnapshot.bind(s.aggregator);
  s.aggregator.getStatusSnapshot = () => ({ ...orig(), systemHealth: overrides });
}

function sortedKeys(obj: Record<string, unknown>): string {
  return Object.keys(obj).sort().join(',');
}

test('GBB-1: ok state → exact keys {ledgerOk, service, status, systemHealth}', async () => {
  const s = await startServer();
  try {
    patchSnapshot(s, { status: 'ok', brainDegraded: false, ledgerStatus: 'ok' });
    const res = await fetch(`${s.baseUrl}/api/v1/health`);
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(
      sortedKeys(body),
      'ledgerOk,service,status,systemHealth',
      `ok body keys: got [${Object.keys(body).join(',')}]`,
    );
  } finally {
    await stop(s);
  }
});

test('GBB-2: warn+brainDegraded → exact keys {brainCircuitOpen, service, status, systemHealth}', async () => {
  const s = await startServer();
  try {
    patchSnapshot(s, { status: 'warn', brainDegraded: true, ledgerStatus: 'ok' });
    const res = await fetch(`${s.baseUrl}/api/v1/health`);
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(
      sortedKeys(body),
      'brainCircuitOpen,service,status,systemHealth',
      `warn+brain body keys: got [${Object.keys(body).join(',')}]`,
    );
  } finally {
    await stop(s);
  }
});

test('GBB-3: warn+ledgerWarn → exact keys {ledgerWarn, service, status, systemHealth}', async () => {
  const s = await startServer();
  try {
    patchSnapshot(s, { status: 'warn', brainDegraded: false, ledgerStatus: 'warn' });
    const res = await fetch(`${s.baseUrl}/api/v1/health`);
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(
      sortedKeys(body),
      'ledgerWarn,service,status,systemHealth',
      `warn+ledger body keys: got [${Object.keys(body).join(',')}]`,
    );
  } finally {
    await stop(s);
  }
});

test('GBB-4: degraded (DLQ) → exact keys {ledgerDlq, service, status, systemHealth}', async () => {
  const s = await startServer();
  try {
    patchSnapshot(s, { status: 'degraded', brainDegraded: false, ledgerStatus: 'degraded' });
    const res = await fetch(`${s.baseUrl}/api/v1/health`);
    assert.equal(res.status, 503);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(
      sortedKeys(body),
      'ledgerDlq,service,status,systemHealth',
      `degraded body keys: got [${Object.keys(body).join(',')}]`,
    );
  } finally {
    await stop(s);
  }
});

test('GBB-5: internal snapshot error → exact keys {error, service, status} (no systemHealth)', async () => {
  const s = await startServer();
  try {
    s.aggregator.getStatusSnapshot = () => { throw new Error('GBB-5: simulated snapshot failure'); };
    const res = await fetch(`${s.baseUrl}/api/v1/health`);
    assert.equal(res.status, 503);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(
      sortedKeys(body),
      'error,service,status',
      `internal error body keys: got [${Object.keys(body).join(',')}]`,
    );
  } finally {
    await stop(s);
  }
});
